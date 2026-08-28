/* =========================================================================
   skillrun.js — "Skill Run": δείχνει τα αποθηκευμένα αποτελέσματα του
   /swing-trade-scout skill (ζωντανή έρευνα web, τρέχει από τον Claude σε
   συνεδρία, ΟΧΙ αυτόματα). Το κουμπί απλά ξαναφέρνει το τρέχον skill_run.json
   — για φρέσκα αποτελέσματα πρέπει να ζητηθεί από τον Claude νέο run.
   ========================================================================= */
window.SkillRun = (function () {
  'use strict';

  const state = { data: null, loading: false, error: null, initialized: false };

  function ensureSkeleton() {
    if (state.initialized) return;
    const wrap = document.getElementById('skillrun');
    wrap.innerHTML = `
      <div class="sr-toolbar">
        <button id="sr-run-btn" class="t212-refresh-btn">🔄 Ανανέωση</button>
        <span id="sr-last-run" class="sr-last-run"></span>
      </div>
      <div id="sr-body"></div>
      <div class="note">⚠️ Οι προτάσεις εδώ προέρχονται από ζωντανή έρευνα (ειδήσεις, καταλύτες, τεχνικά επίπεδα) που κάνει αυτόματα ο Claude κάθε βράδυ Δευ-Παρ (~00:00 ώρα Ελλάδας, μετά το κλείσιμο ΗΠΑ) μέσω του <code>/swing-trade-scout</code>. Το κουμπί απλά ξαναφορτώνει ό,τι πιο πρόσφατο έχει αποθηκευτεί — δεν ξεκινάει νέα έρευνα από μόνο του. <b>Δεν</b> είναι επενδυτική συμβουλή ούτε εγγύηση — δικιά σου έρευνα/απόφαση για μέγεθος θέσης και ρίσκο.</div>`;
    document.getElementById('sr-run-btn').onclick = load;
    state.initialized = true;
  }

  async function load() {
    const btn = document.getElementById('sr-run-btn');
    const body = document.getElementById('sr-body');
    state.loading = true; state.error = null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Φόρτωση...'; }
    body.innerHTML = '<div class="sr-loading">⏳ Φόρτωση αποτελεσμάτων…</div>';
    try {
      const r = await fetch('skill_run.json?_=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      state.data = await r.json();
      renderBody();
    } catch (e) {
      state.error = e;
      body.innerHTML = `<div class="sr-empty">⚠️ Δεν βρέθηκαν ακόμα αποτελέσματα (${escapeHtml(e.message || String(e))}).<br>Ζήτησε από τον Claude «τρέξε το swing-trade-scout skill και ενημέρωσε το Skill Run tab» για να δημιουργηθεί/ανανεωθεί το <code>skill_run.json</code>.</div>`;
    } finally {
      state.loading = false;
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Ανανέωση'; }
    }
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('el-GR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }

  function escapeHtml(s) { return (s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmt2(v) { return v == null ? '—' : (v >= 1000 ? v.toFixed(0) : v.toFixed(2)); }

  function cardHtml(p) {
    const sources = (p.sources || []).map(s =>
      `<a href="${s.u}" target="_blank" rel="noopener">${escapeHtml(s.src || s.t || 'πηγή')}</a>`).join('');
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
        ${sources ? `<div class="sr-sources">${sources}</div>` : ''}
      </div>`;
  }

  function renderBody() {
    const d = state.data;
    const body = document.getElementById('sr-body');
    const lastRunEl = document.getElementById('sr-last-run');
    if (!d || !Array.isArray(d.picks) || !d.picks.length) {
      if (lastRunEl) lastRunEl.textContent = '';
      body.innerHTML = `<div class="sr-empty">Δεν υπάρχουν αποτελέσματα ακόμα.<br>Ζήτησε από τον Claude «τρέξε το swing-trade-scout skill» για να γεμίσει αυτή η καρτέλα.</div>`;
      return;
    }
    if (lastRunEl) {
      lastRunEl.textContent = 'Τελευταία εκτέλεση: ' + fmtDate(d.last_run) + (d.horizon ? ' · ορίζοντας ' + d.horizon : '');
    }
    body.innerHTML = `
      ${d.market_context ? `<div class="sr-context">📰 ${escapeHtml(d.market_context)}</div>` : ''}
      <div class="sr-grid">${d.picks.map(cardHtml).join('')}</div>
      ${d.excluded_note ? `<div class="sr-excluded">ℹ️ ${escapeHtml(d.excluded_note)}</div>` : ''}
      ${d.risk_note ? `<div class="sr-risk">⚠️ ${escapeHtml(d.risk_note)}</div>` : ''}`;
    body.querySelectorAll('.sr-card-hd').forEach(el => {
      el.onclick = () => { if (typeof openModal === 'function') openModal(el.dataset.ticker); };
    });
  }

  function render() {
    ensureSkeleton();
    if (state.data) renderBody();
    else load();
  }

  return { render };
})();
