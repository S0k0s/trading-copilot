/* =========================================================================
   analysis.js — κοινή βιβλιοθήκη: ιστορικά δεδομένα, δείκτες, κανάλι
   στήριξης/αντίστασης, προβολή τάσης, mini backtests, canvas helpers.
   Χρησιμοποιείται από: Trend Lab, Event Patterns, Στρατηγικές.
   ========================================================================= */
window.Analysis = (function () {
  'use strict';

  const API_BASE = 'https://stockanalysis.com/api/symbol/s/';
  const CACHE_PREFIX = 'saHist_';
  const CACHE_TTL_MS = 6 * 3600 * 1000; // 6 ώρες
  const MAX_CACHE_KEYS = 24;

  /* ---------------- Ιστορικά δεδομένα (client-side, CORS-open API) ------- */

  function cacheKey(ticker, range) { return CACHE_PREFIX + ticker + '_' + range; }

  function readCache(ticker, range) {
    try {
      const raw = localStorage.getItem(cacheKey(ticker, range));
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (Date.now() - obj.ts > CACHE_TTL_MS) return null;
      return obj.bars;
    } catch (e) { return null; }
  }

  function evictOldCache() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) {
        try { keys.push({ k, ts: JSON.parse(localStorage.getItem(k)).ts || 0 }); }
        catch (e) { keys.push({ k, ts: 0 }); }
      }
    }
    if (keys.length <= MAX_CACHE_KEYS) return;
    keys.sort((a, b) => a.ts - b.ts);
    keys.slice(0, keys.length - MAX_CACHE_KEYS).forEach(o => localStorage.removeItem(o.k));
  }

  function writeCache(ticker, range, bars) {
    try {
      localStorage.setItem(cacheKey(ticker, range), JSON.stringify({ ts: Date.now(), bars }));
      evictOldCache();
    } catch (e) { /* γεμάτο localStorage — δεν πειράζει, απλά χωρίς cache */ }
  }

  /**
   * Φέρνει ημερήσιο ιστορικό OHLCV, παλιό → νέο.
   * range: '6M' | '1Y' | '2Y' | '5Y' | '10Y'
   * Επιστρέφει [{t:'YYYY-MM-DD', o,h,l,c,v}]
   */
  async function fetchHistory(ticker, range) {
    const cached = readCache(ticker, range);
    if (cached) return cached;
    const tryUrls = [
      API_BASE + encodeURIComponent(ticker) + '/history?range=' + range + '&period=Daily',
      API_BASE + encodeURIComponent(ticker.replace('.', '-')) + '/history?range=' + range + '&period=Daily',
    ];
    let lastErr = null;
    for (const url of tryUrls) {
      try {
        const r = await fetch(url);
        if (!r.ok) { lastErr = new Error('HTTP ' + r.status); continue; }
        const json = await r.json();
        const rows = json && json.data;
        if (!Array.isArray(rows) || rows.length === 0) { lastErr = new Error('κενά δεδομένα'); continue; }
        const bars = rows.map(d => ({
          t: d.t, o: +d.o, h: +d.h, l: +d.l, c: +d.c, v: +d.v || 0,
        })).filter(b => isFinite(b.c) && b.c > 0);
        bars.sort((a, b) => a.t < b.t ? -1 : 1);
        writeCache(ticker, range, bars);
        return bars;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('αποτυχία φόρτωσης ιστορικού');
  }

  /* ---------------- Δείκτες ---------------------------------------------- */

  function sma(values, n) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= n) sum -= values[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  function rsi(closes, n) {
    n = n || 14;
    const out = new Array(closes.length).fill(null);
    if (closes.length < n + 1) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= n; i++) {
      const d = closes[i] - closes[i - 1];
      if (d > 0) gain += d; else loss -= d;
    }
    let avgG = gain / n, avgL = loss / n;
    out[n] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      avgG = (avgG * (n - 1) + Math.max(0, d)) / n;
      avgL = (avgL * (n - 1) + Math.max(0, -d)) / n;
      out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }
    return out;
  }

  function atr(bars, n) {
    n = n || 14;
    if (bars.length < 2) return 0;
    const trs = [];
    for (let i = 1; i < bars.length; i++) {
      const b = bars[i], p = bars[i - 1];
      trs.push(Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)));
    }
    const m = trs.slice(-n);
    return m.reduce((a, b) => a + b, 0) / m.length;
  }

  function linreg(ys) {
    const n = ys.length;
    if (n < 2) return { slope: 0, intercept: ys[0] || 0, residStd: 0, r2: 0 };
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxx += i * i; sxy += i * ys[i]; }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const intercept = (sy - slope * sx) / n;
    let ssRes = 0, ssTot = 0;
    const meanY = sy / n;
    for (let i = 0; i < n; i++) {
      const fit = intercept + slope * i;
      ssRes += (ys[i] - fit) * (ys[i] - fit);
      ssTot += (ys[i] - meanY) * (ys[i] - meanY);
    }
    return {
      slope, intercept,
      residStd: Math.sqrt(ssRes / n),
      r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot,
    };
  }

  /* ------------- Pivots & κανάλι στήριξης/αντίστασης --------------------- */

  function findPivots(bars, k) {
    k = k || 3;
    const highs = [], lows = [];
    for (let i = k; i < bars.length - k; i++) {
      let isH = true, isL = true;
      for (let j = i - k; j <= i + k; j++) {
        if (j === i) continue;
        if (bars[j].h >= bars[i].h) isH = false;
        if (bars[j].l <= bars[i].l) isL = false;
        if (!isH && !isL) break;
      }
      if (isH) highs.push({ i, p: bars[i].h });
      if (isL) lows.push({ i, p: bars[i].l });
    }
    return { highs, lows };
  }

  /**
   * Βρίσκει την "καλύτερη" ευθεία πάνω από pivots (αντίσταση) ή κάτω από
   * pivots (στήριξη): δοκιμάζει ζεύγη pivots, μετράει πόσα άλλα pivots
   * "ακουμπάνε" τη γραμμή (εντός tol) και πόσες φορές το κλείσιμο την
   * παραβιάζει. Επιστρέφει {a, b, touches} ώστε y = a + b * barIndex.
   */
  function fitBoundaryLine(pivots, bars, tol, side) {
    if (pivots.length < 2) return null;
    const minSep = Math.max(8, Math.floor(bars.length / 12));
    let best = null;
    for (let x = 0; x < pivots.length; x++) {
      for (let y = x + 1; y < pivots.length; y++) {
        const p1 = pivots[x], p2 = pivots[y];
        if (p2.i - p1.i < minSep) continue;
        const b = (p2.p - p1.p) / (p2.i - p1.i);
        const a = p1.p - b * p1.i;
        let touches = 0, violations = 0;
        for (const pv of pivots) {
          const lineY = a + b * pv.i;
          if (Math.abs(pv.p - lineY) <= tol) touches++;
          else if (side === 'res' && pv.p > lineY + tol) violations++;
          else if (side === 'sup' && pv.p < lineY - tol) violations++;
        }
        const score = touches - 2 * violations;
        if (!best || score > best.score) best = { a, b, touches, violations, score };
      }
    }
    if (!best || best.touches < 2) return null;
    return best;
  }

  /**
   * Αυτόματο κανάλι στήριξης/αντίστασης στα τελευταία lookback bars.
   * Επιστρέφει {res, sup, startIndex} — γραμμές σε συντεταγμένες του
   * ΠΛΗΡΟΥΣ πίνακα bars (barIndex απόλυτο).
   */
  function detectChannel(bars, lookback) {
    lookback = Math.min(lookback || 130, bars.length);
    const start = bars.length - lookback;
    const win = bars.slice(start);
    const tol = atr(win, 14) * 0.5;
    const piv = findPivots(win, 3);
    const res = fitBoundaryLine(piv.highs, win, tol, 'res');
    const sup = fitBoundaryLine(piv.lows, win, tol, 'sup');
    const shift = (line) => line ? { a: line.a - line.b * start, b: line.b, touches: line.touches } : null;
    return { res: shift(res), sup: shift(sup), startIndex: start };
  }

  /* ------------- Προβολή τάσης (στατιστική, ΟΧΙ εγγύηση) ----------------- */

  /**
   * Προβολή επόμενων horizon bars: γραμμική τάση των τελευταίων fitLen
   * κλεισιμάτων + ζώνη αβεβαιότητας από την ημερήσια μεταβλητότητα.
   * Επιστρέφει [{h, mid, up, dn}] (h = bars μπροστά, 1-based).
   */
  function projection(closes, horizon, fitLen) {
    horizon = horizon || 20;
    fitLen = Math.min(fitLen || 60, closes.length);
    const seg = closes.slice(-fitLen);
    const { slope, intercept } = linreg(seg);
    const rets = [];
    for (let i = 1; i < seg.length; i++) rets.push(Math.log(seg[i] / seg[i - 1]));
    const meanR = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
    const sigma = Math.sqrt(rets.reduce((a, r) => a + (r - meanR) * (r - meanR), 0) / (rets.length || 1));
    const last = closes[closes.length - 1];
    const out = [];
    for (let h = 1; h <= horizon; h++) {
      const mid = last + slope * h; // άγκυρα στην τελευταία τιμή, κλίση από την τάση
      const band = 1.28 * sigma * Math.sqrt(h) * last; // ~80% ζώνη
      out.push({ h, mid, up: mid + band, dn: mid - band });
    }
    return out;
  }

  /* ------------- Σύνθετη εκτίμηση τάσης ---------------------------------- */

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /**
   * Συνδυάζει τάση, ΜΑ δομή, RSI, θέση στο κανάλι και news sentiment σε
   * σκορ -100..+100 με ετυμηγορία και εξήγηση στα ελληνικά.
   * sentiment: -100..100 ή null.
   */
  function predictTrend(bars, sentiment) {
    const closes = bars.map(b => b.c);
    const last = closes[closes.length - 1];
    const factors = [];

    // 1. Κλίση τάσης (60 ημερών), κανονικοποιημένη σε %/ημέρα
    const fitLen = Math.min(60, closes.length);
    const lr = linreg(closes.slice(-fitLen));
    const slopePctDay = lr.slope / last * 100;
    const trendScore = clamp(slopePctDay / 0.25, -1, 1) * 100; // ±0.25%/μέρα = ±100
    factors.push({
      key: 'trend', label: 'Κλίση τάσης (60 ημ.)', weight: 0.32, score: trendScore,
      text: slopePctDay >= 0
        ? `ανοδική ${(slopePctDay * 21).toFixed(1)}%/μήνα (R² ${lr.r2.toFixed(2)})`
        : `καθοδική ${(slopePctDay * 21).toFixed(1)}%/μήνα (R² ${lr.r2.toFixed(2)})`,
    });

    // 2. Δομή κινητών μέσων
    const s50 = sma(closes, 50), s200 = sma(closes, 200);
    const m50 = s50[s50.length - 1], m200 = s200[s200.length - 1];
    let maScore = 0, maText = 'ουδέτερη δομή';
    if (m50 != null && m200 != null) {
      if (last > m50 && m50 > m200) { maScore = 100; maText = 'τιμή > MA50 > MA200 (υγιές uptrend)'; }
      else if (last < m50 && m50 < m200) { maScore = -100; maText = 'τιμή < MA50 < MA200 (downtrend)'; }
      else if (last > m200) { maScore = 30; maText = 'πάνω από MA200, μικτή βραχυπρόθεσμη εικόνα'; }
      else { maScore = -30; maText = 'κάτω από MA200, μικτή εικόνα'; }
    } else if (m50 != null) {
      maScore = last > m50 ? 40 : -40;
      maText = last > m50 ? 'πάνω από MA50' : 'κάτω από MA50';
    }
    factors.push({ key: 'ma', label: 'Δομή κινητών μέσων', weight: 0.18, score: maScore, text: maText });

    // 3. RSI(14)
    const rsiArr = rsi(closes, 14);
    const lastRsi = rsiArr[rsiArr.length - 1];
    let rsiScore = 0, rsiText = 'μη διαθέσιμο';
    if (lastRsi != null) {
      if (lastRsi >= 45 && lastRsi <= 65) rsiScore = 60;
      else if (lastRsi > 65 && lastRsi <= 75) rsiScore = 10;
      else if (lastRsi > 75) rsiScore = -40;       // υπεραγορασμένο
      else if (lastRsi >= 35) rsiScore = -10;
      else rsiScore = 25;                           // υπερπουλημένο → πιθανή αναπήδηση
      rsiText = `RSI ${lastRsi.toFixed(0)}` + (lastRsi > 75 ? ' (υπεραγορασμένο)' : lastRsi < 30 ? ' (υπερπουλημένο)' : ' (υγιής ζώνη)');
    }
    factors.push({ key: 'rsi', label: 'Momentum RSI(14)', weight: 0.15, score: rsiScore, text: rsiText });

    // 4. Θέση μέσα στο κανάλι στήριξης/αντίστασης
    const ch = detectChannel(bars);
    let chScore = 0, chText = 'δεν εντοπίστηκε καθαρό κανάλι';
    if (ch.res && ch.sup) {
      const i = bars.length - 1;
      const resY = ch.res.a + ch.res.b * i;
      const supY = ch.sup.a + ch.sup.b * i;
      if (resY > supY) {
        const pos = clamp((last - supY) / (resY - supY), 0, 1);
        chScore = (0.5 - pos) * 120; // κοντά στη στήριξη → θετικό (περιθώριο ανόδου)
        chText = pos < 0.25 ? 'κοντά στη στήριξη του καναλιού'
          : pos > 0.75 ? 'κοντά στην αντίσταση του καναλιού'
          : 'στο μέσο του καναλιού';
      }
    }
    factors.push({ key: 'channel', label: 'Θέση στο κανάλι', weight: 0.13, score: chScore, text: chText });

    // 5. News sentiment (από news.json, αν υπάρχει)
    if (sentiment != null) {
      factors.push({
        key: 'news', label: 'Ειδήσεις (sentiment)', weight: 0.22, score: clamp(sentiment, -100, 100),
        text: sentiment > 15 ? `θετικός τόνος (+${sentiment})` : sentiment < -15 ? `αρνητικός τόνος (${sentiment})` : `ουδέτερος τόνος (${sentiment >= 0 ? '+' : ''}${sentiment})`,
      });
    }

    const wTot = factors.reduce((a, f) => a + f.weight, 0);
    const composite = Math.round(factors.reduce((a, f) => a + f.score * f.weight, 0) / wTot);
    const verdict = composite > 20 ? 'bullish' : composite < -20 ? 'bearish' : 'neutral';
    const confidence = Math.round(clamp(35 + Math.abs(composite) * 0.55, 35, 88));

    return { composite, verdict, confidence, factors, channel: ch, lastRsi, ma50: m50, ma200: m200 };
  }

  /* ------------- Mini backtests (Στρατηγικές) ---------------------------- */

  function maxDrawdown(equity) {
    let peak = -Infinity, dd = 0;
    for (const v of equity) {
      if (v > peak) peak = v;
      dd = Math.min(dd, v / peak - 1);
    }
    return dd * 100;
  }

  function btBuyHold(bars) {
    const eq = bars.map(b => b.c / bars[0].c);
    return {
      name: 'Buy & Hold', totalPct: (eq[eq.length - 1] - 1) * 100,
      maxDD: maxDrawdown(eq), trades: 1, winRate: null, equity: eq,
    };
  }

  function btMaTrend(bars, n) {
    n = n || 50;
    const closes = bars.map(b => b.c);
    const ma = sma(closes, n);
    const eq = [1]; let inPos = false, entry = 0, trades = 0, wins = 0;
    for (let i = 1; i < bars.length; i++) {
      let ret = 0;
      if (inPos) ret = closes[i] / closes[i - 1] - 1;
      eq.push(eq[eq.length - 1] * (1 + ret));
      if (ma[i] == null) continue;
      if (!inPos && closes[i] > ma[i]) { inPos = true; entry = closes[i]; }
      else if (inPos && closes[i] < ma[i]) {
        inPos = false; trades++;
        if (closes[i] > entry) wins++;
      }
    }
    if (inPos) { trades++; if (closes[closes.length - 1] > entry) wins++; }
    return {
      name: 'Trend following (MA' + n + ')', totalPct: (eq[eq.length - 1] - 1) * 100,
      maxDD: maxDrawdown(eq), trades, winRate: trades ? wins / trades * 100 : null, equity: eq,
    };
  }

  function btPullback(bars) {
    const closes = bars.map(b => b.c);
    const r = rsi(closes, 14), s200 = sma(closes, 200);
    const eq = [1]; let inPos = false, entry = 0, trades = 0, wins = 0;
    for (let i = 1; i < bars.length; i++) {
      let ret = 0;
      if (inPos) ret = closes[i] / closes[i - 1] - 1;
      eq.push(eq[eq.length - 1] * (1 + ret));
      if (r[i] == null) continue;
      if (!inPos && r[i] < 35 && (s200[i] == null || closes[i] > s200[i])) {
        inPos = true; entry = closes[i];
      } else if (inPos && (r[i] > 55 || closes[i] < entry * 0.92)) {
        inPos = false; trades++;
        if (closes[i] > entry) wins++;
      }
    }
    if (inPos) { trades++; if (closes[closes.length - 1] > entry) wins++; }
    return {
      name: 'Pullback (RSI<35 σε uptrend)', totalPct: (eq[eq.length - 1] - 1) * 100,
      maxDD: maxDrawdown(eq), trades, winRate: trades ? wins / trades * 100 : null, equity: eq,
    };
  }

  /* ------------- Canvas helpers ------------------------------------------ */

  function setupCanvas(canvas, cssHeight) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    const h = cssHeight || 380;
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function niceTicks(min, max, count) {
    if (!(max > min)) return [min];
    const span = max - min;
    const step0 = span / (count || 5);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    let step = mag;
    for (const m of [1, 2, 2.5, 5, 10]) {
      if (step0 <= m * mag) { step = m * mag; break; }
    }
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
    return ticks;
  }

  /* ------------- Earnings helper ----------------------------------------- */

  /**
   * Επόμενα earnings του ticker (από το news.json): {date: 'YYYY-MM-DD', days}
   * ή null αν δεν υπάρχει ημερομηνία, έχει περάσει, ή είναι πέρα από maxDays.
   */
  function earningsInfo(ticker, maxDays) {
    const n = window.NEWS && window.NEWS.tickers && window.NEWS.tickers[ticker];
    const d = n && n.earnings_date;
    if (!d) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // μεσάνυχτα - μεσάνυχτα: ακέραιες μέρες (το round καλύπτει το ±1h της αλλαγής ώρας)
    const days = Math.round((new Date(d + 'T00:00:00') - today) / 86400000);
    if (days < 0 || (maxDays != null && days > maxDays)) return null;
    return { date: d, days };
  }

  return {
    fetchHistory, sma, rsi, atr, linreg,
    findPivots, detectChannel, projection, predictTrend,
    btBuyHold, btMaTrend, btPullback,
    setupCanvas, niceTicks, clamp, earningsInfo,
  };
})();
