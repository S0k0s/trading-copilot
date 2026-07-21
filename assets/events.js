/* =========================================================================
   events.js — "Event Patterns": πώς κινήθηκε ιστορικά η μετοχή γύρω από
   μεγάλες ανακοινώσεις προϊόντων (π.χ. Apple πριν το iPhone, Tesla πριν
   νέο μοντέλο). Υπολογίζει τη μέση πορεία -21..+21 συνεδριάσεις γύρω από
   την ημέρα της ανακοίνωσης, με win rates, από 10ετές ιστορικό.
   Μπορείς να προσθέσεις και δικά σου events (αποθηκεύονται τοπικά).
   ========================================================================= */
window.Events = (function () {
  'use strict';
  const A = window.Analysis;

  const W = 21; // συνεδριάσεις πριν/μετά (≈ 1 μήνας)
  const CUSTOM_KEY = 'tcCustomEvents';

  // Επιμελημένο dataset: ημερομηνίες μεγάλων ανακοινώσεων/παρουσιάσεων.
  const COMPANIES = {
    AAPL: { name: 'Apple', theme: 'iPhone keynotes', events: [
      { d: '2016-09-07', t: 'iPhone 7' }, { d: '2017-09-12', t: 'iPhone X / 8' },
      { d: '2018-09-12', t: 'iPhone XS' }, { d: '2019-09-10', t: 'iPhone 11' },
      { d: '2020-10-13', t: 'iPhone 12' }, { d: '2021-09-14', t: 'iPhone 13' },
      { d: '2022-09-07', t: 'iPhone 14' }, { d: '2023-09-12', t: 'iPhone 15' },
      { d: '2024-09-09', t: 'iPhone 16' }, { d: '2025-09-09', t: 'iPhone 17' },
    ]},
    TSLA: { name: 'Tesla', theme: 'παρουσιάσεις μοντέλων & AI events', events: [
      { d: '2017-07-28', t: 'Model 3 πρώτες παραδόσεις' },
      { d: '2019-03-14', t: 'Model Y παρουσίαση' },
      { d: '2019-11-21', t: 'Cybertruck παρουσίαση' },
      { d: '2020-09-22', t: 'Battery Day' },
      { d: '2021-08-19', t: 'AI Day' },
      { d: '2022-09-30', t: 'AI Day 2 (Optimus)' },
      { d: '2023-11-30', t: 'Cybertruck παραδόσεις' },
      { d: '2024-10-10', t: '"We, Robot" (Robotaxi)' },
      { d: '2025-06-22', t: 'Robotaxi launch (Austin)' },
    ]},
    NVDA: { name: 'NVIDIA', theme: 'GPU launches & GTC keynotes', events: [
      { d: '2018-08-20', t: 'RTX 20 series' }, { d: '2020-09-01', t: 'RTX 30 series' },
      { d: '2022-09-20', t: 'RTX 40 / GTC' }, { d: '2023-03-21', t: 'GTC 2023' },
      { d: '2024-03-18', t: 'GTC 2024 (Blackwell)' }, { d: '2025-01-06', t: 'CES 2025 (RTX 50)' },
      { d: '2025-03-18', t: 'GTC 2025' },
    ]},
    META: { name: 'Meta', theme: 'Connect events (Quest/AI)', events: [
      { d: '2020-09-16', t: 'Quest 2' }, { d: '2021-10-28', t: 'Meta rebrand' },
      { d: '2022-10-11', t: 'Quest Pro' }, { d: '2023-09-27', t: 'Quest 3' },
      { d: '2024-09-25', t: 'Orion glasses' }, { d: '2025-09-17', t: 'Connect 2025' },
    ]},
    GOOGL: { name: 'Alphabet', theme: 'Google I/O keynotes', events: [
      { d: '2021-05-18', t: 'I/O 2021' }, { d: '2022-05-11', t: 'I/O 2022' },
      { d: '2023-05-10', t: 'I/O 2023 (AI)' }, { d: '2024-05-14', t: 'I/O 2024' },
      { d: '2025-05-20', t: 'I/O 2025' },
    ]},
    MSFT: { name: 'Microsoft', theme: 'AI/Copilot ανακοινώσεις', events: [
      { d: '2023-02-07', t: 'Bing AI event' }, { d: '2023-03-16', t: 'Copilot announce' },
      { d: '2023-09-21', t: 'Copilot event ΝΥ' }, { d: '2024-05-20', t: 'Copilot+ PCs' },
      { d: '2025-05-19', t: 'Build 2025' },
    ]},
    AMD: { name: 'AMD', theme: 'GPU/accelerator launches', events: [
      { d: '2022-11-03', t: 'RDNA 3' }, { d: '2023-06-13', t: 'MI300 preview' },
      { d: '2023-12-06', t: 'MI300 launch' }, { d: '2024-10-10', t: 'Advancing AI 2024' },
      { d: '2025-06-12', t: 'Advancing AI 2025' },
    ]},
  };

  const state = { company: 'AAPL', initialized: false, cache: {} };

  /* ---------------- Custom events (localStorage) ------------------------- */

  function getCustom() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY)) || []; } catch (e) { return []; }
  }
  function saveCustom(list) { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); }

  function eventsFor(tickerKey) {
    const base = (COMPANIES[tickerKey] ? COMPANIES[tickerKey].events : []).map(e => ({ ...e, custom: false }));
    const custom = getCustom().filter(e => e.ticker === tickerKey).map(e => ({ d: e.d, t: e.t, custom: true }));
    return base.concat(custom).sort((a, b) => a.d < b.d ? -1 : 1);
  }

  /* ---------------- Ανάλυση ---------------------------------------------- */

  function tradingIndexAtOrAfter(bars, dateStr) {
    // δυαδική αναζήτηση της πρώτης συνεδρίασης >= dateStr
    let lo = 0, hi = bars.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].t >= dateStr) { ans = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return ans;
  }

  function analyze(bars, events) {
    const paths = [];
    for (const ev of events) {
      const i0 = tradingIndexAtOrAfter(bars, ev.d);
      if (i0 < W || i0 < 0 || i0 + W >= bars.length) {
        paths.push({ ev, ok: false });
        continue;
      }
      const base = bars[i0 - W].c;
      const path = [];
      for (let off = -W; off <= W; off++) path.push((bars[i0 + off].c / base - 1) * 100);
      const pre = (bars[i0 - 1].c / base - 1) * 100;                       // -21 → -1
      const day0 = (bars[i0].c / bars[i0 - 1].c - 1) * 100;                // ημέρα ανακοίνωσης
      const post = (bars[i0 + W].c / bars[i0].c - 1) * 100;                // 0 → +21
      paths.push({ ev, ok: true, path, pre, day0, post });
    }
    const valid = paths.filter(p => p.ok);
    let avg = null, stats = null;
    if (valid.length) {
      avg = [];
      for (let k = 0; k <= 2 * W; k++) {
        avg.push(valid.reduce((a, p) => a + p.path[k], 0) / valid.length);
      }
      const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
      const winRate = (arr) => arr.filter(v => v > 0).length / arr.length * 100;
      stats = {
        n: valid.length,
        preMean: mean(valid.map(p => p.pre)), preWin: winRate(valid.map(p => p.pre)),
        day0Mean: mean(valid.map(p => p.day0)),
        postMean: mean(valid.map(p => p.post)), postWin: winRate(valid.map(p => p.post)),
      };
    }
    return { paths, valid, avg, stats };
  }

  /* ---------------- Chart ------------------------------------------------- */

  function drawPathChart(canvas, res) {
    const { ctx, w, h } = A.setupCanvas(canvas, 320);
    const padL = 10, padR = 52, padT = 16, padB = 26;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    let lo = 0, hi = 0;
    res.valid.forEach(p => p.path.forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v); }));
    if (res.avg) res.avg.forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v); });
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const xAt = (k) => padL + k / (2 * W) * plotW;
    const yAt = (v) => padT + (hi - v) / (hi - lo) * plotH;

    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px -apple-system, sans-serif';
    A.niceTicks(lo, hi, 5).forEach(v => {
      const y = yAt(v);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = '#9aa3b2'; ctx.textAlign = 'left';
      ctx.fillText((v > 0 ? '+' : '') + v.toFixed(0) + '%', w - padR + 8, y + 4);
    });
    // μηδενική γραμμή
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.moveTo(padL, yAt(0)); ctx.lineTo(w - padR, yAt(0)); ctx.stroke();
    // κάθετη στην ημέρα 0
    const x0 = xAt(W);
    ctx.strokeStyle = '#f5a623'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x0, padT); ctx.lineTo(x0, padT + plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f5a623'; ctx.textAlign = 'center';
    ctx.fillText('ημέρα ανακοίνωσης', x0, padT - 4);
    // x labels
    ctx.fillStyle = '#9aa3b2';
    [-W, -10, 0, 10, W].forEach(off => {
      ctx.fillText((off > 0 ? '+' : '') + off, xAt(off + W), h - 8);
    });

    // ατομικές διαδρομές (αχνές)
    res.valid.forEach(p => {
      ctx.strokeStyle = 'rgba(79,140,255,0.18)'; ctx.lineWidth = 1;
      ctx.beginPath();
      p.path.forEach((v, k) => k === 0 ? ctx.moveTo(xAt(k), yAt(v)) : ctx.lineTo(xAt(k), yAt(v)));
      ctx.stroke();
    });
    // μέση διαδρομή (έντονη)
    if (res.avg) {
      ctx.strokeStyle = '#3ecf8e'; ctx.lineWidth = 2.4;
      ctx.beginPath();
      res.avg.forEach((v, k) => k === 0 ? ctx.moveTo(xAt(k), yAt(v)) : ctx.lineTo(xAt(k), yAt(v)));
      ctx.stroke();
      ctx.fillStyle = '#3ecf8e'; ctx.textAlign = 'left';
      ctx.fillText('μέση πορεία', xAt(2 * W) - 68, yAt(res.avg[2 * W]) - 8);
    }
  }

  /* ---------------- Rendering --------------------------------------------- */

  function ensureSkeleton() {
    if (state.initialized) return;
    const wrap = document.getElementById('events');
    wrap.innerHTML = `
      <div class="ev-chips" id="ev-chips"></div>
      <div class="tl-panel" id="ev-summary"></div>
      <div class="tl-chart-card"><canvas id="ev-canvas"></canvas><div id="ev-msg" class="tl-chart-msg" style="display:none;"></div></div>
      <div id="ev-table"></div>
      <div class="journal-form" style="margin-top:18px;">
        <h3>➕ Πρόσθεσε δικό σου event</h3>
        <div class="jf-grid">
          <input id="ev-add-ticker" placeholder="Ticker (π.χ. TSLA)">
          <input id="ev-add-date" type="date">
          <input id="ev-add-title" placeholder="Τι ανακοινώθηκε; (π.χ. νέο AI προϊόν)">
        </div>
        <button onclick="Events.addCustom()">Προσθήκη στο dataset</button>
        <div class="journal-note">📌 Αποθηκεύεται τοπικά στον browser σου και μπαίνει στην ανάλυση της αντίστοιχης εταιρείας.
        Χρήσιμο π.χ. για να παρακολουθείς τη δική σου θεωρία (Tesla &amp; AI) με πραγματικά δεδομένα.</div>
      </div>
      <div class="note">⚠️ Μικρό δείγμα (λίγα events ανά εταιρεία) — τα ιστορικά μοτίβα είναι ένδειξη, όχι κανόνας,
      και δεν εγγυώνται επανάληψη. Η ημερομηνία αντιστοιχίζεται στην πρώτη συνεδρίαση ≥ της ημέρας του event.</div>`;
    state.initialized = true;
  }

  function renderChips() {
    const el = document.getElementById('ev-chips');
    el.innerHTML = Object.keys(COMPANIES).map(k =>
      `<button class="ev-chip${k === state.company ? ' active' : ''}" data-k="${k}">${k} · ${COMPANIES[k].name}</button>`).join('');
    el.querySelectorAll('.ev-chip').forEach(b => {
      b.onclick = () => { state.company = b.dataset.k; renderCompany(); };
    });
  }

  async function renderCompany() {
    renderChips();
    const key = state.company;
    const co = COMPANIES[key];
    const msg = document.getElementById('ev-msg');
    const summary = document.getElementById('ev-summary');
    const tableEl = document.getElementById('ev-table');
    summary.innerHTML = `<div class="lbl">${co.name} (${key}) · ${co.theme}</div><div class="tl-factor-txt">Φόρτωση 10ετούς ιστορικού…</div>`;
    tableEl.innerHTML = '';
    msg.style.display = 'none';

    let bars = state.cache[key];
    if (!bars) {
      try {
        bars = await A.fetchHistory(key, '10Y');
        state.cache[key] = bars;
      } catch (e) {
        summary.innerHTML = `<div class="lbl">${co.name} (${key})</div><div class="tl-factor-txt">⚠️ Δεν φόρτωσε το ιστορικό (${e.message || e}).</div>`;
        return;
      }
    }
    if (state.company !== key) return; // ο χρήστης άλλαξε εταιρεία όσο φορτώναμε

    const evs = eventsFor(key);
    const res = analyze(bars, evs);
    drawPathChart(document.getElementById('ev-canvas'), res);

    if (res.stats) {
      const s = res.stats;
      const verdictPre = s.preMean > 1 && s.preWin >= 60
        ? `Το μοτίβο "ανεβαίνει πριν την ανακοίνωση" <b>επιβεβαιώνεται ιστορικά</b> εδώ`
        : s.preMean > 0
          ? `Ελαφρώς θετική τάση πριν τις ανακοινώσεις, αλλά <b>όχι ισχυρό/σταθερό μοτίβο</b>`
          : `Το μοτίβο "ανεβαίνει πριν την ανακοίνωση" <b>δεν επιβεβαιώνεται</b> σε αυτή την εταιρεία`;
      summary.innerHTML = `
        <div class="lbl">${co.name} (${key}) · ${co.theme} · ${s.n} events με πλήρη δεδομένα</div>
        <div class="ev-stats">
          <div class="pf-box"><div class="lbl">Μήνας ΠΡΙΝ (αγορά -21, πώληση -1)</div>
            <div class="val" style="color:${s.preMean >= 0 ? 'var(--green)' : 'var(--red)'}">${s.preMean >= 0 ? '+' : ''}${s.preMean.toFixed(1)}%</div>
            <div class="ev-win">win rate ${s.preWin.toFixed(0)}%</div></div>
          <div class="pf-box"><div class="lbl">Ημέρα ανακοίνωσης</div>
            <div class="val" style="color:${s.day0Mean >= 0 ? 'var(--green)' : 'var(--red)'}">${s.day0Mean >= 0 ? '+' : ''}${s.day0Mean.toFixed(1)}%</div>
            <div class="ev-win">μ.ο. ημερήσιας κίνησης</div></div>
          <div class="pf-box"><div class="lbl">Μήνας ΜΕΤΑ (0 → +21)</div>
            <div class="val" style="color:${s.postMean >= 0 ? 'var(--green)' : 'var(--red)'}">${s.postMean >= 0 ? '+' : ''}${s.postMean.toFixed(1)}%</div>
            <div class="ev-win">win rate ${s.postWin.toFixed(0)}%</div></div>
        </div>
        <div class="tl-factor-txt" style="margin-top:10px;">${verdictPre} — μ.ο. ${s.preMean >= 0 ? '+' : ''}${s.preMean.toFixed(1)}% τον μήνα πριν, με ${s.preWin.toFixed(0)}% των events θετικά (${s.n} events).</div>`;
    }

    tableEl.innerHTML = `
      <div style="overflow-x:auto;"><table>
        <thead><tr><th>Ημερομηνία</th><th>Event</th><th>Μήνας πριν</th><th>Ημέρα 0</th><th>Μήνας μετά</th></tr></thead>
        <tbody>` + res.paths.map(p => {
          const cell = (v) => p.ok
            ? `<td class="${v >= 0 ? 'g-high' : 'g-low'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</td>`
            : '<td>—</td>';
          return `<tr>
            <td>${p.ev.d}${p.ev.custom ? ' <span class="ev-custom-tag">δικό σου</span>' : ''}</td>
            <td>${p.ev.t}</td>
            ${p.ok ? cell(p.pre) + cell(p.day0) + cell(p.post) : '<td colspan="3" style="color:var(--muted)">εκτός διαθέσιμου ιστορικού</td>'}
          </tr>`;
        }).join('') + `</tbody></table></div>`;
  }

  function addCustom() {
    const ticker = document.getElementById('ev-add-ticker').value.trim().toUpperCase();
    const d = document.getElementById('ev-add-date').value;
    const t = document.getElementById('ev-add-title').value.trim();
    if (!ticker || !d || !t) { alert('Συμπλήρωσε ticker, ημερομηνία και τίτλο.'); return; }
    if (!COMPANIES[ticker]) {
      alert('Προς το παρόν η ανάλυση events υποστηρίζει: ' + Object.keys(COMPANIES).join(', ') +
        '. Το event αποθηκεύτηκε και θα εμφανιστεί αν προστεθεί η εταιρεία.');
    }
    const list = getCustom();
    list.push({ ticker, d, t });
    saveCustom(list);
    document.getElementById('ev-add-title').value = '';
    if (COMPANIES[ticker]) { state.company = ticker; }
    renderCompany();
  }

  function render() {
    ensureSkeleton();
    renderCompany();
  }

  return { render, addCustom };
})();
