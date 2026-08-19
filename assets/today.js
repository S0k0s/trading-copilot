/* =========================================================================
   today.js — «Σήμερα»: αρχική οθόνη dashboard. Σε μία ματιά: χαρτοφυλάκιο,
   κατάσταση βασικών αγορών, earnings της εβδομάδας (θέσεις μου πρώτα),
   και οι μετοχές που περνούν σήμερα το Quest 5/5.
   ========================================================================= */
window.Today = (function () {
  'use strict';

  function greeting() {
    const h = new Date().getHours();
    const g = h < 12 ? 'Καλημέρα' : h < 19 ? 'Καλησπέρα' : 'Καλό βράδυ';
    const dateStr = new Date().toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' });
    return `<div class="tdy-greet">${g} 👋 <span>${dateStr}</span></div>`;
  }

  function pfEuro(v) {
    if (v == null) return '—';
    const sign = v >= 0 ? '+' : '';
    return sign + v.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '€';
  }

  /* ---------------- Χαρτοφυλάκιο ------------------------------------------ */

  function portfolioSection() {
    const t = window.T212;
    if (t && Array.isArray(t.positions) && t.positions.length) {
      const c = t.cash || {};
      const pnl = c.ppl, inv = c.invested;
      const pct = (inv && pnl != null) ? pnl / inv * 100 : null;
      const col = (pnl || 0) >= 0 ? 'var(--green)' : 'var(--red)';
      const posRows = window.t212EurValues(t).map(p => {
        const pnlPct = (p.avg_price && p.current_price) ? (p.current_price - p.avg_price) / p.avg_price * 100 : null;
        const pcol = (pnlPct || 0) >= 0 ? 'var(--green)' : 'var(--red)';
        return `<div class="tdy-pf-pos-row" onclick="openModal('${p.ticker}')">
          <div class="tdy-pf-pos-tk"><b class="num">${p.ticker}</b><span class="tdy-pf-pos-entry">είσοδος $${p.avg_price != null ? p.avg_price.toFixed(2) : '—'}</span></div>
          <div class="tdy-pf-pos-right">
            <span class="num" style="color:${pcol}">${pnlPct != null ? (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(1) + '%' : '—'}</span>
            <b class="num">${p.valueEur != null ? '€' + p.valueEur.toFixed(2) : '—'}</b>
          </div>
        </div>`;
      }).join('');
      return `<div class="tl-panel">
        <div class="lbl" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <span>💼 Χαρτοφυλάκιο <i style="color:var(--muted);font-weight:400;text-transform:none;">· live sync Trading212</i></span>
          <button class="t212-refresh-btn" style="text-transform:none;" onclick="refreshT212Live(this)">🔄 Ανανέωση</button>
        </div>
        <div class="tdy-pf-row">
          <div><span class="tdy-lbl">Επενδεδυμένο</span><b class="num">${inv != null ? '€' + inv.toFixed(2) : '—'}</b></div>
          <div><span class="tdy-lbl">P&amp;L</span><b class="num" style="color:${col}">${pnl != null ? pfEuro(pnl) : '—'}${pct != null ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}</b></div>
          <div><span class="tdy-lbl">Θέσεις</span><b class="num">${t.positions.length}</b></div>
        </div>
        <div class="tdy-pf-positions">${posRows}</div>
        <div class="tdy-link" onclick="selectTab('positions')">Δες αναλυτικά →</div>
      </div>`;
    }
    const POS = window.POSITIONS || [];
    if (POS.length) {
      let totalInvested = 0, totalNow = 0;
      POS.forEach(p => {
        const d = (window.DATA || []).find(x => x.ticker === p.ticker);
        totalInvested += p.invested;
        totalNow += (d && d.price) ? d.price * p.estShares : p.invested;
      });
      const pnl = totalNow - totalInvested;
      const pct = totalInvested ? pnl / totalInvested * 100 : 0;
      const col = pnl >= 0 ? 'var(--green)' : 'var(--red)';
      return `<div class="tl-panel">
        <div class="lbl">💼 Χαρτοφυλάκιο</div>
        <div class="tdy-pf-row">
          <div><span class="tdy-lbl">Επενδεδυμένο</span><b class="num">€${totalInvested.toFixed(2)}</b></div>
          <div><span class="tdy-lbl">P&amp;L</span><b class="num" style="color:${col}">${pfEuro(pnl)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)</b></div>
          <div><span class="tdy-lbl">Θέσεις</span><b class="num">${POS.length}</b></div>
        </div>
        <div class="tdy-link" onclick="selectTab('positions')">Δες αναλυτικά →</div>
      </div>`;
    }
    return `<div class="tl-panel"><div class="lbl">💼 Χαρτοφυλάκιο</div>
      <div class="tl-factor-txt">Ενεργοποίησε το αυτόματο sync από το Trading212 (T212_API_KEY) για να δεις εδώ
      το χαρτοφυλάκιό σου.</div></div>`;
  }

  /* ---------------- Αγορές (mini) ----------------------------------------- */

  const STATUS_LABEL = { open: 'Ανοιχτή', closed: 'Κλειστή', lunch: 'Παύση', pre: 'Pre-market', after: 'After-hours' };
  const STATUS_DOT = { open: 'var(--green)', closed: 'var(--red)', lunch: 'var(--yellow)', pre: 'var(--yellow)', after: 'var(--yellow)' };

  function marketsSection() {
    if (!window.Markets || !Markets.MARKETS) {
      return `<div class="tl-panel"><div class="lbl">🕒 Παγκόσμιες αγορές</div>
        <div class="tl-factor-txt">Φόρτωση…</div></div>`;
    }
    const ids = ['nyse', 'lse', 'athex', 'tokyo'];
    const rows = ids.map(id => {
      const mkt = Markets.MARKETS.find(m => m.id === id);
      if (!mkt) return '';
      const st = Markets.marketStatus(mkt);
      return `<div class="tdy-mkt"><span class="mk-dot" style="background:${STATUS_DOT[st.status]}"></span>
        ${mkt.flag} ${mkt.name} <i>${STATUS_LABEL[st.status]}</i></div>`;
    }).join('');
    return `<div class="tl-panel">
      <div class="lbl">🕒 Παγκόσμιες αγορές</div>
      <div class="tdy-mkt-row">${rows}</div>
      <div class="tdy-link" onclick="selectTab('markets')">Όλες οι αγορές &amp; ώρες →</div>
    </div>`;
  }

  /* ---------------- Κορυφαίες επιλογές σήμερα (Top 5 Long-Term / Swing) --- */

  function pickCard(d, reasonFn, scoreKey) {
    const q = d.quest_pass === 5 ? ' <span class="quest-badge" style="margin-left:4px;">🎯5/5</span>' : '';
    const score = d[scoreKey];
    const scoreCol = score >= 70 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--red)';
    const flag = (typeof marketFlag === 'function') ? marketFlag(d.market) + ' ' : '';
    return `<div class="pick-card" onclick="openModal('${d.ticker}')">
      <div class="pick-hd">${flag}<b class="num">${d.ticker}</b>${q}<span class="pick-name">${d.name || ''}</span>
        <span class="spark-holder pick-spark" data-ticker="${d.ticker}"></span>
        <span class="num pick-score" style="color:${scoreCol}">${score != null ? score.toFixed(1) : '—'}</span></div>
      <div class="pick-reason">${reasonFn(d)}</div>
    </div>`;
  }

  function dailyPicksSection() {
    const data = window.DATA || [];
    if (!data.length) {
      return `<div class="tl-panel"><div class="lbl">🏆 Κορυφαίες επιλογές σήμερα</div>
        <div class="tl-factor-txt">Φόρτωση…</div></div>`;
    }
    const lt = data.filter(d => d.long_term_score != null).sort((a, b) => b.long_term_score - a.long_term_score).slice(0, 5);
    const sw = data.filter(d => d.swing_score != null).sort((a, b) => b.swing_score - a.swing_score).slice(0, 5);
    return `<div class="tl-panel">
      <div class="lbl">🏆 Κορυφαίες επιλογές σήμερα — αυτόματα, βάσει scores (όχι σύσταση αγοράς)</div>
      <div class="picks-cols">
        <div>
          <div class="picks-subhd">🏛️ Long-Term (top 5)</div>
          ${lt.map(d => pickCard(d, window.longTermReason, 'long_term_score')).join('')}
        </div>
        <div>
          <div class="picks-subhd">⚡ Swing (top 5)</div>
          ${sw.map(d => pickCard(d, window.swingReason, 'swing_score')).join('')}
        </div>
      </div>
      <div class="tl-factor-txt" style="margin-top:8px;">Αυτόματη κατάταξη βάσει δημόσιων δεδομένων και του
      καθορισμένου τύπου (δες Μεθοδολογία στο τέλος) — ανανεώνεται με κάθε scan. <b>Δεν</b> λαμβάνει υπόψη
      τη δική σου ανοχή ρίσκου ή το ήδη υπάρχον χαρτοφυλάκιό σου.</div>
    </div>`;
  }

  /* ---------------- Earnings αυτή την εβδομάδα ---------------------------- */

  function earningsSection() {
    const news = window.NEWS && window.NEWS.tickers;
    if (!news) {
      return `<div class="tl-panel"><div class="lbl">📅 Earnings αυτή την εβδομάδα</div>
        <div class="tl-factor-txt">Φόρτωση…</div></div>`;
    }
    const posSet = new Set();
    if (window.T212 && Array.isArray(window.T212.positions)) window.T212.positions.forEach(p => posSet.add(p.ticker));
    (window.POSITIONS || []).forEach(p => posSet.add(p.ticker));

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const rows = [];
    for (const tk of Object.keys(news)) {
      const iso = news[tk].earnings_date;
      if (!iso) continue;
      const days = Math.round((new Date(iso + 'T00:00:00') - today) / 86400000);
      if (days < 0 || days > 7) continue;
      const stock = (window.DATA || []).find(x => x.ticker === tk) || {};
      rows.push({ tk, name: stock.name || '', days, mine: posSet.has(tk) });
    }
    rows.sort((a, b) => (b.mine - a.mine) || (a.days - b.days));

    if (!rows.length) {
      return `<div class="tl-panel"><div class="lbl">📅 Earnings αυτή την εβδομάδα</div>
        <div class="tl-factor-txt">Καμία γνωστή ανακοίνωση στις επόμενες 7 μέρες.</div></div>`;
    }
    const chip = (d) => d === 0 ? 'ΣΗΜΕΡΑ' : d === 1 ? 'αύριο' : `σε ${d} μέρες`;
    const list = rows.slice(0, 8).map(r => `
      <div class="earn-row" onclick="openModal('${r.tk}')">
        <b class="num">${r.tk}</b><span class="earn-name">${r.name}</span>
        ${r.mine ? '<span class="earn-chip mine">💼 θέση</span>' : ''}
        <span class="earn-chip ${r.days <= 1 ? 'hot' : 'soon'}">${chip(r.days)}</span>
      </div>`).join('');
    return `<div class="tl-panel">
      <div class="lbl">📅 Earnings αυτή την εβδομάδα</div>
      ${list}
      <div class="tdy-link" onclick="selectTab('markets')">Πλήρες ημερολόγιο (60 μέρες) →</div>
    </div>`;
  }

  /* ---------------- Quest 5/5 highlights ---------------------------------- */

  function questSection() {
    const data = window.DATA || [];
    if (!data.length) {
      return `<div class="tl-panel"><div class="lbl">🎯 Quest 5/5</div>
        <div class="tl-factor-txt">Φόρτωση…</div></div>`;
    }
    const full = data.filter(d => d.quest_pass === 5);
    if (!full.length) {
      return `<div class="tl-panel"><div class="lbl">🎯 Quest 5/5</div>
        <div class="tl-factor-txt">Καμία μετοχή του universe δεν περνάει σήμερα και τις 5 ερωτήσεις — φυσιολογικό, το φίλτρο είναι αυστηρό.</div></div>`;
    }
    const cards = full.slice(0, 8).map(d => `
      <div class="tdy-quest-card" onclick="openModal('${d.ticker}')">
        <b class="num">${d.ticker}</b><span>${d.name || ''}</span>
      </div>`).join('');
    return `<div class="tl-panel">
      <div class="lbl">🎯 Quest 5/5 — περνούν όλο το φίλτρο ποιότητας (${full.length} από ${data.length})</div>
      <div class="tdy-quest-grid">${cards}</div>
      <div class="tdy-link" onclick="selectTab('all')">Δες όλες τις μετοχές →</div>
    </div>`;
  }

  /* ------------------------------------------------------------------------ */

  function render() {
    const wrap = document.getElementById('today');
    if (!wrap) return;
    wrap.innerHTML = `
      ${greeting()}
      <div class="tdy-grid">
        ${portfolioSection()}
        ${marketsSection()}
      </div>
      ${dailyPicksSection()}
      ${earningsSection()}
      ${questSection()}
    `;
    window.Analysis && Analysis.fillSparklines(wrap, '.pick-spark');
  }

  return { render };
})();
