/* =========================================================================
   markets.js — "Αγορές": ώρες συνεδρίασης των μεγάλων χρηματιστηρίων σε
   όλο τον κόσμο, με live status (DST-aware μέσω Intl/timezones), αντίστροφη
   μέτρηση και 24ωρο timeline στην τοπική ώρα του χρήστη.
   Σημείωση: κανονικές συνεδριάσεις Δευ–Παρ, χωρίς τοπικές αργίες.
   ========================================================================= */
window.Markets = (function () {
  'use strict';

  // sessions: [ [άνοιγμα, κλείσιμο] ] σε τοπική ώρα αγοράς (λεπτά από 00:00)
  const MIN = (h, m) => h * 60 + (m || 0);
  const MARKETS = [
    { id: 'nyse',  flag: '🇺🇸', name: 'NYSE / NASDAQ', city: 'Νέα Υόρκη', tz: 'America/New_York',
      sessions: [[MIN(9, 30), MIN(16, 0)]], pre: [MIN(4, 0), MIN(9, 30)], after: [MIN(16, 0), MIN(20, 0)] },
    { id: 'tsx',   flag: '🇨🇦', name: 'TSX', city: 'Τορόντο', tz: 'America/Toronto',
      sessions: [[MIN(9, 30), MIN(16, 0)]] },
    { id: 'lse',   flag: '🇬🇧', name: 'LSE', city: 'Λονδίνο', tz: 'Europe/London',
      sessions: [[MIN(8, 0), MIN(16, 30)]] },
    { id: 'xetra', flag: '🇩🇪', name: 'XETRA', city: 'Φρανκφούρτη', tz: 'Europe/Berlin',
      sessions: [[MIN(9, 0), MIN(17, 30)]] },
    { id: 'paris', flag: '🇫🇷', name: 'Euronext', city: 'Παρίσι', tz: 'Europe/Paris',
      sessions: [[MIN(9, 0), MIN(17, 30)]] },
    { id: 'athex', flag: '🇬🇷', name: 'ATHEX', city: 'Αθήνα', tz: 'Europe/Athens',
      sessions: [[MIN(10, 0), MIN(17, 20)]] },
    { id: 'tokyo', flag: '🇯🇵', name: 'TSE', city: 'Τόκιο', tz: 'Asia/Tokyo',
      sessions: [[MIN(9, 0), MIN(11, 30)], [MIN(12, 30), MIN(15, 30)]] },
    { id: 'hkex',  flag: '🇭🇰', name: 'HKEX', city: 'Χονγκ Κονγκ', tz: 'Asia/Hong_Kong',
      sessions: [[MIN(9, 30), MIN(12, 0)], [MIN(13, 0), MIN(16, 0)]] },
    { id: 'sse',   flag: '🇨🇳', name: 'SSE', city: 'Σανγκάη', tz: 'Asia/Shanghai',
      sessions: [[MIN(9, 30), MIN(11, 30)], [MIN(13, 0), MIN(15, 0)]] },
    { id: 'nse',   flag: '🇮🇳', name: 'NSE', city: 'Μουμπάι', tz: 'Asia/Kolkata',
      sessions: [[MIN(9, 15), MIN(15, 30)]] },
    { id: 'asx',   flag: '🇦🇺', name: 'ASX', city: 'Σίδνεϊ', tz: 'Australia/Sydney',
      sessions: [[MIN(10, 0), MIN(16, 0)]] },
    { id: 'crypto', flag: '₿', name: 'Crypto', city: 'παντού', tz: null, sessions: 'always' },
  ];

  let timer = null;
  let initialized = false;

  /* ---------------- Υπολογισμοί ώρας/κατάστασης -------------------------- */

  function localPartsIn(tz, date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || undefined, weekday: 'short',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
    }).formatToParts(date || new Date());
    const get = (t) => parts.find(p => p.type === t)?.value;
    const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      weekday: wdMap[get('weekday')],
      minutes: (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10),
      timeStr: String(parseInt(get('hour'), 10) % 24).padStart(2, '0') + ':' + get('minute').padStart(2, '0'),
    };
  }

  function fmtMin(m) {
    m = ((m % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  function fmtCountdown(mins) {
    if (mins >= 60 * 24) {
      const d = Math.floor(mins / 1440);
      return d + ' ημ. ' + Math.floor((mins % 1440) / 60) + 'ω';
    }
    if (mins >= 60) return Math.floor(mins / 60) + 'ω ' + (mins % 60) + 'λ';
    return mins + 'λ';
  }

  /**
   * Κατάσταση αγοράς: {status: 'open'|'lunch'|'pre'|'after'|'closed',
   *   nextLabel, nextInMin}
   */
  function marketStatus(mkt) {
    if (mkt.sessions === 'always') return { status: 'open', nextLabel: '24/7', nextInMin: null };
    const { weekday, minutes } = localPartsIn(mkt.tz);
    const isWeekday = weekday >= 1 && weekday <= 5;

    if (isWeekday) {
      for (const [o, c] of mkt.sessions) {
        if (minutes >= o && minutes < c) {
          return { status: 'open', nextLabel: 'κλείνει σε', nextInMin: c - minutes };
        }
      }
      if (mkt.sessions.length === 2) {
        const [, c1] = mkt.sessions[0], [o2] = mkt.sessions[1];
        if (minutes >= c1 && minutes < o2) {
          return { status: 'lunch', nextLabel: 'ξανανοίγει σε', nextInMin: o2 - minutes };
        }
      }
      if (mkt.pre && minutes >= mkt.pre[0] && minutes < mkt.pre[1]) {
        return { status: 'pre', nextLabel: 'κύρια συνεδρίαση σε', nextInMin: mkt.pre[1] - minutes };
      }
      if (mkt.after && minutes >= mkt.after[0] && minutes < mkt.after[1]) {
        return { status: 'after', nextLabel: 'μετά το κλείσιμο · τέλος σε', nextInMin: mkt.after[1] - minutes };
      }
    }
    // Κλειστή: βρες το επόμενο άνοιγμα (σήμερα αργότερα ή επόμενη εργάσιμη)
    const firstOpen = mkt.sessions[0][0];
    let daysAhead = 0, mins = 0;
    if (isWeekday && minutes < firstOpen) {
      mins = firstOpen - minutes;
    } else {
      let wd = weekday;
      do { daysAhead++; wd = (wd + 1) % 7; } while (wd === 0 || wd === 6);
      mins = (1440 - minutes) + (daysAhead - 1) * 1440 + firstOpen;
    }
    return { status: 'closed', nextLabel: 'ανοίγει σε', nextInMin: mins };
  }

  /* ---------------- Rendering -------------------------------------------- */

  const STATUS_INFO = {
    open:   { dot: '#3ecf8e', label: 'Ανοιχτή' },
    lunch:  { dot: '#e8c547', label: 'Μεσημεριανή παύση' },
    pre:    { dot: '#e8c547', label: 'Pre-market' },
    after:  { dot: '#e8c547', label: 'After-hours' },
    closed: { dot: '#e5626b', label: 'Κλειστή' },
  };

  function ensureSkeleton() {
    if (initialized) return;
    const wrap = document.getElementById('markets');
    wrap.innerHTML = `
      <div class="mk-header">
        <div class="lbl">Παγκόσμιες αγορές — όλα σε μια ματιά</div>
        <div class="mk-now">Τοπική σου ώρα: <b id="mk-local-clock">—</b></div>
      </div>
      <div id="mk-timeline" class="mk-timeline-card"></div>
      <div id="mk-cards" class="mk-cards"></div>
      <div class="note">Οι ώρες αφορούν κανονικές συνεδριάσεις Δευτέρα–Παρασκευή και προσαρμόζονται αυτόματα σε
      θερινή/χειμερινή ώρα κάθε χώρας. Δεν περιλαμβάνονται τοπικές αργίες. Για NYSE/NASDAQ εμφανίζεται και
      pre-market (04:00–09:30 ΝΥ) / after-hours (16:00–20:00 ΝΥ).</div>`;
    initialized = true;
  }

  function renderCards() {
    const el = document.getElementById('mk-cards');
    el.innerHTML = MARKETS.map(mkt => {
      const st = marketStatus(mkt);
      const info = STATUS_INFO[st.status];
      const localTime = mkt.tz ? localPartsIn(mkt.tz).timeStr : '—';
      const sessTxt = mkt.sessions === 'always' ? 'Συνεχής λειτουργία 24/7'
        : mkt.sessions.map(([o, c]) => fmtMin(o) + '–' + fmtMin(c)).join(' & ') + ' τοπική';
      const cd = st.nextInMin != null
        ? `<span class="mk-count">${st.nextLabel} <b>${fmtCountdown(st.nextInMin)}</b></span>` : '';
      return `<div class="mk-card${st.status === 'open' ? ' open' : ''}">
        <div class="mk-card-hd">
          <span class="mk-flag">${mkt.flag}</span>
          <div><b>${mkt.name}</b><div class="mk-city">${mkt.city}${mkt.tz ? ' · ' + localTime : ''}</div></div>
          <span class="mk-dot" style="background:${info.dot}"></span>
        </div>
        <div class="mk-status" style="color:${info.dot}">${info.label}</div>
        <div class="mk-sess">${sessTxt}</div>
        ${cd}
      </div>`;
    }).join('');
  }

  function renderTimeline() {
    const el = document.getElementById('mk-timeline');
    const now = new Date();
    const userNowMin = now.getHours() * 60 + now.getMinutes();
    const rows = MARKETS.filter(m => m.sessions !== 'always').map(mkt => {
      // Μετατροπή των sessions της αγοράς σε τοπική ώρα ΧΡΗΣΤΗ:
      // διαφορά = τοπική ώρα αγοράς - τοπική ώρα χρήστη (ίδια στιγμή)
      const mktNow = localPartsIn(mkt.tz).minutes;
      const offset = ((mktNow - userNowMin) % 1440 + 1440) % 1440;
      const segs = [];
      const pushSeg = (o, c, cls) => {
        let uo = ((o - offset) % 1440 + 1440) % 1440;
        let uc = ((c - offset) % 1440 + 1440) % 1440;
        if (uc <= uo) { // τυλίγει τα μεσάνυχτα — σπάσε σε 2
          segs.push([uo, 1440, cls]); segs.push([0, uc, cls]);
        } else segs.push([uo, uc, cls]);
      };
      if (mkt.pre) pushSeg(mkt.pre[0], mkt.pre[1], 'ext');
      if (mkt.after) pushSeg(mkt.after[0], mkt.after[1], 'ext');
      mkt.sessions.forEach(([o, c]) => pushSeg(o, c, 'main'));
      const st = marketStatus(mkt);
      const segHtml = segs.map(([o, c, cls]) =>
        `<div class="mk-seg ${cls}" style="left:${o / 1440 * 100}%;width:${(c - o) / 1440 * 100}%"></div>`).join('');
      return `<div class="mk-tl-row">
        <div class="mk-tl-name">${mkt.flag} ${mkt.name}${st.status === 'open' ? ' <span class="mk-live">●</span>' : ''}</div>
        <div class="mk-tl-track">${segHtml}</div>
      </div>`;
    }).join('');
    // Τα tracks ξεκινούν μετά τη στήλη ονομάτων (130px + 10px gap) —
    // άξονας και γραμμή "τώρα" ευθυγραμμίζονται με calc() πάνω σε αυτό.
    const pos = (frac) => `left:calc(140px + (100% - 140px) * ${frac})`;
    const hourMarks = [0, 3, 6, 9, 12, 15, 18, 21, 24].map(hh =>
      `<span style="${pos(hh / 24)}">${String(hh).padStart(2, '0')}</span>`).join('');
    el.innerHTML = `
      <div class="lbl">24ωρο — πότε είναι ανοιχτή κάθε αγορά <i>στη δική σου ώρα</i></div>
      <div class="mk-tl-wrap">
        <div class="mk-tl-rows">${rows}</div>
        <div class="mk-tl-axis">${hourMarks}</div>
        <div class="mk-tl-now" style="${pos(userNowMin / 1440)}"><span>τώρα</span></div>
      </div>
      <div class="mk-tl-legend">
        <span><i class="mk-seg-demo main"></i> κύρια συνεδρίαση</span>
        <span><i class="mk-seg-demo ext"></i> pre/after-hours (μόνο ΗΠΑ)</span>
      </div>`;
  }

  function tick() {
    const visible = document.getElementById('markets').style.display !== 'none';
    if (!visible) return;
    const clock = document.getElementById('mk-local-clock');
    if (clock) clock.textContent = new Date().toLocaleTimeString('el-GR');
  }

  function render() {
    ensureSkeleton();
    renderCards();
    renderTimeline();
    tick();
    if (!timer) {
      timer = setInterval(() => {
        const visible = document.getElementById('markets').style.display !== 'none';
        if (!visible) return;
        tick();
        if (!render._lastFull || Date.now() - render._lastFull > 30000) {
          render._lastFull = Date.now();
          renderCards(); renderTimeline();
        }
      }, 1000);
      render._lastFull = Date.now();
    }
  }

  return { render };
})();
