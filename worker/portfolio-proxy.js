/* =========================================================================
   portfolio-proxy.js — Cloudflare Worker
   Read-only proxy για το Trading212 API, ώστε το κουμπί «Ανανέωση» στο
   dashboard να μπορεί να ζητήσει τη ζωντανή θέση on-demand χωρίς να εκθέτει
   ποτέ το T212_API_KEY / T212_API_SECRET στον browser (αυτά μένουν Worker
   secrets, server-side μόνο).

   Δεν γράφει positions.json· απλά επιστρέφει το ίδιο σχήμα δεδομένων που
   γράφει το scanner/scan.py, ώστε το ίδιο front-end rendering να δουλεύει
   και για τα δύο. Το scheduled sync (positions.yml, κάθε 2 ώρες) συνεχίζει
   να τρέχει κανονικά — αυτό εδώ είναι μόνο για το «θέλω το τώρα».

   Deploy: επικόλληση ολόκληρου του αρχείου στο Cloudflare dashboard
   (Workers & Pages → Create → επεξεργασία κώδικα), μετά ορισμός δύο
   Worker secrets (Settings → Variables → Encrypt): T212_API_KEY,
   T212_API_SECRET. Προαιρετικό env var (μη κρυφό) T212_MODE=live.
   ========================================================================= */

const ALLOWED_ORIGINS = new Set([
  'https://s0k0s.github.io',
]);

const CACHE_TTL_MS = 20000; // αποτρέπει πολλαπλά χτυπήματα στο T212 API αν πατηθεί το κουμπί επανειλημμένα
let cached = null; // { ts, body }

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

// Ίδια λογική με το t212_plain_ticker() στο scanner/scan.py.
function t212PlainTicker(t) {
  const core = (t || '').split('_')[0];
  if (core.length > 1) {
    const last = core[core.length - 1];
    if (last === last.toLowerCase() && last !== last.toUpperCase()) {
      return (core.slice(0, -1) + '.' + last.toUpperCase()).toUpperCase();
    }
  }
  return core.toUpperCase();
}

async function t212Request(path, key, secret, mode) {
  const base = mode === 'live' ? 'https://live.trading212.com' : 'https://demo.trading212.com';
  const creds = btoa(`${key}:${secret}`);
  const resp = await fetch(base + path, { headers: { Authorization: `Basic ${creds}` } });
  if (!resp.ok) {
    const err = new Error(`T212 HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
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

    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      return new Response(cached.body, {
        headers: { ...headers, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
      });
    }

    const apiKey = (env.T212_API_KEY || '').trim();
    const apiSecret = (env.T212_API_SECRET || '').trim();
    const mode = (env.T212_MODE || 'demo').toLowerCase();
    if (!apiKey || !apiSecret) {
      return new Response(JSON.stringify({ error: 'missing T212 credentials on server' }), {
        status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    let portfolio, cash;
    try {
      [portfolio, cash] = await Promise.all([
        t212Request('/api/v0/equity/portfolio', apiKey, apiSecret, mode),
        t212Request('/api/v0/equity/account/cash', apiKey, apiSecret, mode),
      ]);
    } catch (e) {
      const status = (e.status === 401 || e.status === 403) ? 401 : 502;
      return new Response(JSON.stringify({ error: 'trading212 request failed', detail: String(e.message || e) }), {
        status, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    const positions = (Array.isArray(portfolio) ? portfolio : []).map(p => ({
      ticker: t212PlainTicker(p.ticker),
      t212_ticker: p.ticker,
      quantity: p.quantity,
      avg_price: p.averagePrice,
      current_price: p.currentPrice,
      ppl: p.ppl,
      fx_ppl: p.fxPpl,
      since: (p.initialFillDate || '').slice(0, 10) || null,
    }));

    const out = {
      last_updated: new Date().toISOString(),
      mode,
      cash: (cash && typeof cash === 'object')
        ? { free: cash.free, total: cash.total, invested: cash.invested, ppl: cash.ppl, result: cash.result }
        : {},
      positions,
      live: true, // σημαία ώστε το front-end να ξέρει ότι αυτό ήρθε από on-demand refresh, όχι από το scheduled positions.json
    };

    const body = JSON.stringify(out);
    cached = { ts: Date.now(), body };

    return new Response(body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  },
};
