/* =========================================================================
   stock-lookup-proxy.js — Cloudflare Worker
   Ζωντανό, on-demand lookup για ένα ticker που ΔΕΝ είναι στο universe του
   dashboard (π.χ. πρόσφατο spin-off, μικρή/άγνωστη εταιρεία). Δεν αγγίζει
   καθόλου το scan.py/data.json — αυτό είναι ξεχωριστό, δευτερεύον κομμάτι:
   φέρνει τιμή/βασικά στατιστικά ΜΟΝΟ για το ticker που ζητήθηκε, χωρίς
   Long-Term/Swing Score (αυτό υπολογίζεται στο πλήρες nightly scan).

   Ίδια λογική εξαγωγής με το scanner/scan.py::fetch_table_map() +
   to_number(), αλλά διαβάζοντας το ενσωματωμένο JSON state της σελίδας
   (title/value ζεύγη) αντί για BeautifulSoup — πιο αξιόπιστο από το να
   ξεπερνά κανείς τα Vue hydration comment nodes στο ωμό HTML.

   Deploy: ίδιο μοτίβο με το portfolio-proxy.js (επικόλληση στο Cloudflare
   dashboard). Δεν χρειάζεται κανένα secret — το stockanalysis.com δεν
   απαιτεί authentication για δημόσιες σελίδες.
   ========================================================================= */

const ALLOWED_ORIGINS = new Set([
  'https://s0k0s.github.io',
]);

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 λεπτά — αρκετό ώστε επαναλαμβανόμενες αναζητήσεις του ίδιου ticker να μη χτυπάνε συνέχεια το stockanalysis.com
const cache = new Map(); // ticker -> { ts, body }

function corsHeaders(origin) {
  const isLocal = origin && /^http:\/\/localhost(:\d+)?$/.test(origin);
  const allow = ALLOWED_ORIGINS.has(origin) || isLocal ? origin : 'https://s0k0s.github.io';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

// Ίδια λογική με το to_number() στο scanner/scan.py.
function toNumber(txt) {
  if (txt == null) return null;
  let t = String(txt).trim();
  if (t === '' || t === 'n/a' || t === 'N/A' || t === '—' || t === '-') return null;
  const neg = t.startsWith('(') && t.endsWith(')');
  t = t.replace(/^\(|\)$/g, '');
  let mult = 1;
  if (t.endsWith('%')) {
    t = t.slice(0, -1);
  } else if (t && 'KMBT'.includes(t[t.length - 1])) {
    mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[t[t.length - 1]];
    t = t.slice(0, -1);
  }
  t = t.replace(/,/g, '').replace(/\+/g, '').trim();
  const val = parseFloat(t);
  if (Number.isNaN(val)) return null;
  return neg ? -val * mult : val * mult;
}

// Εξάγει όλα τα title:"..."/value:"..." ζεύγη από το ενσωματωμένο state της
// σελίδας στατιστικών — ίδια δεδομένα με τον πίνακα, χωρίς να χρειάζεται να
// «καθαρίσουμε» το Vue hydration markup του ωμού HTML.
function extractStats(html) {
  const out = {};
  const re = /title:"([^"]+)",value:"([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) {
    if (!(m[1] in out)) out[m[1]] = m[2];
  }
  return out;
}

function findLabel(stats, ...candidates) {
  for (const c of candidates) {
    for (const key in stats) {
      if (key === c || key.startsWith(c)) return stats[key];
    }
  }
  return null;
}

async function lookupTicker(ticker) {
  const slug = ticker.toLowerCase().replace(/\./g, '-');
  const url = `https://stockanalysis.com/stocks/${slug}/statistics/`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InvestmentCopilotLookup/1.0)' },
  });
  if (!resp.ok) {
    const err = new Error(`stockanalysis.com HTTP ${resp.status}`);
    err.status = resp.status === 404 ? 404 : 502;
    throw err;
  }
  const html = await resp.text();

  const titleMatch = html.match(/<title>([^(]+)\(/);
  const name = titleMatch ? titleMatch[1].trim() : ticker;

  const priceMatch = html.match(/quote:\{[^}]*?\bp:([\d.]+)/);
  const price = priceMatch ? parseFloat(priceMatch[1]) : null;

  const stats = extractStats(html);

  return {
    ticker,
    name,
    price,
    pe_ratio: toNumber(findLabel(stats, 'PE Ratio')),
    peg_ratio: toNumber(findLabel(stats, 'PEG Ratio')),
    debt_equity: toNumber(findLabel(stats, 'Debt / Equity')),
    roe: toNumber(findLabel(stats, 'Return on Equity')),
    roic: toNumber(findLabel(stats, 'Return on Invested Capital')),
    fcf_yield: toNumber(findLabel(stats, 'FCF Yield')),
    rsi: toNumber(findLabel(stats, 'Relative Strength Index')),
    ma50: toNumber(findLabel(stats, '50-Day Moving Average')),
    ma200: toNumber(findLabel(stats, '200-Day Moving Average')),
    week52_change: toNumber(findLabel(stats, '52-Week Price Change')),
    beta: toNumber(findLabel(stats, 'Beta')),
    analyst_consensus: findLabel(stats, 'Analyst Consensus'),
    eps_growth_forecast_3y: toNumber(findLabel(stats, 'EPS Growth Forecast')),
    revenue_growth_forecast_3y: toNumber(findLabel(stats, 'Revenue Growth Forecast')),
    altman_z: toNumber(findLabel(stats, 'Altman Z-Score')),
    piotroski_f: toNumber(findLabel(stats, 'Piotroski F-Score')),
    quick_ratio: toNumber(findLabel(stats, 'Quick Ratio')),
    market_cap: findLabel(stats, 'Market Cap'),
    live_lookup: true, // σημαία: αυτό ΔΕΝ πέρασε από το πλήρες scoring — no score
  };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'method not allowed' }), {
        status: 405, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const ticker = (url.searchParams.get('ticker') || '').trim().toUpperCase();
    if (!ticker || !/^[A-Z0-9.\-]{1,10}$/.test(ticker)) {
      return new Response(JSON.stringify({ error: 'invalid ticker' }), {
        status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    const cached = cache.get(ticker);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      return new Response(cached.body, {
        headers: { ...headers, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
      });
    }

    let data;
    try {
      data = await lookupTicker(ticker);
    } catch (e) {
      const status = e.status || 502;
      return new Response(JSON.stringify({ error: status === 404 ? 'ticker not found' : 'lookup failed', detail: String(e.message || e) }), {
        status, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    const body = JSON.stringify(data);
    cache.set(ticker, { ts: Date.now(), body });

    return new Response(body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  },
};
