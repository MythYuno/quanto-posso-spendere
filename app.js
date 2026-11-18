/* Quanto posso spendere — logica dell'app.
   Nessuna dipendenza. I dati stanno in localStorage, solo in questo browser. */
(function () {
  "use strict";

  /* ============ formati e date ============ */
  var EUR0 = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  var EUR2 = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var WHOLE = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
  var FRACTION = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function figure(n) { return Number.isInteger(n) ? WHOLE.format(n) : FRACTION.format(n); }
  var DAY = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" });
  var DAYLONG = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" });
  var MON = new Intl.DateTimeFormat("it-IT", { month: "short", year: "2-digit" });
  var RM = window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseD(s) { var p = String(s || "").split("-"); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); }
  function todayISO() { return iso(new Date()); }
  function diffDays(a, b) { return Math.round((parseD(b) - parseD(a)) / 86400000); }
  function shiftD(s, n) { var d = parseD(s); d.setDate(d.getDate() + n); return iso(d); }
  function addMonth(s) {
    var d = parseD(s), day = d.getDate();
    var last = new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate();
    return iso(new Date(d.getFullYear(), d.getMonth() + 1, Math.min(day, last)));
  }
  function num(v) {
    var s = String(v == null ? "" : v).trim().replace(/^€\s*|\s*€$/g, "").trim();
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s)) s = s.replace(/\./g, "");
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(s)) return NaN;
    var value = Number(s.replace(",", "."));
    return Number.isSafeInteger(Math.round(value * 100)) ? value : NaN;
  }
  function cents(n) { return Math.round(n * 100); }
  function moneyField(id, optional) {
    var input = el(id), raw = input.value.trim();
    var n = optional && raw === "" ? 0 : num(raw);
    if (!isFinite(n) || (!optional && n <= 0)) {
      input.focus();
      toast("Inserisci un importo valido, ad esempio 1.800,50");
      return NaN;
    }
    return n;
  }
  function validDate(s) {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(parseD(s)) === s;
  }
  function dec(n) { return n ? String(n).replace(".", ",") : ""; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* ============ archivio locale ============ */
  var KEY = "qps.v1", THEME_KEY = "qps.theme";
  function emptyState() { return { set: null, exp: [], per: [] }; }
  var S = emptyState();

  function readState() {
    var raw = localStorage.getItem(KEY);
    if (raw === null) return emptyState();
    var d = JSON.parse(raw);
    if (!d || d.v !== 1 || !Array.isArray(d.expenses) || !Array.isArray(d.periods)) {
      throw new Error("Archivio locale illeggibile");
    }
    return {
      set: d.settings && +d.settings.salary > 0 ? normSettings(d.settings) : null,
      exp: d.expenses.map(normExpense).filter(Boolean),
      per: d.periods.map(withActualSavings)
    };
  }
  function withActualSavings(p) {
    if (!p || ![p.salary, p.fixed, p.spent].every(Number.isFinite)) return p;
    return Object.assign({}, p, { saved: (cents(p.salary) - cents(p.fixed) - cents(p.spent)) / 100 });
  }
  function snapshot(state) {
    return { v: 1, settings: state.set, expenses: state.exp, periods: state.per };
  }
  function refresh() {
    try { S = readState(); }
    catch (err) { toast("Impossibile leggere i dati salvati"); }
    render();
  }

  // Anche su HTTP, dove Web Locks può mancare, le schede devono serializzare
  // lettura, modifica e scrittura. Una transazione readwrite fornisce il lock.
  var lockDB;
  function exclusive(action) {
    if (navigator.locks) return navigator.locks.request(KEY, action);
    if (!lockDB) lockDB = new Promise(function (resolve, reject) {
      var open = indexedDB.open("qps-lock", 1);
      open.onupgradeneeded = function () { open.result.createObjectStore("lock"); };
      open.onsuccess = function () { resolve(open.result); };
      open.onerror = function () { reject(open.error); };
    }).catch(function (err) { lockDB = null; throw err; });
    return lockDB.then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("lock", "readwrite"), result;
        tx.objectStore("lock").get(KEY).onsuccess = function () {
          try { result = action(); } catch (err) { reject(err); }
        };
        tx.oncomplete = function () { resolve(result); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }
  async function change(edit) {
    try {
      return await exclusive(function () {
        var draft = readState();
        if (edit(draft) === false) return false;
        localStorage.setItem(KEY, JSON.stringify(snapshot(draft)));
        S = draft;
        render();
        return true;
      });
    } catch (err) {
      toast("Salvataggio non riuscito. Controlla lo spazio disponibile e riprova.");
      return false;
    }
  }
  function normSettings(s) {
    var start = s.start || todayISO();
    var end = s.end && diffDays(start, s.end) >= 1 ? s.end : addMonth(start);
    return { salary: +s.salary || 0, fixed: +s.fixed || 0, aside: +s.aside || 0, start: start, end: end };
  }
  function normExpense(e) {
    if (!e || !isFinite(+e.amount)) return null;
    return {
      id: e.id || uid(), amount: Math.round(+e.amount * 100) / 100,
      note: String(e.note || "").slice(0, 60), date: e.date || todayISO(),
      oneOff: !!e.oneOff, createdAt: +e.createdAt || 0
    };
  }

  /* ============ calcolo ============ */
  function model(set, exps, today) {
    var start = set.start, end = set.end;
    var total = Math.max(1, diffDays(start, end));
    var idx = Math.min(total, Math.max(0, diffDays(start, today)));
    var left = Math.max(0, total - idx);
    var budgetCents = Math.max(0, cents(set.salary) - cents(set.fixed) - cents(set.aside));
    var budget = budgetCents / 100;

    var inPeriod = exps.filter(function (e) { return e.date >= start && e.date < end && e.date <= today; });
    var spentCents = inPeriod.reduce(function (a, e) { return a + cents(e.amount); }, 0);
    var spent = spentCents / 100;
    var restCents = budgetCents - spentCents;
    var rest = restCents / 100;

    var perDay = [], oncePerDay = [];
    for (var i = 0; i < total; i++) { perDay.push(0); oncePerDay.push(0); }
    inPeriod.forEach(function (e) {
      var k = diffDays(start, e.date);
      if (k >= 0 && k < total) { perDay[k] += e.amount; if (e.oneOff) oncePerDay[k] += e.amount; }
    });

    // le spese "una tantum" tolgono soldi dal budget ma restano fuori dal ritmo giornaliero
    var onceCum = [], c = 0;
    for (i = 0; i < total; i++) { c += oncePerDay[i]; onceCum.push(c); }
    var onceTotal = c;
    var ordBudget = Math.max(0, budget - onceTotal);

    var elapsed = Math.min(total, idx + 1);
    var onceSoFar = elapsed > 0 ? onceCum[elapsed - 1] : 0;
    var burn = elapsed > 0 ? Math.max(0, spent - onceSoFar) / elapsed : 0;
    var expected = onceSoFar + ordBudget * (elapsed / total);
    var delta = expected - spent;
    var spentToday = perDay[idx] || 0;
    var openingCents = restCents + cents(spentToday);
    var quotaCents = left > 0 ? Math.floor(openingCents / left) : 0;
    var allowance = today >= start ? Math.max(0, quotaCents - cents(spentToday)) / 100 : 0;
    var tomorrow = left > 1 ? Math.max(0, Math.floor(restCents / (left - 1))) / 100 : 0;
    var projEnd = rest - burn * Math.max(0, left - 1);
    var zero = burn > 0 && rest >= 0 ? elapsed + rest / burn : null;

    // linea del ritmo ideale: scende dritta, con un gradino nei giorni delle una tantum
    var ideal = [];
    for (i = 0; i <= total; i++) {
      ideal.push({ i: i, v: budget - (i > 0 ? onceCum[i - 1] : 0) - ordBudget * (i / total) });
    }

    return {
      start: start, end: end, total: total, idx: idx, left: left, elapsed: elapsed,
      budget: budget, spent: spent, rest: rest, perDay: perDay, inPeriod: inPeriod,
      onceTotal: onceTotal, onceSoFar: onceSoFar, ordBudget: ordBudget, ideal: ideal,
      burn: burn, expected: expected, delta: delta,
      allowance: allowance, tomorrow: tomorrow, over: rest < 0,
      projEnd: projEnd, zero: zero, isPayday: diffDays(start, today) >= total
    };
  }

  /* ============ schede orizzontali ============ */
  var pager = el("pager"), tabsEl = el("tabs");
  var TABS = {
    onboard: [[0, "Si parte"], [1, "Esempio"]],
    live: [[0, "Oggi"], [1, "Previsione"], [2, "Spese"], [3, "Risparmi"]]
  };
  var curMode = "", active = 0, sTick = 0;

  function setMode(mode) {
    if (curMode === mode) return;
    curMode = mode;
    var defs = TABS[mode], on = {};
    defs.forEach(function (d) { on[d[0]] = 1; });
    for (var i = 0; i < 4; i++) el("sc" + i).hidden = !on[i];
    tabsEl.innerHTML = defs.map(function (d, k) {
      return '<button class="tab" type="button" role="tab" id="tab' + k + '" data-k="' + k +
        '" aria-controls="sc' + d[0] + '" aria-selected="' + (k === 0) + '">' + esc(d[1]) + '</button>';
    }).join("");
    defs.forEach(function (d, k) { el("sc" + d[0]).setAttribute("aria-labelledby", "tab" + k); });
    active = 0;
    pager.scrollLeft = 0;
  }

  function tabCount() { return tabsEl.children.length; }

  function goTo(k) {
    k = Math.max(0, Math.min(tabCount() - 1, k));
    pager.scrollTo({ left: k * pager.clientWidth, behavior: RM ? "auto" : "smooth" });
  }

  function syncTabs() {
    var w = pager.clientWidth || 1;
    var k = Math.max(0, Math.min(tabCount() - 1, Math.round(pager.scrollLeft / w)));
    if (k === active) return;
    active = k;
    Array.prototype.forEach.call(tabsEl.children, function (b, i) {
      b.setAttribute("aria-selected", i === k ? "true" : "false");
    });
    var b = tabsEl.children[k];
    if (b && b.scrollIntoView) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  pager.addEventListener("scroll", function () {
    if (sTick) return;
    sTick = requestAnimationFrame(function () { sTick = 0; syncTabs(); });
  }, { passive: true });

  tabsEl.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".tab");
    if (b) goTo(+b.getAttribute("data-k"));
  });

  /* ============ schermata 1: il numero ============ */
  var lastFigure = null, heroMode = "", footBuilt = false;

  function tween(node, from, to) {
    if (RM || from == null || !isFinite(from)) { node.textContent = figure(to); return; }
    if (node._frame) cancelAnimationFrame(node._frame);
    var t0 = performance.now(), d = 460;
    (function step(t) {
      var k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3);
      node.textContent = figure(k === 1 ? to : Math.floor(from + (to - from) * e));
      if (k < 1) node._frame = requestAnimationFrame(step);
    })(t0);
  }

  // periodo finto, solo per far vedere come si legge il grafico prima del primo inserimento
  var EXAMPLE = { salary: 1800, fixed: 620, aside: 150, start: shiftD(todayISO(), -11), end: shiftD(todayISO(), 19) };
  var EXAMPLE_EXPENSES = [52.4, 18.9, 9.5, 64, 27.3, 12.5, 48.7, 21, 73.5, 15.2, 56.8, 30.4]
    .map(function (a, i) { return { id: "x" + i, amount: a, note: "", date: shiftD(EXAMPLE.start, i), createdAt: i }; });

  function heroOnboarding() {
    setMode("onboard");
    el("addForm").hidden = true;
    el("today").hidden = true;
    if (heroMode !== "onboard") {
      heroMode = "onboard"; footBuilt = false;
      el("hero").innerHTML =
        '<p class="eyebrow">Si parte</p>' +
        '<h1 class="lede">Dimmi lo stipendio e quando arriva il prossimo.</h1>' +
        '<p class="sub">Togliamo le spese fisse e il risparmio, dividiamo il resto per i giorni che mancano.</p>' +
        '<form id="obForm" autocomplete="off" style="margin-top:18px;display:flex;flex-direction:column;gap:12px">' +
          '<div class="grid2">' +
            '<div class="f"><label for="obSalary">Stipendio netto</label><input class="big" id="obSalary" inputmode="decimal" placeholder="1.800"></div>' +
            '<div class="f"><label for="obEnd">Prossimo stipendio</label><input id="obEnd" type="date"></div>' +
          '</div>' +
          '<div class="grid2">' +
            '<div class="f"><label for="obFixed">Spese fisse</label><input id="obFixed" inputmode="decimal" placeholder="0"></div>' +
            '<div class="f"><label for="obSave">Da parte</label><input id="obSave" inputmode="decimal" placeholder="0"></div>' +
          '</div>' +
          '<div><button class="solid accent" type="submit">Calcola</button></div>' +
        '</form>';
      el("obEnd").value = addMonth(todayISO());
      el("obForm").addEventListener("submit", function (ev) {
        ev.preventDefault();
        applySettings("ob");
      });
    }
    el("chartNote").innerHTML = '<span class="tag">Esempio</span> così si leggerà';
    el("forecastFoot").hidden = true;
    drawChart(model(EXAMPLE, EXAMPLE_EXPENSES, todayISO()), true);
  }

  var PILL = {
    good: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.6l3 3L13 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.6l5.6 10.2H2.4L8 2.6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.6v2.6M8 11.1v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    crit: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.1" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.9v3.6M8 10.9v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    flat: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
  };

  function heroLive(m) {
    setMode("live");
    el("addForm").hidden = m.isPayday || todayISO() < m.start;
    el("exDate").min = m.start;
    el("exDate").max = todayISO();
    el("today").hidden = false;
    if (heroMode !== "live") {
      heroMode = "live";
      el("hero").innerHTML =
        '<div class="payday" id="paydayBox" hidden>' +
          '<p><strong>È arrivato il giorno dello stipendio.</strong> Chiudi il periodo per ripartire.</p>' +
          '<button class="solid accent" type="button" id="paydayBtn">Nuovo periodo</button>' +
        '</div>' +
        '<p class="eyebrow" id="hEyebrow">Puoi spendere oggi</p>' +
        '<p class="figure"><span class="cur">€</span><span id="hFig">0</span></p>' +
        '<p class="sub" id="hSub"></p>';
      el("paydayBtn").addEventListener("click", newPeriod);
    }

    el("paydayBox").hidden = !m.isPayday;
    var fig = m.allowance;
    el("hEyebrow").textContent = "Ti restano oggi";
    el("hFig").parentElement.classList.toggle("compact", figure(fig).length > 6);
    tween(el("hFig"), lastFigure, fig);
    lastFigure = fig;

    var endTxt = DAY.format(parseD(m.end));
    el("hSub").textContent = m.left > 0
      ? "Restano " + EUR0.format(Math.max(0, m.rest)) + " per " + m.left + (m.left === 1 ? " giorno" : " giorni") + ", fino al " + endTxt + "."
      : "Il periodo è finito: il prossimo stipendio era previsto il " + endTxt + ".";

    if (m.left > 1 && todayISO() >= m.start) {
      el("hSub").textContent += " Da domani " + EUR2.format(m.tomorrow) + " al giorno se oggi ti fermi qui.";
    }
    el("chartNote").textContent = m.burn > 0
      ? "ritmo " + EUR0.format(m.burn) + " al giorno"
      : (m.onceTotal > 0 ? "nessuna spesa di tutti i giorni" : "nessuna spesa");
    el("forecastFoot").hidden = false;
    renderForecastFoot(m);
  }

  function renderForecastFoot(m) {
    if (!footBuilt) {
      footBuilt = true;
      el("forecastFoot").innerHTML =
        '<span class="pill" id="hPill"></span>' +
        '<div class="meter">' +
          '<div class="meter-track"><div class="meter-fill" id="hFill" style="width:0"></div><div class="meter-tick" id="hTick" hidden></div></div>' +
          '<div class="meter-legend"><span id="hL1"></span><span id="hL2"></span></div>' +
        '</div>' +
        '<dl class="stats">' +
          '<div class="stat"><dt>Restano</dt><dd id="sRest">—</dd></div>' +
          '<div class="stat"><dt>Giorni</dt><dd id="sDays">—</dd></div>' +
          '<div class="stat"><dt>Risparmio previsto</dt><dd id="sSave">—</dd></div>' +
        '</dl>' +
        '<p class="hint" id="hOnce" hidden></p>';
    }

    var kind, txt;
    if (m.over) { kind = "crit"; txt = "Hai superato il budget di <b>" + EUR0.format(-m.rest) + "</b>"; }
    else if (m.delta < -m.budget * 0.04) { kind = "warn"; txt = "Sopra il ritmo di <b>" + EUR0.format(-m.delta) + "</b>"; }
    else if (m.delta > m.budget * 0.04) { kind = "good"; txt = "Sotto il ritmo di <b>" + EUR0.format(m.delta) + "</b>"; }
    else { kind = "flat"; txt = "In linea con il ritmo"; }
    var pill = el("hPill");
    pill.className = "pill " + kind;
    pill.innerHTML = PILL[kind] + "<span>" + txt + "</span>";

    var usedPct = m.budget > 0 ? Math.min(100, Math.max(0, m.spent / m.budget * 100)) : 0;
    var expPct = m.budget > 0 ? Math.min(100, Math.max(0, m.expected / m.budget * 100)) : 0;
    var fill = el("hFill");
    fill.style.width = usedPct + "%";
    fill.className = "meter-fill" + (m.over ? " crit" : (m.delta < -m.budget * 0.04 ? " warn" : ""));
    var tick = el("hTick");
    tick.hidden = false;
    tick.style.left = "calc(" + expPct + "% - 1px)";
    tick.title = "dove dovresti essere";
    el("hL1").textContent = "Spesi " + EUR0.format(m.spent) + " di " + EUR0.format(m.budget);
    el("hL2").textContent = "al ritmo saresti a " + EUR0.format(m.expected);

    var once = el("hOnce");
    once.hidden = !(m.onceTotal > 0);
    if (m.onceTotal > 0) {
      once.textContent = "Di cui " + EUR0.format(m.onceTotal) + " di spese una tantum, tolte dal budget ma escluse dal ritmo: "
        + EUR0.format(m.ordBudget) + " da spendere nei " + m.total + " giorni.";
    }

    el("sRest").textContent = EUR0.format(m.rest);
    el("sDays").innerHTML = m.left + '<small>su ' + m.total + "</small>";
    var saved = S.set.salary - S.set.fixed - m.budget + m.projEnd;
    el("sSave").innerHTML = EUR0.format(saved) + "<small>obiettivo " + EUR0.format(S.set.aside) + "</small>";
  }

  /* ============ grafico ============ */
  var CH = { m: null, geo: null, example: false, w: 0, h: 0 };

  function hostSize() {
    var host = el("chartHost");
    return {
      w: Math.max(300, Math.min(900, Math.round(host.clientWidth || 700))),
      h: Math.max(170, Math.min(460, Math.round(host.clientHeight || 230)))
    };
  }

  function redrawChartIfResized() {
    if (!CH.m || el("sc1").hidden) return;
    var s = hostSize();
    if (Math.abs(s.w - CH.w) > 2 || Math.abs(s.h - CH.h) > 2) drawChart(CH.m, CH.example);
  }

  function drawChart(m, isExample) {
    var host = el("chartHost");
    // il viewBox segue i px reali del contenitore: il testo resta della stessa misura ovunque
    var sz = hostSize(), W = sz.w, H = sz.h;
    var narrow = W < 460;
    var PT = 24, PB = 30, PL = 14, PR = 16;
    var iw = W - PL - PR, ih = H - PT - PB;
    var yMax = Math.max(m.budget, 1);
    var floor = Math.max(m.budget * 0.06, 10);
    var yMin = Math.min(0, m.projEnd, m.rest) - floor;
    if (yMin > -1) yMin = -floor;
    function X(i) { return PL + (i / m.total) * iw; }
    function Y(v) { return PT + (1 - (v - yMin) / (yMax - yMin)) * ih; }

    var act = [{ i: 0, v: m.budget }], run = m.budget;
    for (var i = 0; i < m.elapsed; i++) { run -= m.perDay[i]; act.push({ i: i + 1, v: run }); }
    var cut = m.elapsed;

    var proj = [];
    if (m.left > 0) { proj.push({ i: cut, v: m.rest }); proj.push({ i: m.total, v: m.projEnd }); }
    var projBad = m.projEnd < 0;

    function path(pts) {
      return pts.map(function (p, k) { return (k ? "L" : "M") + X(p.i).toFixed(1) + " " + Y(p.v).toFixed(1); }).join(" ");
    }
    var base = Y(Math.max(0, yMin)).toFixed(1);
    var area = path(act) + " L" + X(cut).toFixed(1) + " " + base + " L" + X(0).toFixed(1) + " " + base + " Z";
    var FF = 'font-family="Figtree,system-ui,sans-serif"';

    var g = [];
    if (yMin < 0) {
      g.push('<rect x="' + PL + '" y="' + Y(0).toFixed(1) + '" width="' + iw + '" height="' + (Y(yMin) - Y(0)).toFixed(1) + '" fill="var(--crit)" opacity=".055"/>');
    }
    [yMax, yMax / 2, 0].forEach(function (v) {
      g.push('<line x1="' + PL + '" y1="' + Y(v).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + Y(v).toFixed(1) + '" stroke="var(--hair)" stroke-width="1"/>');
      g.push('<text x="' + (PL + 2) + '" y="' + (Y(v) - 6).toFixed(1) + '" font-size="10.5" fill="var(--ink3)" ' + FF + '>' + (v === 0 ? "0 €" : EUR0.format(v)) + '</text>');
    });
    g.push('<path d="' + path(m.ideal) + '" fill="none" stroke="var(--ink3)" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/>');
    g.push('<path d="' + area + '" fill="var(--accent)" opacity=".13"/>');
    g.push('<path d="' + path(act) + '" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>');
    if (proj.length) {
      g.push('<path d="' + path(proj) + '" fill="none" stroke="' + (projBad ? "var(--crit)" : "var(--accent)") + '" stroke-width="2.2" stroke-dasharray="6 5" stroke-linecap="round" opacity=".9"/>');
    }
    if (m.zero != null && m.zero < m.total - 0.3 && m.left > 0) {
      var zx = X(m.zero), late = m.zero > m.total * 0.68;
      g.push('<line x1="' + zx.toFixed(1) + '" y1="' + Y(0).toFixed(1) + '" x2="' + zx.toFixed(1) + '" y2="' + (Y(0) + 15).toFixed(1) + '" stroke="var(--crit)" stroke-width="1.5" stroke-dasharray="2 3"/>');
      g.push('<circle cx="' + zx.toFixed(1) + '" cy="' + Y(0).toFixed(1) + '" r="3.4" fill="var(--crit)" stroke="var(--bg)" stroke-width="2"/>');
      g.push('<text x="' + (zx + (late ? -8 : 8)).toFixed(1) + '" y="' + (Y(0) + 19).toFixed(1) + '" font-size="11" font-weight="600" fill="var(--crit)" text-anchor="' + (late ? "end" : "start") + '" ' + FF + '>a secco il ' + DAY.format(parseD(shiftD(m.start, Math.round(m.zero) - 1))) + '</text>');
    }
    var cx = X(cut), cy = Y(act[act.length - 1].v);
    g.push('<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="4.6" fill="var(--accent)" stroke="var(--bg)" stroke-width="2.4"/>');
    if (cut > m.total * 0.12 && cut < m.total * 0.88) {
      g.push('<text x="' + cx.toFixed(1) + '" y="' + (PT - 9) + '" font-size="11" font-weight="600" fill="var(--ink2)" text-anchor="middle" ' + FF + '>oggi</text>');
    }
    g.push('<text x="' + PL + '" y="' + (H - 9) + '" font-size="11" fill="var(--ink3)" ' + FF + '>' + DAY.format(parseD(m.start)) + '</text>');
    g.push('<text x="' + (W - PR) + '" y="' + (H - 9) + '" font-size="11" fill="var(--ink3)" text-anchor="end" ' + FF + '>' + DAY.format(parseD(m.end)) + (narrow ? '' : ' · stipendio') + '</text>');
    g.push('<line id="chX" x1="0" y1="' + PT + '" x2="0" y2="' + (PT + ih) + '" stroke="var(--ink2)" stroke-width="1" opacity="0"/>');
    g.push('<circle id="chD" cx="0" cy="0" r="4.2" fill="var(--ink)" stroke="var(--bg)" stroke-width="2" opacity="0"/>');
    g.push('<rect id="chHit" x="' + PL + '" y="' + PT + '" width="' + iw + '" height="' + ih + '" fill="transparent" style="cursor:crosshair"/>');

    Array.prototype.forEach.call(host.querySelectorAll("svg"), function (n) { n.remove(); });
    host.insertAdjacentHTML("afterbegin",
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Soldi che restano giorno per giorno, con il ritmo ideale e la previsione fino al prossimo stipendio">' + g.join("") + '</svg>');

    el("keys").innerHTML =
      '<span><i style="border-color:var(--accent)"></i>Reale</span>' +
      '<span><i style="border-color:' + (projBad ? "var(--crit)" : "var(--accent)") + ';border-top-style:dashed"></i>Previsione</span>' +
      '<span><i style="border-color:var(--ink3);border-top-style:dotted"></i>Ritmo ideale</span>';

    CH.m = m; CH.example = !!isExample; CH.w = W; CH.h = H;
    CH.geo = { W: W, H: H, PL: PL, PT: PT, ih: ih, iw: iw, X: X, Y: Y, act: act, cut: cut };
    wireHover();
  }

  function wireHover() {
    var hit = el("chHit"); if (!hit) return;
    var svg = hit.ownerSVGElement, tip = el("tip"), xl = el("chX"), dt = el("chD");
    var m = CH.m, G = CH.geo;
    function off() { tip.classList.remove("on"); xl.setAttribute("opacity", "0"); dt.setAttribute("opacity", "0"); }
    function move(ev) {
      var r = svg.getBoundingClientRect();
      var px = (ev.clientX - r.left) / r.width * G.W;
      var i = Math.max(1, Math.min(m.total, Math.round((px - G.PL) / G.iw * m.total)));
      var v, extra;
      if (i <= G.cut) {
        v = G.act[i].v;
        extra = m.perDay[i - 1] > 0 ? "spesi " + EUR2.format(m.perDay[i - 1]) : "nessuna spesa";
      } else {
        var t = (i - G.cut) / Math.max(1, m.total - G.cut);
        v = m.rest + (m.projEnd - m.rest) * t;
        extra = "previsione";
      }
      var cx = G.X(i), cy = G.Y(v);
      xl.setAttribute("x1", cx); xl.setAttribute("x2", cx); xl.setAttribute("opacity", ".3");
      dt.setAttribute("cx", cx); dt.setAttribute("cy", cy); dt.setAttribute("opacity", "1");
      tip.innerHTML = "<b>" + esc(cap(DAY.format(parseD(shiftD(m.start, i - 1))))) + "</b>" +
        "<span>" + EUR0.format(v) + "</span><em>" + esc(extra) + "</em>";
      tip.classList.add("on");
      var hostR = el("chartHost").getBoundingClientRect();
      var left = (cx / G.W) * r.width + (r.left - hostR.left);
      var top = (cy / G.H) * r.height + (r.top - hostR.top) - 12;
      tip.style.left = Math.max(66, Math.min(hostR.width - 66, left)) + "px";
      tip.style.top = Math.max(50, top) + "px";
    }
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", off);
    hit.addEventListener("pointercancel", off);
  }

  /* ============ righe di spesa ============ */
  function rowHTML(e, withDay) {
    var when = "";
    if (withDay) {
      var t = todayISO(), y = shiftD(t, -1);
      var lbl = e.date === t ? "oggi" : (e.date === y ? "ieri" : DAY.format(parseD(e.date)));
      when = '<em class="when">' + esc(lbl) + '</em>';
    }
    if (e.oneOff) when += '<em class="once">una tantum</em>';
    return '<div class="row"><span class="nm">' + esc(e.note || "Spesa") + when + '</span>' +
      '<span class="amt-v">' + EUR2.format(e.amount) + '</span>' +
      '<button class="del" type="button" data-id="' + esc(e.id) + '" aria-label="Elimina ' + esc(e.note || "spesa") + '">×</button></div>';
  }
  function byNewest(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }

  /* ============ spese di oggi (prima schermata) ============ */
  function renderToday(m) {
    var box = el("today");
    var t = todayISO();
    var mine = m.inPeriod.filter(function (e) { return e.date === t; }).sort(byNewest);
    if (mine.length) {
      var tot = mine.reduce(function (a, e) { return a + e.amount; }, 0);
      box.innerHTML = '<div class="today-head"><h3>Segnate oggi</h3><span class="tot">' + EUR2.format(tot) + '</span></div>' +
        mine.map(function (e) { return rowHTML(e, false); }).join("");
      return;
    }
    var last = m.inPeriod.slice().sort(byNewest).slice(0, 5);
    if (last.length) {
      box.innerHTML = '<div class="today-head"><h3>Ultime spese</h3><span class="tot">niente oggi</span></div>' +
        last.map(function (e) { return rowHTML(e, true); }).join("");
      return;
    }
    box.innerHTML = '<p class="empty">Niente ancora. Segna qui sotto la prima spesa: quanto hai speso e che cos\'è.</p>';
  }

  /* ============ lista spese ============ */
  function renderList(m) {
    var box = el("list");
    if (!m.inPeriod.length) {
      box.innerHTML = '<p class="empty">Ancora nessuna spesa in questo periodo. Segnale dalla prima schermata.</p>';
      el("listTotal").textContent = "";
      return;
    }
    var byDay = {};
    m.inPeriod.forEach(function (e) { (byDay[e.date] = byDay[e.date] || []).push(e); });
    var t = todayISO(), y = shiftD(t, -1);
    box.innerHTML = Object.keys(byDay).sort().reverse().map(function (d) {
      var items = byDay[d].slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      var tot = items.reduce(function (a, e) { return a + e.amount; }, 0);
      var lbl = d === t ? "Oggi" : (d === y ? "Ieri" : cap(DAYLONG.format(parseD(d))));
      return '<div class="day"><div class="day-head"><h3>' + esc(lbl) + '</h3><span class="tot">' + EUR2.format(tot) + '</span></div>' +
        items.map(function (e) { return rowHTML(e, false); }).join("") + '</div>';
    }).join("");
    el("listTotal").textContent = m.inPeriod.length + (m.inPeriod.length === 1 ? " spesa · " : " spese · ") + EUR2.format(m.spent);
  }

  /* ============ risparmi storici ============ */
  function renderSaved() {
    var list = S.per.filter(function (p) { return p && isFinite(+p.saved); });
    var box = el("savedBars");
    if (!list.length) {
      el("savedTotal").textContent = "";
      box.innerHTML = '<p class="empty">Qui finisce quello che metti da parte. Il primo importo compare quando chiudi un periodo, cioè quando arriva lo stipendio nuovo.</p>';
      return;
    }
    var max = Math.max.apply(null, list.map(function (p) { return p.saved; }).concat([1]));
    var tot = list.reduce(function (a, p) { return a + p.saved; }, 0);
    el("savedTotal").textContent = "totale " + EUR0.format(tot);
    box.innerHTML = '<div class="bars">' + list.slice(0, 24).map(function (p) {
      var w = Math.max(0, p.saved / max * 100);
      return '<div class="bar"><span class="lb">' + esc(MON.format(parseD(p.end || p.start))) + '</span>' +
        '<span class="tr"><span class="fl" style="width:' + w.toFixed(1) + '%"></span></span>' +
        '<span class="vl">' + EUR0.format(p.saved) + '</span></div>';
    }).join("") + '</div>';
  }

  /* ============ render ============ */
  function render() {
    if (!S.set) { heroOnboarding(); renderSaved(); return; }
    var m = model(S.set, S.exp, todayISO());
    heroLive(m);
    renderToday(m);
    drawChart(m, false);
    renderList(m);
    renderSaved();
  }

  /* ============ azioni ============ */
  function toast(msg, actionLabel, fn) {
    var t = el("toast");
    t.innerHTML = '<span>' + esc(msg) + '</span>' +
      (actionLabel ? '<button class="link" type="button" id="toastBtn">' + esc(actionLabel) + '</button>' : "");
    t.hidden = false;
    if (actionLabel) el("toastBtn").onclick = function () { t.hidden = true; clearTimeout(t._k); if (fn) fn(); };
    clearTimeout(t._k);
    t._k = setTimeout(function () { t.hidden = true; }, 5200);
  }

  var openedSettings;
  async function applySettings(prefix) {
    var salary = moneyField(prefix + "Salary", false);
    if (!isFinite(salary)) return;
    var fixed = moneyField(prefix + "Fixed", true);
    if (!isFinite(fixed)) return;
    var aside = moneyField(prefix + "Save", true);
    if (!isFinite(aside)) return;
    var start = prefix === "ob" ? todayISO() : el("stStart").value;
    var end = el(prefix + "End").value;
    if (!validDate(start) || !validDate(end) || start > todayISO() || end <= start || (prefix === "ob" && end <= todayISO())) {
      toast("Controlla le date di inizio e del prossimo stipendio"); return;
    }
    var previous = prefix === "ob" ? "null" : openedSettings;
    var ok = await change(function (draft) {
      if (JSON.stringify(draft.set) !== previous) {
        toast("Il periodo è cambiato. Riapri le impostazioni."); return false;
      }
      // Per i vecchi riepiloghi end era la data prevista, anche chiudendo in anticipo.
      var last = draft.per[0];
      if (last && start < (last.closedAt ? iso(new Date(last.closedAt)) : last.end)) {
        toast("Questa data si sovrappone a un periodo chiuso"); return false;
      }
      draft.set = { salary: salary, fixed: fixed, aside: aside, start: start, end: end };
    });
    if (ok && prefix === "st") { closeSheet(); toast("Impostazioni salvate"); }
  }

  async function removeExpenses(ids) {
    var removed;
    var ok = await change(function (draft) {
      removed = draft.exp.filter(function (e) { return ids.has(e.id); });
      if (!removed.length) { toast("Nessuna spesa da eliminare"); return false; }
      draft.exp = draft.exp.filter(function (e) { return !ids.has(e.id); });
    });
    if (!ok) return;
    closeSheet();
    toast(removed.length === 1 ? "Eliminata " + EUR2.format(removed[0].amount) : removed.length + " spese cancellate", "Ripristina", function () {
      change(function (draft) {
        var existing = new Set(draft.exp.map(function (e) { return e.id; }));
        draft.exp = removed.filter(function (e) { return !existing.has(e.id); }).concat(draft.exp);
      });
    });
  }

  async function newPeriod() {
    var t = todayISO(), saved;
    var ok = await change(function (draft) {
      var s = draft.set;
      if (!s || s.start >= t) { toast("Il nuovo periodo è già aperto per oggi"); return false; }
      var closed = Object.assign({}, s, { end: t });
      var m = model(closed, draft.exp, t);
      var period = withActualSavings(Object.assign(closed, {
        budget: m.budget, spent: Math.round(m.spent * 100) / 100, closedAt: Date.now()
      }));
      saved = period.saved;
      draft.per.unshift(period);
      draft.per = draft.per.slice(0, 60);
      draft.set = Object.assign({}, s, { start: t, end: addMonth(t) });
    });
    if (ok) { closeSheet(); toast("Nuovo periodo aperto · saldo del periodo " + EUR2.format(saved)); }
  }

  /* ============ backup ============ */
  function exportData() {
    var blob = new Blob([JSON.stringify(snapshot(S), null, 2)],
      { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "quanto-posso-spendere-" + todayISO() + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast("File scaricato");
  }

  function validBackup(d) {
    function money(n) { return Number.isFinite(n) && n >= 0 && Number.isSafeInteger(Math.round(n * 100)); }
    function settings(s) {
      return s && money(s.salary) && money(s.fixed) && money(s.aside) &&
        validDate(s.start) && validDate(s.end) && s.start < s.end;
    }
    if (!d || d.v !== 1 || !(d.settings === null || settings(d.settings)) ||
        !Array.isArray(d.expenses) || !Array.isArray(d.periods)) return false;
    var ids = new Set();
    return d.expenses.every(function (e) {
      if (!e || typeof e.id !== "string" || !e.id || ids.has(e.id) || !validDate(e.date) ||
          !money(e.amount) || typeof e.note !== "string" || (e.oneOff !== undefined && typeof e.oneOff !== "boolean") ||
          !Number.isFinite(e.createdAt)) return false;
      ids.add(e.id); return true;
    }) && d.periods.every(function (p) {
      return settings(p) && money(p.spent) && money(p.budget) && Number.isFinite(p.saved) &&
        Number.isFinite(p.closedAt) && validDate(iso(new Date(p.closedAt)));
    });
  }
  async function importData(file) {
    var d;
    try { d = JSON.parse(await file.text()); }
    catch (err) { toast("Il file non è leggibile"); return; }
    if (!validBackup(d)) { toast("Backup non valido. I tuoi dati sono al sicuro."); return; }
    if (!window.confirm("Sostituire i dati attuali con " + d.expenses.length + " spese e " + d.periods.length + " periodi chiusi dal backup?")) return;
    var ok = await change(function (draft) {
      draft.set = d.settings && d.settings.salary > 0 ? normSettings(d.settings) : null;
      draft.exp = d.expenses.map(normExpense);
      draft.per = d.periods.map(withActualSavings);
    });
    if (ok) { closeSheet(); toast("Dati importati: " + d.expenses.length + " spese"); }
  }

  /* ============ impostazioni ============ */
  function openSheet() {
    openedSettings = JSON.stringify(S.set);
    var s = S.set || {};
    el("stSalary").value = dec(s.salary);
    el("stFixed").value = dec(s.fixed);
    el("stSave").value = dec(s.aside);
    el("stStart").value = s.start || todayISO();
    el("stEnd").value = s.end || addMonth(todayISO());
    el("sheet").hidden = false;
    setTimeout(function () { el("stSalary").focus(); }, 30);
  }
  function closeSheet() { el("sheet").hidden = true; }

  /* ============ tema (dalle impostazioni) ============ */
  var THEMES = ["auto", "light", "dark"];
  function applyTheme(t) {
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    Array.prototype.forEach.call(el("segTheme").children, function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-t") === t ? "true" : "false");
    });
  }
  function initTheme() {
    var t = "auto";
    try { t = localStorage.getItem(THEME_KEY) || "auto"; } catch (e) { }
    if (THEMES.indexOf(t) < 0) t = "auto";
    applyTheme(t);
    el("segTheme").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button[data-t]");
      if (!b) return;
      var v = b.getAttribute("data-t");
      applyTheme(v);
      try { localStorage.setItem(THEME_KEY, v); } catch (err) { }
    });
  }

  /* ============ eventi ============ */
  el("btnSettings").addEventListener("click", openSheet);
  el("stClose").addEventListener("click", closeSheet);
  el("sheet").addEventListener("click", function (e) { if (e.target === el("sheet")) closeSheet(); });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !el("sheet").hidden) { closeSheet(); return; }
    if (!el("sheet").hidden) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.key === "ArrowRight") { goTo(active + 1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { goTo(active - 1); e.preventDefault(); }
  });

  el("stApply").addEventListener("click", function () {
    applySettings("st");
  });
  el("stNewPeriod").addEventListener("click", newPeriod);
  el("stExport").addEventListener("click", exportData);
  el("stImport").addEventListener("click", function () { el("fileIn").click(); });
  el("fileIn").addEventListener("change", function () {
    if (this.files && this.files[0]) importData(this.files[0]);
    this.value = "";
  });
  el("stWipe").addEventListener("click", function () {
    if (!S.set) return;
    var m = model(S.set, S.exp, todayISO());
    if (!m.inPeriod.length) { toast("Non c'è niente da cancellare"); return; }
    removeExpenses(new Set(m.inPeriod.map(function (e) { return e.id; })));
  });

  var adding = false;
  el("addForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    if (adding) return;
    var a = moneyField("exAmt", false);
    if (!isFinite(a)) return;
    var note = el("exNote").value.trim(), once = el("exOnce").checked;
    var date = el("exDate").value || todayISO();
    adding = true;
    var ok = await change(function (draft) {
      if (!draft.set || !validDate(date) || date < draft.set.start || date >= draft.set.end || date > todayISO()) {
        toast("Scegli un giorno del periodo, fino a oggi"); return false;
      }
      draft.exp.unshift(normExpense({ id: uid(), amount: a, note: note, date: date, oneOff: once, createdAt: Date.now() }));
    });
    adding = false;
    if (!ok) return;
    el("exAmt").value = ""; el("exNote").value = ""; el("exDate").value = todayISO();
    el("exOnce").checked = false; syncChip();
    el("exAmt").focus();
    toast("Segnata " + EUR2.format(a) + (note ? " · " + note : "") + (once ? " · una tantum" : ""));
  });

  function syncChip() { el("onceChip").classList.toggle("on", el("exOnce").checked); }
  el("exOnce").addEventListener("change", syncChip);

  function onDelClick(e) {
    var b = e.target.closest && e.target.closest(".del");
    if (b) removeExpenses(new Set([b.getAttribute("data-id")]));
  }
  el("list").addEventListener("click", onDelClick);
  el("today").addEventListener("click", onDelClick);

  /* ============ avvio ============ */
  initTheme();
  el("exDate").value = todayISO();
  refresh();
  window.addEventListener("storage", function (e) {
    if (e.key === KEY || e.key === null) refresh();
  });

  // il giorno cambia mentre l'app è aperta: ricalcola al rientro
  var bootDay = todayISO();
  window.addEventListener("focus", function () {
    if (todayISO() !== bootDay) { bootDay = todayISO(); el("exDate").value = bootDay; }
    refresh();
  });

  // il grafico usa px reali: va ridisegnato quando cambia la misura del contenitore
  var rz;
  function scheduleRedraw() { clearTimeout(rz); rz = setTimeout(redrawChartIfResized, 120); }
  window.addEventListener("resize", scheduleRedraw);
  window.addEventListener("load", scheduleRedraw);
  if (window.ResizeObserver) new ResizeObserver(scheduleRedraw).observe(el("chartHost"));

  /* ============ aggiornamenti ============
     Senza questo, una versione nuova resta invisibile finché l'utente non
     ricarica a mano: il service worker serve CSS e JS dalla cache. */
  if ("serviceWorker" in navigator) {
    var hadController = !!navigator.serviceWorker.controller, reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      // al primo avvio non c'era nessun controller: non è un aggiornamento, non ricaricare
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        // controlla se c'è una versione nuova a ogni rientro nell'app
        window.addEventListener("focus", function () { reg.update().catch(function () { }); });
      }).catch(function () { });
    });
  }
})();
