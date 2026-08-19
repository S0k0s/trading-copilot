/* =========================================================================
   performance.js — «Ιστορικό Επιδόσεων»: ειλικρινής, αυτόματη καταγραφή
   του τι πρότεινε πραγματικά η εφαρμογή (Top-5 Long-Term / Swing από το
   tab «Σήμερα», καταγεγραμμένο καθημερινά στο picks_history.json) και τι
   έγινε στην πράξη — win rate, μέση απόδοση, σύγκριση με SPY (S&P 500).
   ========================================================================= */
window.Performance = (function () {
  'use strict';

  function daysBetween(d1, d2) {
    return Math.round((new Date(d2 + 'T00:00:00') - new Date(d1 + 'T00:00:00')) / 86400000);
  }
  const todayISO = () => new Date().toISOString().slice(0, 10);

  function computeRow(pick, dataByTicker, snapDate, snapSpy, latestSpy) {
    const cur = dataByTicker[pick.ticker];
    if (!cur || cur.price == null) return null;
    const ret = (cur.price - pick.price) / pick.price * 100;
    const spyRet = (snapSpy != null && latestSpy != null) ? (latestSpy - snapSpy) / snapSpy * 100 : null;
    return {
      ticker: pick.ticker, market: pick.market, name: cur.name,
      entryPrice: pick.price, currentPrice: cur.price,
      ret, alpha: spyRet != null ? ret - spyRet : null,
      days: daysBetween(snapDate, todayISO()), snapDate,
    };
  }

  function buildRows(history, listKey, dataByTicker) {
    if (!history.snapshots || !history.snapshots.length) return [];
    const latestSpy = history.snapshots[history.snapshots.length - 1].spy_price;
    const rows = [];
    history.snapshots.forEach(snap => {
      if (daysBetween(snap.date, todayISO()) < 5) return; // πολύ πρόσφατο για αξιολόγηση
      (snap[listKey] || []).forEach(pick => {
        const r = computeRow(pick, dataByTicker, snap.date, snap.spy_price, latestSpy);
        if (r) rows.push(r);
      });
    });
    return rows;
  }

  function aggregate(rows) {
    if (!rows.length) return null;
    const wins = rows.filter(r => r.ret > 0).length;
    const withAlpha = rows.filter(r => r.alpha != null);
    return {
      n: rows.length,
      winRate: wins / rows.length * 100,
      avgRet: rows.reduce((a, r) => a + r.ret, 0) / rows.length,
      avgAlpha: withAlpha.length ? withAlpha.reduce((a, r) => a + r.alpha, 0) / withAlpha.length : null,
    };
  }

  function statCard(label, rows) {
    const s = aggregate(rows);
    if (!s) return `<div class="perf-stat-card"><div class="lbl">${label}</div>
      <div class="tl-factor-txt">Καμία επιλογή δεν έφτασε ακόμα αυτό το διάστημα.</div></div>`;
    const col = s.avgRet >= 0 ? 'var(--green)' : 'var(--red)';
    const alphaTxt = s.avgAlpha != null
      ? ` · ${s.avgAlpha >= 0 ? '+' : ''}${s.avgAlpha.toFixed(1)}% vs SPY` : '';
    return `<div class="perf-stat-card">
      <div class="lbl">${label} <i>(n=${s.n})</i></div>
      <div class="perf-big" style="color:${col}">${s.avgRet >= 0 ? '+' : ''}${s.avgRet.toFixed(1)}%</div>
      <div class="perf-sub">win rate ${s.winRate.toFixed(0)}%${alphaTxt}</div>
    </div>`;
  }

  function section(title, rows) {
    const b1 = rows.filter(r => r.days >= 5 && r.days < 10);
    const b2 = rows.filter(r => r.days >= 10 && r.days < 20);
    const b3 = rows.filter(r => r.days >= 20);
    const tableRows = rows.slice().sort((a, b) => b.days - a.days).slice(0, 20).map(r => `
      <tr onclick="openModal('${r.ticker}')" style="cursor:pointer;">
        <td class="tk-cell">${marketFlag(r.market)} ${r.ticker}<div class="nm-cell">${r.name || ''}</div></td>
        <td>${r.snapDate}</td>
        <td>${r.days}μ</td>
        <td class="${r.ret >= 0 ? 'g-high' : 'g-low'}">${r.ret >= 0 ? '+' : ''}${r.ret.toFixed(1)}%</td>
        <td class="${(r.alpha || 0) >= 0 ? 'g-high' : 'g-low'}">${r.alpha != null ? (r.alpha >= 0 ? '+' : '') + r.alpha.toFixed(1) + '%' : '—'}</td>
      </tr>`).join('');
    return `<div class="tl-panel">
      <div class="lbl">${title}</div>
      <div class="perf-stats-row">
        ${statCard('~1 εβδομάδα', b1)}
        ${statCard('~2 εβδομάδες', b2)}
        ${statCard('~1 μήνας+', b3)}
      </div>
      ${rows.length ? `<div style="overflow-x:auto;margin-top:12px;"><table>
        <thead><tr><th>Μετοχή</th><th>Επιλέχθηκε</th><th>Πέρασαν</th><th>Απόδοση</th><th>vs SPY</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table></div>` : `<div class="tl-factor-txt" style="margin-top:8px;">Δεν υπάρχουν ακόμα αρκετά ώριμες καταγραφές (χρειάζονται ≥5 μέρες).</div>`}
    </div>`;
  }

  function emptyState(firstDate) {
    return `<div class="tl-panel">
      <div class="lbl">📈 Ιστορικό Επιδόσεων</div>
      <div class="tl-factor-txt">${firstDate
        ? `Η καταγραφή ξεκίνησε ${firstDate}. Χρειάζονται τουλάχιστον 5 μέρες από την πρώτη καταγραφή για
           να εμφανιστούν τα πρώτα πραγματικά αποτελέσματα — πέρνα ξανά σε λίγες μέρες.`
        : `Η καταγραφή ξεκινάει με το επόμενο αυτόματο scan. Κάθε μέρα θα αποθηκεύεται ποιες μετοχές ήταν
           στο Top-5 Long-Term/Swing του tab «Σήμερα» — σε λίγες μέρες θα βλέπεις εδώ πραγματικά
           αποτελέσματα αντί για υποθέσεις.`}
      </div>
    </div>`;
  }

  async function render() {
    const wrap = document.getElementById('performance');
    if (!wrap) return;
    wrap.innerHTML = `<div class="tl-factor-txt">Φόρτωση ιστορικού…</div>`;
    let history = { snapshots: [] };
    try {
      const r = await fetch('picks_history.json?_=' + Date.now());
      if (r.ok) history = await r.json();
    } catch (e) { /* κανένα ιστορικό ακόμα */ }

    if (!history.snapshots || !history.snapshots.length) {
      wrap.innerHTML = emptyState(null);
      return;
    }
    const firstDate = history.snapshots[0].date;
    const dataByTicker = {};
    (window.DATA || []).forEach(d => { dataByTicker[d.ticker] = d; });

    const ltRows = buildRows(history, 'long_term_top5', dataByTicker);
    const swRows = buildRows(history, 'swing_top5', dataByTicker);

    if (!ltRows.length && !swRows.length) {
      wrap.innerHTML = emptyState(firstDate);
      return;
    }
    wrap.innerHTML = `
      <div class="note" style="margin-bottom:16px;">📊 Αυτόματη, ειλικρινής καταγραφή: κάθε μέρα αποθηκεύουμε
      ποιες μετοχές ήταν στο Top-5 Long-Term/Swing του tab «Σήμερα», και εδώ συγκρίνουμε τι έγιναν
      <b>πραγματικά</b> έναντι του S&amp;P 500 (μέσω SPY). Καταγραφή από ${firstDate}.
      <b>Δεν</b> είναι εγγύηση για το μέλλον — ο σκοπός είναι να βλέπουμε αν το μοντέλο όντως δουλεύει, με στοιχεία.</div>
      ${section('🏛️ Long-Term Top 5 — πραγματική απόδοση', ltRows)}
      ${section('⚡ Swing Top 5 — πραγματική απόδοση', swRows)}
    `;
  }

  return { render };
})();
