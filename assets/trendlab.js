/* =========================================================================
   trendlab.js — "Τάσεις & Πρόβλεψη": custom candlestick chart με αυτόματο
   κανάλι στήριξης/αντίστασης (πορτοκαλί γραμμές), στατιστική προβολή τάσης
   και σύνθετη εκτίμηση (τεχνική εικόνα + news sentiment).
   ========================================================================= */
window.TrendLab = (function () {
  'use strict';
  const A = window.Analysis;

  const state = {
    ticker: null,
    range: '6M',          // ορατό εύρος: 3M | 6M | 1Y | 2Y
    bars2y: null,         // πλήρες 2Y ιστορικό του τρέχοντος ticker
    loading: false,
    error: null,
    initialized: false,
  };

  const RANGE_BARS = { '3M': 64, '6M': 128, '1Y': 252, '2Y': 5000 };
  const HORIZON = 20; // συνεδριάσεις προβολής

  /* ------------------------------- UI σκελετός -------------------------- */

  function ensureSkeleton() {
    if (state.initialized) return;
    const wrap = document.getElementById('trendlab');
    wrap.innerHTML = `
      <div class="tl-toolbar">
        <select id="tl-ticker" class="tl-select" title="Μετοχή"></select>
        <div class="tl-ranges">
          ${Object.keys(RANGE_BARS).map(r =>
            `<button class="tl-range${r === state.range ? ' active' : ''}" data-range="${r}">${r}</button>`).join('')}
        </div>
        <span class="tl-hint">Πορτοκαλί = αυτόματο κανάλι στήριξης/αντίστασης · σκιασμένο = στατιστική προβολή ${HORIZON} συνεδριάσεων</span>
      </div>
      <div class="tl-chart-card">
        <canvas id="tl-canvas"></canvas>
        <div id="tl-chart-msg" class="tl-chart-msg" style="display:none;"></div>
      </div>
      <div class="tl-grid">
        <div class="tl-panel" id="tl-verdict"></div>
        <div class="tl-panel" id="tl-factors"></div>
      </div>
      <div class="tl-panel" id="tl-news"></div>
      <div class="note">⚠️ Η "πρόβλεψη" είναι στατιστική εκτίμηση από ιστορικές τιμές και τόνο ειδήσεων — δείχνει πιθανή κατεύθυνση,
      <b>δεν</b> είναι επενδυτική συμβουλή ούτε εγγύηση. Οι αγορές εκπλήσσουν συχνά και τα μοντέλα κάνουν λάθη.</div>`;

    wrap.querySelectorAll('.tl-range').forEach(btn => {
      btn.onclick = () => {
        state.range = btn.dataset.range;
        wrap.querySelectorAll('.tl-range').forEach(b => b.classList.toggle('active', b === btn));
        renderChartAndPanels();
      };
    });
    document.getElementById('tl-ticker').onchange = (e) => setTicker(e.target.value);
    window.addEventListener('resize', () => {
      clearTimeout(state._rsz);
      state._rsz = setTimeout(() => {
        if (document.getElementById('trendlab').style.display !== 'none' && state.bars2y) renderChartAndPanels();
      }, 150);
    });
    state.initialized = true;
  }

  function fillTickerSelect() {
    const sel = document.getElementById('tl-ticker');
    const data = (window.DATA || []).slice().sort((a, b) => a.ticker.localeCompare(b.ticker));
    if (!data.length || sel.options.length === data.length) return;
    sel.innerHTML = data.map(d =>
      `<option value="${d.ticker}">${d.ticker} — ${d.name || ''}</option>`).join('');
    if (state.ticker) sel.value = state.ticker;
  }

  /* ------------------------------- Δεδομένα ------------------------------ */

  async function setTicker(ticker) {
    state.ticker = ticker;
    const sel = document.getElementById('tl-ticker');
    if (sel && sel.value !== ticker) sel.value = ticker;
    state.loading = true; state.error = null; state.bars2y = null;
    showMsg('Φόρτωση ιστορικού για ' + ticker + '…');
    try {
      state.bars2y = await A.fetchHistory(ticker, '2Y');
      state.loading = false;
      hideMsg();
      renderChartAndPanels();
    } catch (e) {
      state.loading = false;
      state.error = e;
      showMsg('⚠️ Δεν φόρτωσε το ιστορικό για ' + ticker + ' (' + (e.message || e) + '). Δοκίμασε ξανά σε λίγο.');
    }
  }

  function showMsg(txt) {
    const el = document.getElementById('tl-chart-msg');
    if (el) { el.style.display = 'flex'; el.textContent = txt; }
  }
  function hideMsg() {
    const el = document.getElementById('tl-chart-msg');
    if (el) el.style.display = 'none';
  }

  /* ------------------------------- Chart --------------------------------- */

  function renderChartAndPanels() {
    if (!state.bars2y) return;
    const visN = Math.min(RANGE_BARS[state.range], state.bars2y.length);
    const bars = state.bars2y.slice(-visN);
    const closes2y = state.bars2y.map(b => b.c);
    const sentiment = getSentiment(state.ticker);
    const pred = A.predictTrend(bars, sentiment);
    const proj = A.projection(closes2y, HORIZON, 60);
    drawChart(bars, pred.channel, proj);
    renderVerdict(pred, proj);
    renderFactors(pred);
    renderNews(state.ticker);
  }

  function getSentiment(ticker) {
    const n = window.NEWS && window.NEWS.tickers && window.NEWS.tickers[ticker];
    return n ? n.score : null;
  }

  function drawChart(bars, channel, proj) {
    const canvas = document.getElementById('tl-canvas');
    const { ctx, w, h } = A.setupCanvas(canvas, 420);
    const padR = 62, padT = 14, padB = 26, padL = 8;
    const volH = 52;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB - volH;
    const n = bars.length;
    const total = n + proj.length + 2;
    const xAt = (i) => padL + (i + 0.5) / total * plotW;

    // Εύρος y: κεριά + κανάλι + προβολή
    let lo = Infinity, hi = -Infinity;
    bars.forEach(b => { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); });
    const start = channel.startIndex || 0;
    [channel.res, channel.sup].forEach(line => {
      if (!line) return;
      [start, n - 1 + proj.length].forEach(i => {
        const y = line.a + line.b * i;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      });
    });
    proj.forEach(p => { lo = Math.min(lo, p.dn); hi = Math.max(hi, p.up); });
    const padY = (hi - lo) * 0.05 || 1;
    lo -= padY; hi += padY;
    const yAt = (v) => padT + (hi - v) / (hi - lo) * plotH;

    ctx.clearRect(0, 0, w, h);

    // Πλέγμα + άξονας τιμών
    ctx.font = '11px -apple-system, sans-serif';
    A.niceTicks(lo, hi, 6).forEach(v => {
      const y = yAt(v);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = '#9aa3b2';
      ctx.textAlign = 'left';
      ctx.fillText(v >= 1000 ? v.toFixed(0) : v.toFixed(2), w - padR + 8, y + 4);
    });

    // Ημερομηνίες
    const dateStep = Math.max(1, Math.floor(n / 6));
    ctx.fillStyle = '#9aa3b2'; ctx.textAlign = 'center';
    for (let i = 0; i < n; i += dateStep) {
      const d = bars[i].t.slice(5).replace('-', '/');
      ctx.fillText(d, xAt(i), h - 8);
    }

    // Όγκος
    const vMax = Math.max(...bars.map(b => b.v), 1);
    bars.forEach((b, i) => {
      const vh = b.v / vMax * volH * 0.9;
      ctx.fillStyle = b.c >= b.o ? 'rgba(62,207,142,0.25)' : 'rgba(229,98,107,0.25)';
      const bw = Math.max(1, plotW / total * 0.6);
      ctx.fillRect(xAt(i) - bw / 2, padT + plotH + volH - vh, bw, vh);
    });

    // MA50 (διακριτικό)
    const closes = bars.map(b => b.c);
    const ma50 = A.sma(closes, 50);
    ctx.strokeStyle = 'rgba(79,140,255,0.55)'; ctx.lineWidth = 1.3;
    ctx.beginPath();
    let started = false;
    ma50.forEach((v, i) => {
      if (v == null) return;
      if (!started) { ctx.moveTo(xAt(i), yAt(v)); started = true; }
      else ctx.lineTo(xAt(i), yAt(v));
    });
    ctx.stroke();

    // Κεριά
    const cw = Math.max(1.4, plotW / total * 0.62);
    bars.forEach((b, i) => {
      const x = xAt(i);
      const up = b.c >= b.o;
      ctx.strokeStyle = ctx.fillStyle = up ? '#3ecf8e' : '#e5626b';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yAt(b.h)); ctx.lineTo(x, yAt(b.l)); ctx.stroke();
      const yO = yAt(b.o), yC = yAt(b.c);
      ctx.fillRect(x - cw / 2, Math.min(yO, yC), cw, Math.max(1, Math.abs(yC - yO)));
    });

    // Διαχωριστικό "σήμερα"
    const xNow = xAt(n - 0.2);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(xNow, padT); ctx.lineTo(xNow, padT + plotH + volH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#9aa3b2'; ctx.textAlign = 'center';
    ctx.fillText('σήμερα', xNow, padT + 10);

    // Ζώνη προβολής
    if (proj.length) {
      const lastClose = bars[n - 1].c;
      ctx.beginPath();
      ctx.moveTo(xAt(n - 1), yAt(lastClose));
      proj.forEach(p => ctx.lineTo(xAt(n - 1 + p.h), yAt(p.up)));
      for (let i = proj.length - 1; i >= 0; i--) ctx.lineTo(xAt(n - 1 + proj[i].h), yAt(proj[i].dn));
      ctx.closePath();
      ctx.fillStyle = 'rgba(79,140,255,0.10)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(79,140,255,0.85)';
      ctx.lineWidth = 1.6; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(xAt(n - 1), yAt(lastClose));
      proj.forEach(p => ctx.lineTo(xAt(n - 1 + p.h), yAt(p.mid)));
      ctx.stroke();
      ctx.setLineDash([]);
      const end = proj[proj.length - 1];
      ctx.fillStyle = 'rgba(79,140,255,0.95)'; ctx.textAlign = 'left';
      ctx.fillText('εκτίμηση', xAt(n + 1), yAt(end.mid) - 8);
    }

    // Κανάλι στήριξης/αντίστασης (πορτοκαλί γραμμές, όπως στο παράδειγμά σου)
    [['res', channel.res], ['sup', channel.sup]].forEach(([kind, line]) => {
      if (!line) return;
      const iEnd = n - 1 + proj.length * 0.9;
      const x1 = xAt(start), y1 = yAt(line.a + line.b * start);
      const x2 = xAt(iEnd), y2 = yAt(line.a + line.b * iEnd);
      ctx.strokeStyle = '#f5a623'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      // κυκλάκια στα άκρα, όπως στο TradingView
      ctx.fillStyle = '#171a21';
      [[x1, y1], [x2, y2]].forEach(([x, y]) => {
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      });
      ctx.fillStyle = '#f5a623'; ctx.textAlign = 'left';
      ctx.fillText(kind === 'res' ? 'αντίσταση' : 'στήριξη', x1 + 4, y1 + (kind === 'res' ? -6 : 14));
    });

    // Ετικέτα τελευταίας τιμής
    const last = bars[n - 1].c;
    const yL = yAt(last);
    ctx.fillStyle = last >= bars[n - 1].o ? '#3ecf8e' : '#e5626b';
    ctx.fillRect(w - padR + 2, yL - 9, padR - 6, 18);
    ctx.fillStyle = '#0f1115'; ctx.textAlign = 'left';
    ctx.font = 'bold 11px -apple-system, sans-serif';
    ctx.fillText(last >= 1000 ? last.toFixed(0) : last.toFixed(2), w - padR + 8, yL + 4);
  }

  /* ------------------------------- Panels -------------------------------- */

  function renderVerdict(pred, proj) {
    const el = document.getElementById('tl-verdict');
    const map = {
      bullish: { label: 'ΑΝΟΔΙΚΗ ΤΑΣΗ', icon: '▲', color: 'var(--green)' },
      neutral: { label: 'ΟΥΔΕΤΕΡΗ / ΠΛΑΓΙΑ', icon: '◆', color: 'var(--yellow)' },
      bearish: { label: 'ΚΑΘΟΔΙΚΗ ΤΑΣΗ', icon: '▼', color: 'var(--red)' },
    };
    const v = map[pred.verdict];
    const end = proj[proj.length - 1];
    const gaugePos = (pred.composite + 100) / 2; // 0..100
    el.innerHTML = `
      <div class="lbl">Εκτίμηση τάσης · ${state.ticker} · επόμενες ~${HORIZON} συνεδριάσεις</div>
      <div class="tl-verdict-row">
        <span class="tl-verdict-icon" style="color:${v.color}">${v.icon}</span>
        <span class="tl-verdict-label" style="color:${v.color}">${v.label}</span>
        <span class="tl-conf">βεβαιότητα ~${pred.confidence}%</span>
      </div>
      <div class="tl-gauge"><div class="tl-gauge-fill" style="left:${Math.min(gaugePos, 50)}%;width:${Math.abs(gaugePos - 50)}%;background:${v.color}"></div><div class="tl-gauge-mid"></div></div>
      <div class="tl-gauge-scale"><span>-100 bearish</span><span>0</span><span>+100 bullish</span></div>
      <div class="tl-est">Εκτιμώμενο εύρος σε ${HORIZON} συνεδριάσεις:
        <b>$${fmt2(end.dn)} — $${fmt2(end.up)}</b> (μέση εκτίμηση $${fmt2(end.mid)})</div>
      ${earnWarning()}
      <div class="tl-factor-txt" style="margin-top:10px;">Συνοπτικά: ${pred.factors.map(f => f.text).join(' · ')}.</div>`;
  }

  function earnWarning() {
    const e = A.earningsInfo(state.ticker, 20);
    if (!e) return '';
    const when = e.days === 0 ? 'ΣΗΜΕΡΑ' : e.days === 1 ? 'αύριο' : `σε ${e.days} μέρες (${e.date})`;
    return `<div class="tl-factor-txt" style="color:var(--yellow);margin-top:10px;">⚠️ Earnings ${when} —
      γύρω από τα αποτελέσματα η μεταβλητότητα συχνά ξεπερνά κατά πολύ το εκτιμώμενο εύρος, προς οποιαδήποτε κατεύθυνση.</div>`;
  }

  function fmt2(v) { return v >= 1000 ? v.toFixed(0) : v.toFixed(2); }

  function renderFactors(pred) {
    const el = document.getElementById('tl-factors');
    el.innerHTML = `<div class="lbl">Τι το επηρεάζει (βάρη μοντέλου)</div>` +
      pred.factors.map(f => {
        const col = f.score > 15 ? 'var(--green)' : f.score < -15 ? 'var(--red)' : 'var(--yellow)';
        const wPct = Math.abs(f.score) / 2; // 0..50
        const side = f.score >= 0 ? 'left:50%;' : 'right:50%;';
        return `<div class="tl-factor">
          <div class="tl-factor-hd"><span>${f.label} <i>(${Math.round(f.weight * 100)}%)</i></span><span style="color:${col}">${f.score > 0 ? '+' : ''}${Math.round(f.score)}</span></div>
          <div class="tl-factor-bar"><div style="${side}width:${wPct}%;background:${col}"></div></div>
          <div class="tl-factor-txt">${f.text}</div>
        </div>`;
      }).join('');
  }

  function renderNews(ticker) {
    const el = document.getElementById('tl-news');
    const info = window.NEWS && window.NEWS.tickers && window.NEWS.tickers[ticker];
    if (!info || !info.headlines || !info.headlines.length) {
      el.innerHTML = `<div class="lbl">Ειδήσεις</div><div class="tl-factor-txt">Δεν υπάρχουν διαθέσιμες ειδήσεις (το news.json ενημερώνεται από το αυτόματο scan).</div>`;
      return;
    }
    const dot = (s) => s > 0.1 ? '🟢' : s < -0.1 ? '🔴' : '⚪';
    el.innerHTML = `
      <div class="lbl">Τελευταίες ειδήσεις · συνολικός τόνος ${info.score > 0 ? '+' : ''}${info.score} (${info.n} άρθρα)</div>
      <div class="tl-news-list">` +
      info.headlines.slice(0, 6).map(hd => `
        <a class="tl-news-item" href="${hd.u}" target="_blank" rel="noopener">
          <span>${dot(hd.s)}</span>
          <span class="tl-news-title">${escapeHtml(hd.t)}</span>
          <span class="tl-news-meta">${hd.src || ''} ${hd.d ? '· ' + hd.d : ''}</span>
        </a>`).join('') + `</div>`;
  }

  function escapeHtml(s) { return (s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ------------------------------- API ----------------------------------- */

  function render(preferredTicker) {
    ensureSkeleton();
    fillTickerSelect();
    const t = preferredTicker || state.ticker ||
      (window.POSITIONS && window.POSITIONS[0] && window.POSITIONS[0].ticker) || 'AAPL';
    if (t !== state.ticker || !state.bars2y) setTicker(t);
    else renderChartAndPanels();
  }

  return { render };
})();

/* Άνοιγμα του Trend Lab από οπουδήποτε (π.χ. κουμπί στο modal μετοχής) */
function openTrendLab(ticker) {
  if (typeof closeModal === 'function') closeModal();
  applyTab('trend', (typeof filteredData === 'function' ? filteredData() : []));
  window.TrendLab.render(ticker);
}
