/* =========================================================================
   strategies.js — "Στρατηγικές": σύγκριση βασικών στρατηγικών με mini
   backtest σε πραγματικό ιστορικό, οδηγός επιλογής, και υπολογιστής
   μεγέθους θέσης βάσει ρίσκου.
   ========================================================================= */
window.Strategies = (function () {
  'use strict';
  const A = window.Analysis;

  const state = { initialized: false, btTicker: null, btRange: '2Y' };

  const STRATS = [
    {
      icon: '🏛️', name: 'Long-Term Quality', horizon: 'μήνες – χρόνια',
      how: 'Αγοράζεις ποιοτικές εταιρείες (υψηλό Long-Term Score) σε λογική αποτίμηση και τις κρατάς, αγνοώντας τον θόρυβο.',
      when: 'Δουλεύει όταν έχεις υπομονή και δεν χρειάζεσαι τα χρήματα σύντομα. Ο χρόνος δουλεύει για σένα (compounding).',
      risk: 'Μεγάλες προσωρινές διορθώσεις (-30% ή περισσότερο). Θέλει αντοχή στο να μην πουλήσεις στον πάτο.',
      fit: 'Λίγος διαθέσιμος χρόνος, σταθερό εισόδημα, στόχος περιουσία σε βάθος χρόνων.',
    },
    {
      icon: '📈', name: 'Trend Following', horizon: 'εβδομάδες – μήνες',
      how: 'Μπαίνεις όταν η τιμή είναι πάνω από τον MA50/MA200 (ανοδική δομή) και βγαίνεις όταν η δομή σπάσει.',
      when: 'Δουλεύει σε αγορές με καθαρές, μεγάλες τάσεις. Χάνει σε πλάγιες (choppy) αγορές με ψευδο-σήματα.',
      risk: 'Πολλά μικρά χασούρια στα πλάγια σκαμπανεβάσματα μέχρι να "πιάσει" τη μεγάλη τάση.',
      fit: 'Θες σύστημα με σαφείς κανόνες και αποδέχεσαι ότι θα χάνεις συχνά μικρά για να κερδίζεις σπάνια μεγάλα.',
    },
    {
      icon: '📉', name: 'Pullback σε Uptrend', horizon: 'μέρες – εβδομάδες',
      how: 'Περιμένεις προσωρινή "βουτιά" (π.χ. RSI < 35) σε μετοχή που παραμένει σε μακροπρόθεσμο uptrend και αγοράζεις τη φτηνή στιγμή.',
      when: 'Δουλεύει σε ισχυρές μετοχές που διορθώνουν χωρίς να χαλάει η μεγάλη εικόνα.',
      risk: 'Καμιά φορά η "βουτιά" είναι η αρχή αλλαγής τάσης — απαραίτητο το stop-loss.',
      fit: 'Έχεις χρόνο να παρακολουθείς και πειθαρχία να περιμένεις το setup αντί να κυνηγάς.',
    },
    {
      icon: '🚀', name: 'Breakout από Range', horizon: 'μέρες – εβδομάδες',
      how: 'Όταν η τιμή κινείται σε κανάλι (όπως οι πορτοκαλί γραμμές στο Trend Lab), μπαίνεις στο σπάσιμο της αντίστασης με αυξημένο όγκο.',
      when: 'Δουλεύει όταν το σπάσιμο συνοδεύεται από όγκο/νέα. Τα ψεύτικα σπασίματα είναι συχνά.',
      risk: 'False breakouts — γι\' αυτό stop κάτω από το επίπεδο που έσπασε.',
      fit: 'Σου αρέσει το timing και μπορείς να αντιδράς γρήγορα μέσα στη μέρα.',
    },
    {
      icon: '🗓️', name: 'Event-driven Swing', horizon: '2 – 6 εβδομάδες',
      how: 'Αγοράζεις εβδομάδες πριν από γνωστό μεγάλο event (π.χ. παρουσίαση προϊόντος) ποντάροντας στο "hype", και βγαίνεις πριν ή στην ανακοίνωση.',
      when: 'Κοίτα το tab Events: σε κάποιες εταιρείες το μοτίβο έχει ιστορική βάση, σε άλλες όχι.',
      risk: '"Buy the rumor, sell the news" — συχνά η μετοχή πέφτει ΣΤΗΝ ανακοίνωση. Μικρό στατιστικό δείγμα.',
      fit: 'Σε ενδιαφέρουν οι εταιρείες/τεχνολογία και παρακολουθείς ειδήσεις — δένει με τη θεωρία σου για Tesla/AI.',
    },
  ];

  /* ---------------- Backtest --------------------------------------------- */

  async function runBacktest() {
    const el = document.getElementById('st-bt-results');
    const ticker = state.btTicker;
    if (!ticker) return;
    el.innerHTML = '<div class="tl-factor-txt">Υπολογισμός σε πραγματικό ιστορικό…</div>';
    let bars;
    try {
      bars = await A.fetchHistory(ticker, state.btRange);
    } catch (e) {
      el.innerHTML = `<div class="tl-factor-txt">⚠️ Δεν φόρτωσε ιστορικό για ${ticker} (${e.message || e}).</div>`;
      return;
    }
    const results = [A.btBuyHold(bars), A.btMaTrend(bars, 50), A.btPullback(bars)];
    const colors = ['#4f8cff', '#3ecf8e', '#e8c547'];

    el.innerHTML = `
      <div class="tl-chart-card" style="margin-bottom:12px;"><canvas id="st-bt-canvas"></canvas></div>
      <div style="overflow-x:auto;"><table>
        <thead><tr><th>Στρατηγική</th><th>Συνολική απόδοση</th><th>Max Drawdown</th><th>Trades</th><th>Win rate</th></tr></thead>
        <tbody>${results.map((r, i) => `
          <tr>
            <td><span style="color:${colors[i]}">●</span> ${r.name}</td>
            <td class="${r.totalPct >= 0 ? 'g-high' : 'g-low'}">${r.totalPct >= 0 ? '+' : ''}${r.totalPct.toFixed(1)}%</td>
            <td class="g-low">${r.maxDD.toFixed(1)}%</td>
            <td>${r.trades}</td>
            <td>${r.winRate == null ? '—' : r.winRate.toFixed(0) + '%'}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      <div class="note">Απλοποιημένη προσομοίωση σε κλεισίματα ημέρας, χωρίς προμήθειες, slippage και φόρους — για
      <b>σύγκριση χαρακτήρα στρατηγικών</b>, όχι ως υπόσχεση απόδοσης. Παρελθούσες αποδόσεις ≠ μελλοντικές.</div>`;

    drawEquity(document.getElementById('st-bt-canvas'), bars, results, colors);
  }

  function drawEquity(canvas, bars, results, colors) {
    const { ctx, w, h } = A.setupCanvas(canvas, 260);
    const padL = 10, padR = 56, padT = 12, padB = 24;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    let lo = Infinity, hi = -Infinity;
    results.forEach(r => r.equity.forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v); }));
    const pad = (hi - lo) * 0.06 || 0.1; lo -= pad; hi += pad;
    const n = Math.max(...results.map(r => r.equity.length));
    const xAt = (i) => padL + i / (n - 1) * plotW;
    const yAt = (v) => padT + (hi - v) / (hi - lo) * plotH;

    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px -apple-system, sans-serif';
    A.niceTicks(lo, hi, 4).forEach(v => {
      const y = yAt(v);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = '#9aa3b2'; ctx.textAlign = 'left';
      ctx.fillText('×' + v.toFixed(2), w - padR + 8, y + 4);
    });
    const dateStep = Math.max(1, Math.floor(bars.length / 5));
    ctx.textAlign = 'center';
    for (let i = 0; i < bars.length; i += dateStep) {
      ctx.fillText(bars[i].t.slice(0, 7), xAt(i), h - 6);
    }
    results.forEach((r, ri) => {
      ctx.strokeStyle = colors[ri]; ctx.lineWidth = ri === 0 ? 1.4 : 2;
      ctx.beginPath();
      r.equity.forEach((v, i) => i === 0 ? ctx.moveTo(xAt(i), yAt(v)) : ctx.lineTo(xAt(i), yAt(v)));
      ctx.stroke();
    });
  }

  /* ---------------- Position sizing -------------------------------------- */

  function calcPosition() {
    const cap = parseFloat(document.getElementById('ps-capital').value);
    const riskPct = parseFloat(document.getElementById('ps-risk').value);
    const entry = parseFloat(document.getElementById('ps-entry').value);
    const stop = parseFloat(document.getElementById('ps-stop').value);
    const target = parseFloat(document.getElementById('ps-target').value);
    const out = document.getElementById('ps-out');
    if (!(cap > 0) || !(riskPct > 0) || !(entry > 0) || !(stop > 0)) {
      out.innerHTML = '<div class="tl-factor-txt">Συμπλήρωσε κεφάλαιο, ρίσκο %, τιμή εισόδου και stop.</div>';
      return;
    }
    if (stop >= entry) {
      out.innerHTML = '<div class="tl-factor-txt">⚠️ Για long θέση το stop πρέπει να είναι κάτω από την τιμή εισόδου.</div>';
      return;
    }
    const riskMoney = cap * riskPct / 100;
    const riskPerShare = entry - stop;
    const shares = riskMoney / riskPerShare;
    const positionValue = shares * entry;
    const posPctOfCap = positionValue / cap * 100;
    const rr = target > entry ? (target - entry) / riskPerShare : null;
    const warn = posPctOfCap > 25
      ? `<div class="tl-factor-txt" style="color:var(--yellow)">⚠️ Η θέση βγαίνει ${posPctOfCap.toFixed(0)}% του κεφαλαίου — σκέψου πιο μακρινό stop με λιγότερες μετοχές ή μικρότερο ρίσκο.</div>` : '';
    out.innerHTML = `
      <div class="ev-stats">
        <div class="pf-box"><div class="lbl">Ρισκάρεις</div><div class="val">€${riskMoney.toFixed(2)}</div><div class="ev-win">${riskPct}% του κεφαλαίου</div></div>
        <div class="pf-box"><div class="lbl">Μέγεθος θέσης</div><div class="val">€${positionValue.toFixed(0)}</div><div class="ev-win">${posPctOfCap.toFixed(1)}% του κεφαλαίου</div></div>
        <div class="pf-box"><div class="lbl">Μετοχές</div><div class="val">${shares.toFixed(shares < 10 ? 2 : 0)}</div><div class="ev-win">ρίσκο $${riskPerShare.toFixed(2)}/μετοχή</div></div>
        ${rr != null ? `<div class="pf-box"><div class="lbl">Reward : Risk</div><div class="val" style="color:${rr >= 2 ? 'var(--green)' : rr >= 1 ? 'var(--yellow)' : 'var(--red)'}">${rr.toFixed(1)} : 1</div><div class="ev-win">${rr >= 2 ? 'υγιής αναλογία' : rr >= 1 ? 'οριακή' : 'κακή — δεν αξίζει'}</div></div>` : ''}
      </div>
      ${warn}
      <div class="tl-factor-txt" style="margin-top:8px;">Κανόνας: αν χτυπήσει το stop, χάνεις μόνο €${riskMoney.toFixed(0)} —
      έτσι κανένα μεμονωμένο trade δεν μπορεί να σου κάνει σοβαρή ζημιά.</div>`;
  }

  /* ---------------- Rendering -------------------------------------------- */

  function fillBtTicker() {
    const sel = document.getElementById('st-bt-ticker');
    const data = (window.DATA || []).slice().sort((a, b) => a.ticker.localeCompare(b.ticker));
    if (!data.length || sel.options.length === data.length) return;
    sel.innerHTML = data.map(d => `<option value="${d.ticker}">${d.ticker} — ${d.name || ''}</option>`).join('');
    if (state.btTicker) sel.value = state.btTicker;
  }

  function ensureSkeleton() {
    if (state.initialized) return;
    const wrap = document.getElementById('strategies');
    wrap.innerHTML = `
      <div class="lbl" style="margin-bottom:10px;">Οι 5 βασικές στρατηγικές — τι ταιριάζει σε τι</div>
      <div class="st-cards">${STRATS.map(s => `
        <div class="st-card">
          <div class="st-card-hd"><span class="st-icon">${s.icon}</span><b>${s.name}</b><span class="st-horizon">${s.horizon}</span></div>
          <div class="st-row"><b>Πώς:</b> ${s.how}</div>
          <div class="st-row"><b>Πότε αποδίδει:</b> ${s.when}</div>
          <div class="st-row"><b>Κίνδυνος:</b> ${s.risk}</div>
          <div class="st-row st-fit"><b>Σου ταιριάζει αν:</b> ${s.fit}</div>
        </div>`).join('')}
      </div>

      <div class="section-hd">🧪 Mini Backtest — δες τον "χαρακτήρα" κάθε στρατηγικής σε πραγματικά δεδομένα</div>
      <div class="tl-toolbar">
        <select id="st-bt-ticker" class="tl-select"></select>
        <div class="tl-ranges">
          ${['1Y', '2Y', '5Y'].map(r => `<button class="tl-range st-bt-range${r === state.btRange ? ' active' : ''}" data-range="${r}">${r}</button>`).join('')}
        </div>
        <button class="st-run" onclick="Strategies.runBacktest()">Τρέξε σύγκριση</button>
      </div>
      <div id="st-bt-results"><div class="tl-factor-txt">Διάλεξε μετοχή και πάτα "Τρέξε σύγκριση".</div></div>

      <div class="section-hd">🧮 Υπολογιστής μεγέθους θέσης (risk-based)</div>
      <div class="journal-form">
        <div class="jf-grid">
          <input id="ps-capital" type="number" placeholder="Κεφάλαιο (€)" value="1000">
          <input id="ps-risk" type="number" placeholder="Ρίσκο ανά trade (%)" value="1.5" step="0.5">
          <input id="ps-entry" type="number" placeholder="Τιμή εισόδου ($)" step="0.01">
          <input id="ps-stop" type="number" placeholder="Stop-loss ($)" step="0.01">
          <input id="ps-target" type="number" placeholder="Στόχος ($ — προαιρετικό)" step="0.01">
        </div>
        <button onclick="Strategies.calcPosition()">Υπολόγισε</button>
        <div id="ps-out" style="margin-top:14px;"></div>
      </div>`;

    wrap.querySelectorAll('.st-bt-range').forEach(btn => {
      btn.onclick = () => {
        state.btRange = btn.dataset.range;
        wrap.querySelectorAll('.st-bt-range').forEach(b => b.classList.toggle('active', b === btn));
      };
    });
    document.getElementById('st-bt-ticker').onchange = (e) => { state.btTicker = e.target.value; };
    state.initialized = true;
  }

  function render() {
    ensureSkeleton();
    fillBtTicker();
    if (!state.btTicker) {
      const first = document.getElementById('st-bt-ticker').value;
      if (first) state.btTicker = first;
    }
  }

  return { render, runBacktest, calcPosition };
})();
