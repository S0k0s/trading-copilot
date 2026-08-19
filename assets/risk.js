/* =========================================================================
   risk.js — «Ρίσκο Χαρτοφυλακίου»: αυτό που ελέγχει καθημερινά κάποιος με
   πραγματικό χαρτοφυλάκιο και όχι μόνο P&L — συγκέντρωση ανά κλάδο/αγορά,
   μέγεθος κάθε θέσης ως % του συνόλου, και «portfolio heat»: πόσο χάνεις
   αν χτυπήσουν όλα τα stops ταυτόχρονα (ATR-based εκτίμηση όταν δεν υπάρχει
   ρητό stop). Δουλεύει είτε με live sync (Trading212) είτε με το χειροκίνητο
   POSITIONS array.
   ========================================================================= */
window.PortfolioRisk = (function () {
  'use strict';
  const A = window.Analysis;

  function getUnifiedPositions() {
    if (window.T212 && Array.isArray(window.T212.positions) && window.T212.positions.length) {
      const manualByTicker = {};
      (window.POSITIONS || []).forEach(p => { manualByTicker[p.ticker] = p; });
      return window.T212.positions.map(p => {
        const d = (window.DATA || []).find(x => x.ticker === p.ticker) || {};
        const m = manualByTicker[p.ticker];
        const cur = p.current_price != null ? p.current_price : d.price;
        return {
          ticker: p.ticker, name: d.name || '', sector: d.sector || null, market: p.market || d.market || null,
          quantity: p.quantity, avgPrice: p.avg_price, currentPrice: cur,
          value: (cur != null && p.quantity != null) ? cur * p.quantity : null,
          manualStop: (m && m.stop) || null,
        };
      });
    }
    const POS = window.POSITIONS || [];
    return POS.map(p => {
      const d = (window.DATA || []).find(x => x.ticker === p.ticker) || {};
      const cur = d.price != null ? d.price : p.estPrice;
      return {
        ticker: p.ticker, name: d.name || '', sector: d.sector || null, market: d.market || null,
        quantity: p.estShares, avgPrice: p.estPrice, currentPrice: cur,
        value: (cur != null && p.estShares != null) ? cur * p.estShares : null,
        manualStop: p.stop || null,
      };
    });
  }

  /* Απόσταση stop όταν δεν έχει οριστεί ρητά: 2×ATR(14) κάτω από την
     τρέχουσα τιμή — συνηθισμένος κανόνας διαχείρισης ρίσκου. */
  async function estimateAtrStop(ticker, currentPrice) {
    const bars = await A.fetchHistory(ticker, '6M');
    const atr = A.atr(bars, 14);
    return currentPrice - 2 * atr;
  }

  async function computeRisk(positions) {
    const priced = positions.filter(p => p.value != null);
    const total = priced.reduce((a, p) => a + p.value, 0);

    const bySector = {}, byMarket = {};
    priced.forEach(p => {
      const s = p.sector || 'Άγνωστο';
      bySector[s] = (bySector[s] || 0) + p.value;
      const m = p.market || 'άγνωστη';
      byMarket[m] = (byMarket[m] || 0) + p.value;
    });

    const rows = [];
    let totalRisk = 0, riskKnownValue = 0;
    for (const p of priced) {
      let stopPrice = p.manualStop, stopSource = 'manual';
      if (stopPrice == null && p.currentPrice != null) {
        try {
          stopPrice = await estimateAtrStop(p.ticker, p.currentPrice);
          stopSource = 'atr';
        } catch (e) {
          stopPrice = null; stopSource = 'unknown';
        }
      }
      const riskPerShare = (stopPrice != null && p.currentPrice != null) ? Math.max(0, p.currentPrice - stopPrice) : null;
      const riskDollars = (riskPerShare != null && p.quantity != null) ? riskPerShare * p.quantity : null;
      if (riskDollars != null) { totalRisk += riskDollars; riskKnownValue += p.value; }
      rows.push({ ...p, stopPrice, stopSource, riskDollars, pctOfPortfolio: total ? p.value / total * 100 : null });
    }
    rows.sort((a, b) => (b.value || 0) - (a.value || 0));

    return {
      total, bySector, byMarket, rows,
      totalRisk, totalRiskPct: total ? totalRisk / total * 100 : null,
      riskCoverage: total ? riskKnownValue / total * 100 : null,
    };
  }

  /* ---------------- Rendering -------------------------------------------- */

  function concentrationRows(byGroup, total, labelFn) {
    const entries = Object.entries(byGroup).sort((a, b) => b[1] - a[1]);
    return entries.map(([key, val]) => {
      const pct = total ? val / total * 100 : 0;
      const hot = pct > 40;
      return `<div class="risk-conc-row">
        <span class="risk-conc-lbl">${labelFn(key)}</span>
        <div class="risk-conc-bar"><div style="width:${Math.min(100, pct)}%;background:${hot ? 'var(--red)' : 'var(--accent)'}"></div></div>
        <span class="risk-conc-pct ${hot ? 'g-low' : ''}">${pct.toFixed(0)}%</span>
      </div>`;
    }).join('');
  }

  function heatColor(pct) {
    if (pct == null) return 'var(--muted)';
    if (pct < 5) return 'var(--green)';
    if (pct < 15) return 'var(--yellow)';
    return 'var(--red)';
  }
  function heatLabel(pct) {
    if (pct == null) return '';
    if (pct < 5) return 'συντηρητικό';
    if (pct < 15) return 'μέτριο';
    return 'επιθετικό';
  }

  function emptyState() {
    return `<div class="tl-panel"><div class="lbl">📊 Ρίσκο Χαρτοφυλακίου</div>
      <div class="tl-factor-txt">Δεν υπάρχουν ενεργές θέσεις να αναλυθούν ακόμα.</div></div>`;
  }

  async function render(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const positions = getUnifiedPositions();
    if (!positions.length) { el.innerHTML = emptyState(); return; }
    el.innerHTML = `<div class="tl-panel"><div class="lbl">📊 Ρίσκο Χαρτοφυλακίου</div>
      <div class="tl-factor-txt">Υπολογισμός (ATR ανά θέση όπου δεν υπάρχει ορισμένο stop)…</div></div>`;

    let risk;
    try {
      risk = await computeRisk(positions);
    } catch (e) {
      el.innerHTML = `<div class="tl-panel"><div class="lbl">📊 Ρίσκο Χαρτοφυλακίου</div>
        <div class="tl-factor-txt">⚠️ Αποτυχία υπολογισμού (${e.message || e}).</div></div>`;
      return;
    }
    if (!risk.total) { el.innerHTML = emptyState(); return; }

    const heatTxt = risk.totalRiskPct != null
      ? `${risk.totalRiskPct >= 0 ? '-' : ''}${Math.abs(risk.totalRiskPct).toFixed(1)}%`
      : '—';
    const coverageNote = risk.riskCoverage != null && risk.riskCoverage < 99
      ? ` · κάλυψη ${risk.riskCoverage.toFixed(0)}% του χαρτοφυλακίου (λείπουν τιμές για τα υπόλοιπα)` : '';

    const rowsHtml = risk.rows.map(r => `
      <div class="risk-pos-row" onclick="openModal('${r.ticker}')">
        <b class="num">${r.ticker}</b>
        <span class="risk-pos-name">${r.name}</span>
        <span class="num risk-pos-pct">${r.pctOfPortfolio != null ? r.pctOfPortfolio.toFixed(1) + '%' : '—'}</span>
        <span class="num risk-pos-stop">${r.stopPrice != null ? '$' + r.stopPrice.toFixed(2) : '—'}<i>${r.stopSource === 'atr' ? ' (ATR εκτ.)' : r.stopSource === 'manual' ? ' (ορισμένο)' : ''}</i></span>
        <span class="num risk-pos-risk">${r.riskDollars != null ? '−$' + r.riskDollars.toFixed(0) : '—'}</span>
      </div>`).join('');

    el.innerHTML = `<div class="tl-panel">
      <div class="lbl">📊 Ρίσκο Χαρτοφυλακίου</div>
      <div class="risk-heat-row">
        <div class="risk-heat-box">
          <div class="risk-heat-big" style="color:${heatColor(risk.totalRiskPct)}">${heatTxt}</div>
          <div class="risk-heat-sub">Portfolio heat — αν χτυπήσουν όλα τα stops ταυτόχρονα (${heatLabel(risk.totalRiskPct)})${coverageNote}</div>
        </div>
      </div>
      <div class="risk-grid">
        <div>
          <div class="risk-subhd">Συγκέντρωση ανά κλάδο</div>
          ${concentrationRows(risk.bySector, risk.total, k => k)}
        </div>
        <div>
          <div class="risk-subhd">Συγκέντρωση ανά αγορά</div>
          ${concentrationRows(risk.byMarket, risk.total, k => (typeof MARKET_INFO !== 'undefined' && MARKET_INFO[k]) ? MARKET_INFO[k].label : k)}
        </div>
      </div>
      <div class="risk-subhd" style="margin-top:14px;">Μέγεθος &amp; ρίσκο ανά θέση</div>
      <div class="risk-pos-hd">
        <span>Ticker</span><span></span><span>% χαρτ.</span><span>Stop</span><span>Ρίσκο ($)</span>
      </div>
      ${rowsHtml}
      <div class="note" style="margin-top:10px;">Όπου δεν έχεις ορίσει ρητό stop, χρησιμοποιείται εκτίμηση 2×ATR(14)
      κάτω από την τρέχουσα τιμή — συνηθισμένος κανόνας, όχι σύσταση. Μέγεθος &gt;40% σε έναν κλάδο/αγορά σημαίνεται κόκκινο.</div>
    </div>`;
  }

  return { render };
})();
