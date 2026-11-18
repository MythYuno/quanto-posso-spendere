"""Eseguire con Python, Playwright e Chromium (vedi README)."""
import asyncio
import json
import os
import threading
import unittest
from datetime import date, timedelta
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.async_api import async_playwright, expect


class LocalHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


TODAY = date(2026, 11, 18)


def day(offset):
    return (TODAY + timedelta(days=offset)).isoformat()


def snapshot(start=0, end=10):
    return dict(v=1, settings=dict(salary=1000, fixed=400, aside=200,
                                   start=day(start), end=day(end)), expenses=[], periods=[])


def expense(name, amount, offset):
    return dict(id=name, amount=amount, date=day(offset), note=name, createdAt=1)


class BudgetTest(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        handler = partial(LocalHandler, directory=Path(__file__).resolve().parents[1])
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    async def asyncSetUp(self):
        self.pw = await async_playwright().start()
        self.addAsyncCleanup(self.pw.stop)
        self.browser = await self.pw.chromium.launch(executable_path=os.getenv("CHROMIUM_PATH"))
        self.addAsyncCleanup(self.browser.close)
        self.context = await self.browser.new_context(viewport={"width": 390, "height": 844},
                                                     reduced_motion="reduce", timezone_id="Europe/Rome")
        await self.context.route("https://fonts.**/*", lambda route: route.abort())
        self.page = await self.context.new_page()
        await self.page.clock.set_fixed_time("2026-11-18T12:00:00+01:00")
        await self.page.goto(self.url)
        await self.page.evaluate("navigator.serviceWorker.ready")

    async def seed(self, state):
        await self.page.evaluate("(d) => localStorage.setItem('qps.v1', JSON.stringify(d))", state)
        await self.page.reload()

    async def state(self):
        return await self.page.evaluate("JSON.parse(localStorage.getItem('qps.v1'))")

    async def spend(self, page, amount):
        await page.locator("#exAmt").fill(amount)
        await page.locator("#addForm button").click()
        await expect(page.locator("#exAmt")).to_have_value("")

    async def test_first_use_and_daily_limit(self):
        await self.page.locator("#obSalary").fill("1.800")
        await self.page.locator("#obFixed").fill("1.200,00")
        await self.page.locator("#obSave").fill("200.00")
        await self.page.locator("#obEnd").fill(day(10))
        await self.page.locator("#obForm button").click()
        await expect(self.page.locator("#hFig")).to_have_text("40")
        self.assertEqual((await self.state())["settings"]["salary"], 1800)
        await self.spend(self.page, "39,90")
        await expect(self.page.locator("#hFig")).to_have_text("0,10")
        await self.spend(self.page, "0,10")
        await expect(self.page.locator("#hFig")).to_have_text("0")
        await expect(self.page.locator("#hSub")).to_contain_text("40,00")
        await self.page.reload()
        await expect(self.page.locator("#hFig")).to_have_text("0")

    async def test_closed_period_and_savings(self):
        state = snapshot(-10)
        state["expenses"] = [expense("ieri", 450, -1), expense("oggi", 20, 0)]
        await self.seed(state)
        await self.page.locator("#btnSettings").click()
        await self.page.locator("#stNewPeriod").click()
        await expect(self.page.locator("#listTotal")).to_contain_text("20,00")
        result = await self.state()
        self.assertEqual([(p["end"], p["spent"], p["saved"]) for p in result["periods"]],
                         [(day(0), 450, 150)])
        await self.page.locator("#btnSettings").click()
        await self.page.locator("#stNewPeriod").click()
        await expect(self.page.locator("#toast")).to_contain_text("già aperto")
        self.assertEqual(len((await self.state())["periods"]), 1)

    async def test_last_cent_on_final_day(self):
        state = snapshot(0, 1)
        state["settings"].update(salary=0.30, fixed=0, aside=0)
        await self.seed(state)
        await self.spend(self.page, "0,10")
        await self.spend(self.page, "0,20")
        await expect(self.page.locator("#hFig")).to_have_text("0")
        await expect(self.page.locator("#hPill")).to_contain_text("In linea")

    async def test_future_expense_and_payday(self):
        state = snapshot()
        state["expenses"] = [expense("domani", 40, 1)]
        await self.seed(state)
        await expect(self.page.locator("#chartNote")).to_have_text("nessuna spesa")
        await expect(self.page.locator("#hFig")).to_have_text("40")
        await self.page.locator("#exDate").fill(day(1))
        await self.page.locator("#exAmt").fill("5")
        await self.page.locator("#addForm button").click()
        self.assertEqual((await self.state())["expenses"], state["expenses"])
        await self.seed(snapshot(-10, 0))
        await expect(self.page.locator("#addForm")).to_be_hidden()
        await expect(self.page.locator("#hFig")).to_have_text("0")

    async def upload(self, data):
        await self.page.locator("#fileIn").set_input_files(dict(
            name="backup.json", mimeType="application/json", buffer=json.dumps(data).encode()))

    async def test_backup_validation_and_confirmation(self):
        initial = snapshot()
        await self.seed(initial)
        await self.page.locator("#btnSettings").click()
        for invalid in [{}, {**initial, "v": 9}, {**initial, "expenses": [expense("ok", 1, 0), None]}]:
            await self.upload(invalid)
            await expect(self.page.locator("#toast")).to_contain_text("Backup non valido")
            self.assertEqual(await self.state(), initial)
        legacy = snapshot()
        legacy["expenses"] = [expense("caffè", 1, 0)]  # versione precedente a oneOff
        self.page.once("dialog", lambda dialog: dialog.dismiss())
        await self.upload(legacy)
        self.assertEqual(await self.state(), initial)
        self.page.once("dialog", lambda dialog: dialog.accept())
        await self.upload(legacy)
        await expect(self.page.locator("#today")).to_contain_text("caffè")
        self.assertEqual((await self.state())["expenses"][0]["oneOff"], False)

    async def parallel_entries(self):
        await self.seed(snapshot())
        other = await self.context.new_page()
        await other.clock.set_fixed_time("2026-11-18T12:00:00+01:00")
        await other.goto(self.url)
        await asyncio.gather(self.spend(self.page, "5"), self.spend(other, "12"))
        for page in [self.page, other]:
            await expect(page.locator("#listTotal")).to_contain_text("17,00")
        await self.page.locator("#today .del").first.click()
        await expect(other.locator("#listTotal")).to_contain_text("1 spesa")
        await self.page.locator("#toastBtn").click()
        await expect(other.locator("#listTotal")).to_contain_text("17,00")
        self.assertEqual(sorted(e["amount"] for e in (await self.state())["expenses"]), [5, 12])

    async def test_two_tabs(self):
        await self.parallel_entries()

    async def test_two_tabs_without_web_locks(self):
        await self.context.add_init_script("Object.defineProperty(navigator, 'locks', {value: undefined})")
        await self.parallel_entries()

    async def test_mobile_and_offline(self):
        await self.seed(snapshot())
        await self.page.wait_for_function("!!navigator.serviceWorker.controller")
        await self.context.set_offline(True)
        await self.page.reload()
        await self.spend(self.page, "5")
        await expect(self.page.locator("#hFig")).to_have_text("35")
        await self.page.reload()
        await expect(self.page.locator("#today")).to_contain_text("5,00")
        self.assertTrue(await self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))


if __name__ == "__main__":
    unittest.main()
