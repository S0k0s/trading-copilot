/* =========================================================================
   skillpicks.js — "Featured picks" λωρίδες πάνω από τα tabs Swing Top 10 /
   Long-Term Top 10, με αποθηκευμένα αποτελέσματα των skills swing-trade-scout
   (skill_run.json) και long-term-investment-scout (longterm_run.json).
   Και τα δύο τρέχουν αυτόματα από cloud routines (swing: καθημερινά βράδυ,
   long-term: εβδομαδιαία) — δεν τρέχουν ζωντανά από κλικ στο site.
   ========================================================================= */
window.SkillPicks = (function () {
  'use strict';

  const cache = { swing: null, long: null };

  function escapeHtml(s) { return (s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmt2(v) { return v == null ? '—' : (v >= 1000 ? v.toFixed(0) : v.toFixed(2)); }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('el-GR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }

  function sourcesHtml(sources) {
    return (sources || []).map(s =>
      `<a href="${s.u}" target="_blank" rel="noopener">${escapeHtml(s.src || s.t || 'πηγή')}</a>`).join('');
  }

  function swingCardHtml(p) {
    return `
      <div class="sr-card">
        <div class="sr-card-hd" data-ticker="${p.ticker}">
          <span class="tk">${escapeHtml(p.ticker)}</span>
          <span class="nm">${escapeHtml(p.name || '')}</span>
        </div>
        <div class="sr-setup">${escapeHtml(p.setup || '')}</div>
        <div class="sr-catalyst">${escapeHtml(p.catalyst || '')}</div>
        <div class="sr-levels">
          <div class="sr-level entry"><span class="k">Είσοδος</span><span class="v">$${fmt2(p.entry_low)}–${fmt2(p.entry_high)}</span></div>
          <div class="sr-level stop"><span class="k">Stop</span><span class="v">$${fmt2(p.stop)}</span></div>
          <div class="sr-level target"><span class="k">Στόχος</span><span class="v">$${fmt2(p.target)}</span></div>
        </div>
        <div class="sr-rr">${p.risk_pct != null ? 'Ρίσκο ~' + p.risk_pct + '%' : ''}${p.reward_risk ? ' · R:R ' + escapeHtml(p.reward_risk) : ''}</div>
        ${p.invalidation ? `<div class="sr-invalid">🚫 ${escapeHtml(p.invalidation)}</div>` : ''}
        <div class="sr-sources">${sourcesHtml(p.sources)}</div>
      </div>`;
  }

  function longCardHtml(p) {
    return `
      <div class="sr-card">
        <div class="sr-card-hd" data-ticker="${p.ticker}">
          <span class="tk">${escapeHtml(p.ticker || '')}</span>
          <span class="nm">${escapeHtml(p.name || '')}</span>
        </div>
        ${p.category ? `<span class="sr-category">${escapeHtml(p.category)}</span>` : ''}
        <div class="sr-thesis">${escapeHtml(p.thesis || '')}</div>
        ${p.why_fits ? `<div class="sr-kv">${escapeHtml(p.why_fits)}</div>` : ''}
        ${p.growth_note ? `<div class="sr-kv">📈 <b>Ανάπτυξη:</b> ${escapeHtml(p.growth_note)}</div>` : ''}
        ${p.valuation_note ? `<div class="sr-kv">💰 <b>Αποτίμηση:</b> ${escapeHtml(p.valuation_note)}</div>` : ''}
        ${p.balance_sheet_note ? `<div class="sr-kv">🏦 <b>Ισολογισμός:</b> ${escapeHtml(p.balance_sheet_note)}</div>` : ''}
        ${p.risk ? `<div class="sr-invalid">⚠️ ${escapeHtml(p.risk)}</div>` : ''}
        ${p.horizon_note ? `<div class="sr-horizon">⏳ ${escapeHtml(p.horizon_note)}</div>` : ''}
        <div class="sr-sources">${sourcesHtml(p.sources)}</div>
      </div>`;
  }

  function wireClicks(root) {
    root.querySelectorAll('.sr-card-hd').forEach(el => {
      if (!el.dataset.ticker) return;
      el.onclick = () => { if (typeof openModal === 'function') openModal(el.dataset.ticker); };
    });
  }

  function renderBlock(kind, data, cardFn) {
    const el = document.getElementById('featured-picks');
    if (!data || !Array.isArray(data.picks) || !data.picks.length) { el.innerHTML = ''; return; }
    const title = kind === 'swing' ? '⚡ Πρόσφατα ευρήματα (swing-trade-scout)' : '🏛️ Πρόσφατα ευρήματα (long-term-investment-scout)';
    const contextTxt = data.market_context || data.macro_context || '';
    el.innerHTML = `
      <div class="sr-panel tl-panel">
        <div class="sr-featured-hd">
          <span class="t">${title}</span>
          <span class="sr-last-run">Ενημερώθηκε: ${fmtDate(data.last_run)}${data.horizon ? ' · ορίζοντας ' + escapeHtml(data.horizon) : ''}</span>
        </div>
        ${contextTxt ? `<div class="sr-context">📰 ${escapeHtml(contextTxt)}</div>` : ''}
        <div class="sr-grid">${data.picks.map(cardFn).join('')}</div>
        ${data.excluded_note ? `<div class="sr-excluded">ℹ️ ${escapeHtml(data.excluded_note)}</div>` : ''}
        ${data.risk_note ? `<div class="sr-risk">⚠️ ${escapeHtml(data.risk_note)}</div>` : ''}
      </div>`;
    wireClicks(el);
  }

  async function renderSwing() {
    if (!cache.swing) {
      try {
        const r = await fetch('skill_run.json?_=' + Date.now());
        cache.swing = r.ok ? await r.json() : null;
      } catch (e) { cache.swing = null; }
    }
    renderBlock('swing', cache.swing, swingCardHtml);
  }

  async function renderLongTerm() {
    if (!cache.long) {
      try {
        const r = await fetch('longterm_run.json?_=' + Date.now());
        cache.long = r.ok ? await r.json() : null;
      } catch (e) { cache.long = null; }
    }
    renderBlock('long', cache.long, longCardHtml);
  }

  return { renderSwing, renderLongTerm };
})();
