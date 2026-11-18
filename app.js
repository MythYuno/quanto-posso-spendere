/* Quanto posso spendere — logica dell'app.
   Nessuna dipendenza. I dati stanno in localStorage, solo in questo browser. */
(function () {
  "use strict";

  /* ============ formati e date ============ */
  var EUR0 = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  var EUR2 = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var N0 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
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
    var s = String(v == null ? "" : v).trim().replace(/[^\d.,\-]/g, "");
    if (!s) return NaN;
    if (s.indexOf(",") > -1 && s.indexOf(".") > -1) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(",", ".");
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
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
  var S = { set: null, exp: [], per: [], canSave: true };

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { S.canSave = false; }
    if (!raw) return;
    try {
      var d = JSON.parse(raw);
      if (d && typeof d === "object") {
        S.set = d.settings && +d.settings.salary > 0 ? normSettings(d.settings) : null;
        S.exp = Array.isArray(d.expenses) ? d.expenses.map(normExpense).filter(Boolean) : [];
        S.per = Array.isArray(d.periods) ? d.periods : [];
      }
    } catch (e) { /* dato illeggibile: si riparte da zero senza cancellarlo */ }
  }
  function save() {
    if (!S.canSave) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, settings: S.set, expenses: S.exp, periods: S.per }));
    } catch (e) {
      S.canSave = false;
      toast("Questo browser non salva i dati (navigazione privata?)");
    }
  }
  function normSettings(s) {
    var start = s.start || todayISO();
    var end = s.end && diffDays(start, s.end) >= 1 ? s.end : addMonth(start);
    return {
      salary: +s.salary || 0, fixed: +s.fixed || 0, aside: +s.aside || 0,
      start: start, end: end
    };
  }
  function normExpense(e) {
    if (!e || !isFinite(+e.amount)) return null;
    return {
      id: e.id || uid(), amount: Math.round(+e.amount * 100) / 100,
      note: String(e.note || "").slice(0, 60), date: e.date || todayISO(),
      createdAt: +e.createdAt || 0
    };
  }

  /* ============ calcolo ============ */
  function model(set, exps, today) {
    var start = set.start, end = set.end;
    var total = Math.max(1, diffDays(start, end));              // giorni del periodo
    var idx = Math.min(total, Math.max(0, diffDays(start, today)));
    var left = Math.max(0, total - idx);                        // giorni rimasti, oggi incluso
    var budget = Math.max(0, (set.salary || 0) - (set.fixed || 0) - (set.aside || 0));

    var inPeriod = exps.filter(function (e) { return e.date >= start && e.date < end; });
    var spent = inPeriod.reduce(function (a, e) { return a + e.amount; }, 0);
    var rest = budget - spent;

    var perDay = [];
    for (var i = 0; i < total; i++) perDay.push(0);
    inPeriod.forEach(function (e) {
      var k = diffDays(start, e.date);
      if (k >= 0 && k < total) perDay[k] += e.amount;
    });

    var elapsed = Math.min(total, idx + 1);                     // giorni iniziati, oggi incluso
    var burn = elapsed > 0 ? spent / elapsed : 0;
    var expected = budget * (elapsed / total);
    var delta = expected - spent;                               // >0 = sotto il ritmo
    var allowance = left > 0 ? rest / left : rest;
    var projEnd = rest - burn * Math.max(0, left - 1);
    var zero = burn > 0 && rest >= 0 ? elapsed + rest / burn : null;

    return {
      start: start, end: end, total: total, idx: idx, left: left, elapsed: elapsed,
      budget: budget, spent: spent, rest: rest, perDay: perDay, inPeriod: inPeriod,
      burn: burn, expected: expected, delta: delta,
      allowance: Math.max(0, allowance), over: rest < 0,
      projEnd: projEnd, zero: zero, isPayday: diffDays(start, today) >= total
    };
  }

  /* ============ eroe ============ */
  var lastFigure = null, heroMode = "";

  function tween(node, from, to) {
    if (RM || from == null || !isFinite(from)) { node.textContent = N0.format(Math.round(to)); return; }
    var t0 = performance.now(), d = 460;
    (function step(t) {
      var k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3);
      node.textContent = N0.format(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  // periodo finto usato solo per far vedere come si legge il grafico prima del primo inserimento
  var EXAMPLE = { salary: 1800, fixed: 620, aside: 150, start: shiftD(todayISO(), -11), end: shiftD(todayISO(), 19) };
  var EXAMPLE_EXPENSES = [52.4, 18.9, 9.5, 64, 27.3, 12.5, 48.7, 21, 73.5, 15.2, 56.8, 30.4]
    .map(function (a, i) { return { id: "x" + i, amount: a, note: "", date: shiftD(EXAMPLE.start, i), createdAt: i }; });

  function heroOnboarding() {
    if (heroMode !== "onboard") {
      heroMode = "onboard";
      el("hero").innerHTML =
        '<p class="eyebrow">Si parte</p>' +
        '<h1 class="lede">Dimmi lo stipendio e quando arriva il prossimo.</h1>' +
        '<p class="sub">Togliamo le spese fisse e il risparmio, dividiamo il resto per i giorni che mancano. Poi ogni giorno sai quanto puoi spendere.</p>' +
        '<form id="obForm" autocomplete="off" style="margin-top:24px;display:flex;flex-direction:column;gap:14px">' +
          '<div class="grid2">' +
            '<div class="f"><label for="obSalary">Stipendio netto</label><input class="big" id="obSalary" inputmode="decimal" placeholder="1.800"></div>' +
            '<div class="f"><label for="obEnd">Prossimo stipendio</label><input id="obEnd" type="date"></div>' +
          '</div>' +
          '<div class="grid2">' +
            '<div class="f"><label for="obFixed">Spese fisse <span class="plain">(opzionale)</span></label><input id="obFixed" inputmode="decimal" placeholder="affitto, bollette…"></div>' +
            '<div class="f"><label for="obSave">Da mettere da parte <span class="plain">(opzionale)</span></label><input id="obSave" inputmode="decimal" placeholder="0"></div>' +
          '</div>' +
          '<div><button class="solid accent" type="submit">Calcola</button></div>' +
        '</form>';
      el("obEnd").value = addMonth(todayISO());
      el("obForm").addEventListener("submit", function (ev) {
        ev.preventDefault();
        var sal = num(el("obSalary").value);
        if (!isFinite(sal) || sal <= 0) { el("obSalary").focus(); return; }
        var end = el("obEnd").value || "";
        if (!end || diffDays(todayISO(), end) < 1) end = addMonth(todayISO());
        setSettings({
          salary: sal,
          fixed: Math.max(0, num(el("obFixed").value) || 0),
          aside: Math.max(0, num(el("obSave").value) || 0),
          start: todayISO(), end: end
        });
      });
    }
    el("addPanel").hidden = true;
    el("listCard").hidden = true;
    el("chartCard").hidden = false;
    el("chartNote").innerHTML = '<span class="tag">Esempio</span> così si leggerà';
    drawChart(model(EXAMPLE, EXAMPLE_EXPENSES, todayISO()), true);
    el("foot").textContent = S.canSave
      ? "I dati restano su questo dispositivo, nel tuo browser."
      : "Attenzione: questo browser non salva nulla, i dati andranno persi.";
  }

  var PILL = {
    good: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.6l3 3L13 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.6l5.6 10.2H2.4L8 2.6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.6v2.6M8 11.1v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    crit: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.1" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.9v3.6M8 10.9v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    flat: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
  };

  function heroLive(m) {
    if (heroMode !== "live") {
      heroMode = "live";
      el("hero").innerHTML =
        '<div class="payday" id="paydayBox" hidden>' +
          '<p><strong>È arrivato il giorno dello stipendio.</strong> Chiudi il periodo per ripartire con i giorni giusti.</p>' +
          '<button class="solid accent" type="button" id="paydayBtn">Nuovo periodo</button>' +
        '</div>' +
        '<p class="eyebrow" id="hEyebrow">Puoi spendere oggi</p>' +
        '<p class="figure"><span class="cur">€</span><span id="hFig">0</span></p>' +
        '<p class="sub" id="hSub"></p>' +
        '<span class="pill" id="hPill"></span>' +
        '<div class="meter">' +
          '<div class="meter-track"><div class="meter-fill" id="hFill" style="width:0"></div><div class="meter-tick" id="hTick" hidden></div></div>' +
          '<div class="meter-legend"><span id="hL1"></span><span id="hL2"></span></div>' +
        '</div>' +
        '<dl class="stats">' +
          '<div class="stat"><dt>Restano</dt><dd id="sRest">—</dd></div>' +
          '<div class="stat"><dt>Giorni</dt><dd id="sDays">—</dd></div>' +
          '<div class="stat"><dt>Risparmio previsto</dt><dd id="sSave">—</dd></div>' +
        '</dl>';
      el("paydayBtn").addEventListener("click", newPeriod);
    }

    el("paydayBox").hidden = !m.isPayday;

    var fig = Math.floor(m.allowance);
    el("hEyebrow").textContent = m.over ? "Sei oltre il budget" : "Puoi spendere oggi";
    tween(el("hFig"), lastFigure, fig);
    lastFigure = fig;

    var endTxt = DAY.format(parseD(m.end));
    el("hSub").textContent = m.left > 0
      ? "Restano " + EUR0.format(Math.max(0, m.rest)) + " per " + m.left + (m.left === 1 ? " giorno" : " giorni") + ", fino al " + endTxt + "."
      : "Il periodo è finito: il prossimo stipendio era previsto il " + endTxt + ".";

    var kind, txt;
    if (m.over) { kind = "crit"; txt = "Hai superato il budget di <b>" + EUR0.format(-m.rest) + "</b>"; }
    else if (m.delta < -m.budget * 0.04) { kind = "warn"; txt = "Sopra il ritmo di <b>" + EUR0.format(-m.delta) + "</b>"; }
    else if (m.delta > m.budget * 0.04) { kind = "good"; txt = "Sotto il ritmo di <b>" + EUR0.format(m.delta) + "</b>"; }
    else { kind = "flat"; txt = "In linea con il ritmo"; }
    var pill = el("hPill");
    pill.className = "pill " + kind;
    pill.innerHTML = PILL[kind] + "<span>" + txt + "</span>";

    var usedPct = m.budget > 0 ? Math.min(100, Math.max(0, m.spent / m.budget * 100)) : 0;
    var timePct = Math.min(100, m.elapsed / m.total * 100);
    var fill = el("hFill");
    fill.style.width = usedPct + "%";
    fill.className = "meter-fill" + (m.over ? " crit" : (m.delta < -m.budget * 0.04 ? " warn" : ""));
    var tick = el("hTick");
    tick.hidden = false;
    tick.style.left = "calc(" + timePct + "% - 1px)";
    tick.title = "dove dovresti essere";
    el("hL1").textContent = "Spesi " + EUR0.format(m.spent) + " di " + EUR0.format(m.budget);
    el("hL2").textContent = Math.round(timePct) + "% del periodo passato";

    el("sRest").textContent = EUR0.format(m.rest);
    el("sDays").innerHTML = m.left + '<small>su ' + m.total + " del periodo</small>";
    var saved = (S.set.aside || 0) + Math.max(0, m.projEnd);
    el("sSave").innerHTML = EUR0.format(saved) + '<small>' +
      (m.projEnd >= 1
        ? EUR0.format(S.set.aside || 0) + " + " + EUR0.format(m.projEnd) + " di avanzo"
        : "di cui programmato " + EUR0.format(S.set.aside || 0)) + "</small>";

    el("addPanel").hidden = false;
    el("chartCard").hidden = false;
    el("listCard").hidden = false;
    el("chartNote").textContent = m.burn > 0 ? "ritmo attuale " + EUR0.format(m.burn) + " al giorno" : "nessuna spesa registrata";
    el("foot").textContent = "Periodo dal " + DAY.format(parseD(m.start)) + " al " + endTxt +
      " · " + EUR0.format(S.set.salary || 0) + " di stipendio, " + EUR0.format((S.set.fixed || 0) + (S.set.aside || 0)) + " trattenuti";
  }

  /* ============ grafico ============ */
  var CH = { m: null, geo: null, example: false, width: 0 };

  function redrawChartIfResized() {
    if (!CH.m || el("chartCard").hidden) return;
    var host = el("chartHost");
    var w = Math.max(320, Math.min(760, Math.round(host.clientWidth || 760)));
    if (Math.abs(w - CH.width) > 2) drawChart(CH.m, CH.example);
  }

  function drawChart(m, isExample) {
    var host = el("chartHost");
    // il viewBox segue la larghezza reale: così 11px di testo restano 11px anche sul telefono
    var W = Math.max(320, Math.min(760, Math.round(host.clientWidth || 760)));
    var narrow = W < 460;
    var H = 250, PT = 28, PB = 34, PL = 14, PR = 16;
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

    var g = [];
    if (yMin < 0) {
      g.push('<rect x="' + PL + '" y="' + Y(0).toFixed(1) + '" width="' + iw + '" height="' + (Y(yMin) - Y(0)).toFixed(1) + '" fill="var(--crit)" opacity=".055"/>');
    }
    [yMax, yMax / 2, 0].forEach(function (v) {
      g.push('<line x1="' + PL + '" y1="' + Y(v).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + Y(v).toFixed(1) + '" stroke="var(--hair)" stroke-width="1"/>');
      g.push('<text x="' + (PL + 2) + '" y="' + (Y(v) - 7).toFixed(1) + '" font-size="11" fill="var(--ink3)" font-family="Figtree,system-ui,sans-serif">' + (v === 0 ? "0 €" : EUR0.format(v)) + '</text>');
    });
    g.push('<line x1="' + X(0).toFixed(1) + '" y1="' + Y(m.budget).toFixed(1) + '" x2="' + X(m.total).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="var(--ink3)" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round" opacity=".75"/>');
    g.push('<path d="' + area + '" fill="var(--accent)" opacity=".13"/>');
    g.push('<path d="' + path(act) + '" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>');
    if (proj.length) {
      g.push('<path d="' + path(proj) + '" fill="none" stroke="' + (projBad ? "var(--crit)" : "var(--accent)") + '" stroke-width="2.2" stroke-dasharray="6 5" stroke-linecap="round" opacity=".9"/>');
    }
    if (m.zero != null && m.zero < m.total - 0.3 && m.left > 0) {
      var zx = X(m.zero), late = m.zero > m.total * 0.68;
      g.push('<line x1="' + zx.toFixed(1) + '" y1="' + Y(0).toFixed(1) + '" x2="' + zx.toFixed(1) + '" y2="' + (Y(0) + 16).toFixed(1) + '" stroke="var(--crit)" stroke-width="1.5" stroke-dasharray="2 3"/>');
      g.push('<circle cx="' + zx.toFixed(1) + '" cy="' + Y(0).toFixed(1) + '" r="3.6" fill="var(--crit)" stroke="var(--bg)" stroke-width="2"/>');
      g.push('<text x="' + (zx + (late ? -9 : 9)).toFixed(1) + '" y="' + (Y(0) + 20).toFixed(1) + '" font-size="11.5" font-weight="600" fill="var(--crit)" text-anchor="' + (late ? "end" : "start") + '" font-family="Figtree,system-ui,sans-serif">a secco il ' + DAY.format(parseD(shiftD(m.start, Math.round(m.zero) - 1))) + '</text>');
    }
    var cx = X(cut), cy = Y(act[act.length - 1].v);
    g.push('<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="5" fill="var(--accent)" stroke="var(--bg)" stroke-width="2.4"/>');
    if (cut > m.total * 0.12 && cut < m.total * 0.88) {
      g.push('<text x="' + cx.toFixed(1) + '" y="' + (PT - 11) + '" font-size="11.5" font-weight="600" fill="var(--ink2)" text-anchor="middle" font-family="Figtree,system-ui,sans-serif">oggi</text>');
    }
    g.push('<text x="' + PL + '" y="' + (H - 10) + '" font-size="11.5" fill="var(--ink3)" font-family="Figtree,system-ui,sans-serif">' + DAY.format(parseD(m.start)) + '</text>');
    g.push('<text x="' + (W - PR) + '" y="' + (H - 10) + '" font-size="11.5" fill="var(--ink3)" text-anchor="end" font-family="Figtree,system-ui,sans-serif">' + DAY.format(parseD(m.end)) + (narrow ? '' : ' · stipendio') + '</text>');
    g.push('<line id="chX" x1="0" y1="' + PT + '" x2="0" y2="' + (PT + ih) + '" stroke="var(--ink2)" stroke-width="1" opacity="0"/>');
    g.push('<circle id="chD" cx="0" cy="0" r="4.5" fill="var(--ink)" stroke="var(--bg)" stroke-width="2" opacity="0"/>');
    g.push('<rect id="chHit" x="' + PL + '" y="' + PT + '" width="' + iw + '" height="' + ih + '" fill="transparent" style="cursor:crosshair"/>');

    Array.prototype.forEach.call(host.querySelectorAll("svg,.example"), function (n) { n.remove(); });
    host.insertAdjacentHTML("afterbegin",
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Soldi che restano giorno per giorno, con il ritmo ideale e la previsione fino al prossimo stipendio">' + g.join("") + '</svg>');

    el("keys").innerHTML =
      '<span><i style="border-color:var(--accent)"></i>Andamento reale</span>' +
      '<span><i style="border-color:' + (projBad ? "var(--crit)" : "var(--accent)") + ';border-top-style:dashed"></i>Previsione</span>' +
      '<span><i style="border-color:var(--ink3);border-top-style:dotted"></i>Ritmo ideale</span>';

    CH.m = m;
    CH.example = !!isExample;
    CH.width = W;
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
      var top = (cy / G.H) * r.height + (r.top - hostR.top) - 14;
      tip.style.left = Math.max(70, Math.min(hostR.width - 70, left)) + "px";
      tip.style.top = Math.max(54, top) + "px";
    }
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", off);
    hit.addEventListener("pointercancel", off);
  }

  /* ============ lista spese ============ */
  function renderList(m) {
    var box = el("list");
    if (!m.inPeriod.length) {
      box.innerHTML = '<p class="empty">Ancora nessuna spesa in questo periodo. Il primo caffè lo segni qui sopra.</p>';
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
        items.map(function (e) {
          return '<div class="row"><span class="nm">' + esc(e.note || "Spesa") + '</span>' +
            '<span class="amt">' + EUR2.format(e.amount) + '</span>' +
            '<button class="del" type="button" data-id="' + esc(e.id) + '" aria-label="Elimina ' + esc(e.note || "spesa") + '">×</button></div>';
        }).join("") + '</div>';
    }).join("");
    el("listTotal").textContent = m.inPeriod.length + (m.inPeriod.length === 1 ? " spesa · " : " spese · ") + EUR2.format(m.spent);
  }

  /* ============ risparmi storici ============ */
  function renderSaved() {
    var list = S.per.filter(function (p) { return p && isFinite(+p.saved); });
    if (!list.length) { el("savedCard").hidden = true; return; }
    el("savedCard").hidden = false;
    var max = Math.max.apply(null, list.map(function (p) { return Math.max(0, +p.saved); }).concat([1]));
    var tot = list.reduce(function (a, p) { return a + Math.max(0, +p.saved); }, 0);
    el("savedTotal").textContent = "totale " + EUR0.format(tot);
    el("savedBars").innerHTML = list.slice(0, 12).map(function (p) {
      var w = Math.max(2, Math.max(0, +p.saved) / max * 100);
      return '<div class="bar"><span class="lb">' + esc(MON.format(parseD(p.end || p.start))) + '</span>' +
        '<span class="tr"><span class="fl" style="width:' + w.toFixed(1) + '%"></span></span>' +
        '<span class="vl">' + EUR0.format(Math.max(0, +p.saved)) + '</span></div>';
    }).join("");
  }

  /* ============ render ============ */
  function render() {
    if (!S.set) { heroOnboarding(); renderSaved(); return; }
    var m = model(S.set, S.exp, todayISO());
    heroLive(m);
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

  function setSettings(patch) {
    S.set = normSettings(Object.assign({}, S.set || {}, patch));
    heroMode = "";
    save(); render();
  }

  function addExpense(amount, note, date) {
    var e = normExpense({ id: uid(), amount: amount, note: note, date: date || todayISO(), createdAt: Date.now() });
    if (!e) return;
    S.exp.unshift(e);
    save(); render();
  }

  function delExpense(id) {
    var gone = null;
    S.exp = S.exp.filter(function (x) { if (x.id === id) { gone = x; return false; } return true; });
    save(); render();
    if (!gone) return;
    toast("Eliminata " + EUR2.format(gone.amount), "Ripristina", function () {
      S.exp.unshift(gone); save(); render();
    });
  }

  function newPeriod() {
    if (!S.set) return;
    var m = model(S.set, S.exp, todayISO());
    var saved = (S.set.aside || 0) + Math.max(0, m.rest);
    S.per.unshift({
      start: m.start, end: m.end, salary: +S.set.salary || 0, fixed: +S.set.fixed || 0,
      aside: +S.set.aside || 0, budget: m.budget,
      spent: Math.round(m.spent * 100) / 100, saved: Math.round(saved * 100) / 100,
      closedAt: Date.now()
    });
    if (S.per.length > 60) S.per.length = 60;
    var t = todayISO();
    setSettings({ start: t, end: addMonth(t) });
    closeSheet();
    toast("Nuovo periodo aperto · messi da parte " + EUR0.format(saved));
  }

  /* ============ backup ============ */
  function exportData() {
    var blob = new Blob([JSON.stringify({ v: 1, settings: S.set, expenses: S.exp, periods: S.per }, null, 2)],
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

  function importData(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var d = JSON.parse(String(r.result));
        if (!d || typeof d !== "object") throw 0;
        S.set = d.settings && +d.settings.salary > 0 ? normSettings(d.settings) : null;
        S.exp = Array.isArray(d.expenses) ? d.expenses.map(normExpense).filter(Boolean) : [];
        S.per = Array.isArray(d.periods) ? d.periods : [];
        heroMode = ""; save(); render(); closeSheet();
        toast("Dati importati: " + S.exp.length + " spese");
      } catch (e) {
        toast("Il file non è leggibile");
      }
    };
    r.onerror = function () { toast("Non riesco a leggere il file"); };
    r.readAsText(file);
  }

  /* ============ pannello ============ */
  function openSheet() {
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

  /* ============ tema ============ */
  var THEMES = ["auto", "light", "dark"], LABEL = { auto: "Auto", light: "Chiaro", dark: "Scuro" };
  function applyTheme(t) {
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    var b = el("btnTheme");
    b.textContent = LABEL[t];
    b.setAttribute("aria-label", "Tema: " + LABEL[t].toLowerCase() + ", premi per cambiare");
  }
  function initTheme() {
    var t = "auto";
    try { t = localStorage.getItem(THEME_KEY) || "auto"; } catch (e) { }
    if (THEMES.indexOf(t) < 0) t = "auto";
    applyTheme(t);
    el("btnTheme").addEventListener("click", function () {
      var cur = document.documentElement.getAttribute("data-theme") || "auto";
      var next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { }
    });
  }

  /* ============ eventi ============ */
  el("btnSettings").addEventListener("click", openSheet);
  el("stClose").addEventListener("click", closeSheet);
  el("sheet").addEventListener("click", function (e) { if (e.target === el("sheet")) closeSheet(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !el("sheet").hidden) closeSheet(); });

  el("stApply").addEventListener("click", function () {
    var sal = num(el("stSalary").value);
    setSettings({
      salary: isFinite(sal) ? sal : (S.set ? S.set.salary : 0),
      fixed: Math.max(0, num(el("stFixed").value) || 0),
      aside: Math.max(0, num(el("stSave").value) || 0),
      start: el("stStart").value || todayISO(),
      end: el("stEnd").value || ""
    });
    closeSheet();
    toast("Impostazioni salvate");
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
    var backup = m.inPeriod.slice(), ids = {};
    backup.forEach(function (e) { ids[e.id] = 1; });
    S.exp = S.exp.filter(function (e) { return !ids[e.id]; });
    save(); render(); closeSheet();
    toast(backup.length + " spese cancellate", "Ripristina", function () {
      S.exp = backup.concat(S.exp); save(); render();
    });
  });

  el("addForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var a = num(el("exAmt").value);
    if (!isFinite(a) || a <= 0) { el("exAmt").focus(); return; }
    addExpense(a, el("exNote").value.trim(), el("exDate").value || todayISO());
    el("exAmt").value = ""; el("exNote").value = ""; el("exDate").value = todayISO();
    el("exAmt").focus();
  });

  el("list").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".del");
    if (b) delExpense(b.getAttribute("data-id"));
  });

  /* ============ avvio ============ */
  initTheme();
  load();
  el("exDate").value = todayISO();
  render();

  // il giorno cambia mentre l'app è aperta: ricalcola al rientro
  var bootDay = todayISO();
  window.addEventListener("focus", function () {
    if (todayISO() !== bootDay) { bootDay = todayISO(); el("exDate").value = bootDay; }
    render();
  });

  // il grafico usa px reali: va ridisegnato quando cambia la larghezza
  var rz;
  window.addEventListener("resize", function () {
    clearTimeout(rz);
    rz = setTimeout(redrawChartIfResized, 150);
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { });
    });
  }
})();
