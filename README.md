# trading-copilot

Προσωπικό AI-assisted dashboard για stock screening, παρακολούθηση θέσεων, ανάλυση τάσεων και live candlestick charts. Static site (GitHub Pages), χωρίς backend και χωρίς build step.

**Live:** https://s0k0s.github.io/trading-copilot/

## Δομή (V5)

```
├── index.html            # Markup, CSS και ο βασικός screener (4 ενότητες πλοήγησης,
│                         #   καθολική αναζήτηση, modal, journal)
├── manifest.webmanifest  # PWA manifest — "Προσθήκη στην αφετηρία" στο κινητό
├── assets/
│   ├── icon.svg / icon-*.png  # Εικονίδιο εφαρμογής (favicon, apple-touch, PWA)
│   ├── analysis.js       # Κοινή βιβλιοθήκη: ιστορικά τιμών (stockanalysis API, client-side,
│   │                     #   cache 6h σε localStorage), δείκτες (SMA/RSI/ATR), pivots,
│   │                     #   αυτόματο κανάλι στήριξης/αντίστασης, προβολή τάσης, backtests,
│   │                     #   quest checklist, earnings helper
│   ├── today.js          # «🏠 Σήμερα» — αρχική οθόνη: χαρτοφυλάκιο, mini αγορές,
│   │                     #   earnings της εβδομάδας, Quest 5/5 highlights
│   ├── trendlab.js       # «📊 Τάσεις & Πρόβλεψη»: custom canvas candlestick chart με κανάλι
│   │                     #   S/R, στατιστική προβολή 20 συνεδριάσεων, σύνθετη εκτίμηση τάσης
│   │                     #   (τεχνική εικόνα + news sentiment) και λίστα ειδήσεων
│   ├── events.js         # «🗓️ Event Patterns»: μέση ιστορική πορεία ±21 συνεδριάσεις γύρω
│   │                     #   από παρουσιάσεις προϊόντων (AAPL/TSLA/NVDA/META/GOOGL/MSFT/AMD),
│   │                     #   win rates, custom events σε localStorage
│   ├── strategies.js     # «🧭 Στρατηγικές»: οδηγός 5 στρατηγικών, mini backtest σε
│   │                     #   πραγματικό ιστορικό, υπολογιστής μεγέθους θέσης βάσει ρίσκου
│   └── markets.js        # «🕒 Αγορές & Earnings»: ώρες 11 χρηματιστηρίων (DST-aware,
│                         #   live status, 24ωρο timeline) + ημερολόγιο επερχόμενων
│                         #   earnings του universe (πηγή: earningsDate στο news.json)
├── data.json             # Scores/θεμελιώδη ανά μετοχή (γράφεται από scanner/scan.py)
├── news.json             # Ειδήσεις + sentiment ανά μετοχή (γράφεται από scanner/scan.py)
├── positions.json        # Live θέσεις από Trading212 (γράφεται από το sync — δεν υπάρχει
│                         #   μέχρι να ρυθμιστεί το T212_API_KEY secret)
├── scanner/scan.py       # Scraper/scorer + news sentiment + Trading212 sync· universe =
│                         #   ολόκληρο το S&P 500, τραβηγμένο δυναμικά (fetch_universe)
└── .github/workflows/
    ├── update.yml        # Cron Δευ–Παρ 21:30 UTC: scan.py → commit data+news(+positions)
    └── positions.yml     # Cron κάθε 2h (07–21 UTC, Δευ–Παρ): μόνο sync θέσεων
```

## Πλοήγηση (V5)

5 ενότητες: **🏠 Σήμερα** (dashboard — χαρτοφυλάκιο, mini αγορές, Top 5 picks, earnings εβδομάδας,
Quest 5/5), **🔎 Σκάνερ** (Top 10, Προτάσεις, Όλες οι μετοχές — με φίλτρα Quest/Earnings/Κλάδου/
Αγοράς), **📊 Ανάλυση** (Τάσεις &amp; Πρόβλεψη, Event Patterns, Στρατηγικές), **🌍 Markets**
(standalone, όπως το Σήμερα — ώρες όλων των χρηματιστηρίων, κατατεταγμένες λίστες Top 15
Long-Term/Swing **ανά αγορά** μέσω chips, μετά ημερολόγιο earnings), **💼 Χαρτοφυλάκιο** (Θέσεις,
Journal). Στο κινητό γίνονται fixed bottom nav bar (5 κουμπιά). Καθολική αναζήτηση (`#gsearch`)
πάνω-πάνω βρίσκει οποιαδήποτε μετοχή απ' όλες τις αγορές και ανοίγει κατευθείαν το Trend Lab.

**Universe (V6 — πολλαπλές αγορές):** ~1100+ μετοχές σε 9 αγορές (`MARKET_META` στο scan.py):
🇺🇸 ΗΠΑ (δυναμικό S&amp;P 500), 🇬🇷 Ελλάδα/ATHEX, 🇫🇷 Γαλλία/Euronext Paris, 🇯🇵 Ιαπωνία/Tokyo,
🇦🇺 Αυστραλία/ASX (αυτές οι 4 "καθαρές" — δυναμικό top-N scrape, καμία μόλυνση από dual-listings),
και 🇬🇧 UK/FTSE 100, 🇩🇪 Γερμανία/DAX 40, 🇭🇰 Hong Kong/Hang Seng, 🇨🇦 Καναδάς/TSX 60 (αυτές
"επιμελημένες" — στατική λίστα από Wikipedia, γιατί η raw λίστα του stockanalysis.com για μεγάλα
exchanges όπως το LSE είναι κυριαρχημένη από δευτερεύουσες εισαγωγές μεγάλων αμερικανικών
εταιρειών — π.χ. στο LSE η πρώτη θέση κατά κεφαλαιοποίηση είναι η NVIDIA, όχι βρετανική εταιρεία).

Κάθε μη-αμερικανική μετοχή παίρνει επίθημα στο ticker της (σύμβαση Yahoo/Google Finance — π.χ.
`AZN.L`, `SAP.DE`, `BHP.AX`) ώστε να μένει μοναδικό παγκοσμίως και να μη συγκρούεται με ομώνυμα
αμερικανικά tickers (π.χ. "T" = AT&amp;T στις ΗΠΑ, "T.TO" = Telus στον Καναδά). Γνωστός περιορισμός:
το ιστορικό τιμών του Trend Lab/Στρατηγικών (`Analysis.fetchHistory`) δουλεύει προς το παρόν μόνο
για ΗΠΑ — δείχνει σαφές μήνυμα αντί να σπάει για διεθνείς μετοχές· όλα τα υπόλοιπα (scores, Quest,
sector, earnings, ειδήσεις, live TradingView chart στο modal) δουλεύουν κανονικά παντού.

**Cache-busting:** τα `assets/*.js` φορτώνονται με `?v=N` query param· ανέβασε το `N` όταν
αλλάζεις κάποιο asset ώστε οι browsers να μην κρατήσουν παλιά έκδοση σε cache (εντοπίστηκε
aggressive heuristic caching σε plain-served .js χωρίς cache headers — δεν καθάριζε ούτε με
restart του server, μόνο με cache-busted URL).

## Αυτόματο sync θέσεων από Trading212

Το tab «Οι Θέσεις Μου» διαβάζει το `positions.json` αν υπάρχει, αλλιώς πέφτει πίσω στο
χειροκίνητο array `POSITIONS` του index.html. Για να ενεργοποιηθεί το αυτόματο sync:

1. Trading212 app → **Settings → API (Beta)** → δημιούργησε API key (στο practice mode για
   τον demo λογαριασμό).
2. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `T212_API_KEY` = το key σου
   - (προαιρετικά) `T212_MODE` = `demo` (default) ή `live`
3. Τρέξε χειροκίνητα το workflow **«Sync θέσεων Trading212»** (tab Actions → Run workflow)
   ή περίμενε το επόμενο 2ωρο cron.

Το API key μένει μόνο στα GitHub Secrets — ποτέ μέσα στον κώδικα ή στο site. Χωρίς secret,
τα workflows απλά παραλείπουν το sync. Τοπικά: `T212_API_KEY=... python3 scanner/scan.py --positions-only`.

## 🎯 Quest — 5 ερωτήσεις ποιότητας

Προσωπικό φίλτρο πρώτης διαλογής, ορατό στο modal κάθε μετοχής, ως ταξινομήσιμη στήλη στο
«Όλες οι μετοχές» και ως badge στα Top 10: (1) έσοδα ≥10%/χρόνο (YoY, από overview
`__data.json`), (2) P/E &lt; 25, (3) PEG &lt; 2, (4) μ.ο. ROE 5 τελευταίων fiscal years &gt; 5%
(από `financials/ratios/`), (5) quick ratio &gt; 1.5 (από statistics). Μετοχή που περνάει και
τα 5 σημαίνεται «αξίζει βαθύτερο ψάξιμο» — δεν είναι σήμα αγοράς.

## 🏆 Κορυφαίες επιλογές σήμερα &amp; φίλτρα

Στο tab «Σήμερα»: αυτόματο Top 5 Long-Term και Top 5 Swing (ταξινόμηση βάσει των υπαρχόντων
scores, με σύντομη αιτιολόγηση ανά μετοχή από τα υποκείμενα metrics) — αντικαθιστά τη χειροκίνητα
ενημερωμένη λίστα `SUGGESTIONS`. Στο «Όλες οι μετοχές»: φίλτρα «μόνο Quest 5/5», «earnings αυτή
την εβδομάδα» και dropdown κλάδου (`sector`, από `stocks/{t}/company/`, scrape #3 ανά μετοχή).
Σκόπιμα **δεν** υπάρχει day-trading screener: η πηγή δεδομένων ανανεώνεται μία φορά/μέρα (EOD),
όχι σε πραγματικό χρόνο — ένα «σήμα ημέρας» θα ήταν ήδη μπαγιάτικο μέχρι να το δεις.

## Πηγές δεδομένων

- **Θεμελιώδη/στατιστικά:** scrape του stockanalysis.com — ΗΠΑ: `/stocks/{ticker}/statistics/`,
  διεθνείς αγορές: `/quote/{exchange_code}/{ticker}/statistics/` (π.χ. `/quote/lon/AZN/`). Ίδιο
  μοτίβο και για `financials/ratios/` (ROE 5ετίας), `company/` (sector/industry), `__data.json`
  (ειδήσεις/earnings) — βλ. `_base_url()` στο scan.py.
- **Λίστες αγορών:** `stockanalysis.com/list/{exchange-slug}/` (π.χ. `sp-500-stocks`,
  `athens-stock-exchange`) για τις "καθαρές" αγορές· στατικές λίστες (Wikipedia) για τις
  "επιμελημένες" — βλ. `FTSE_100`/`DAX_40`/`HANG_SENG`/`TSX_60` στο scan.py.
- **Ιστορικά OHLCV:** `stockanalysis.com/api/symbol/s/{TICKER}/history?range=…&period=Daily` —
  ανοιχτό CORS, καλείται client-side με cache 6h στο localStorage. **Μόνο ΗΠΑ** προς το παρόν.
- **Ειδήσεις:** `stockanalysis.com/{stocks|quote}/.../__data.json` (SvelteKit devalue format) —
  γίνεται decode στον scanner, sentiment με λεξικό λέξεων, αποτέλεσμα στο `news.json`.
- **Live charts στα modals:** δωρεάν TradingView widget, με exchange-aware symbol mapping
  (`TV_EXCHANGE_PREFIX` στο index.html — π.χ. `.L` → `LSE:`) — best-effort, όχι εγγυημένο 100%.

## Τοπικό τρέξιμο

```
python3 -m http.server 8642 --directory .
# → http://localhost:8642
```

Το scanner τοπικά: `python3 scanner/scan.py` (όλο) ή `python3 scanner/scan.py --news-only`
(μόνο ειδήσεις). Σε macOS ίσως χρειαστεί `pip install certifi` για τα SSL certificates.

## Σημαντικό

Εκπαιδευτικό εργαλείο υποστήριξης απόφασης — **όχι** επενδυτική συμβουλή. Η "Πρόβλεψη τάσης"
είναι στατιστική εκτίμηση από ιστορικές τιμές και τόνο ειδήσεων, όχι εγγύηση. Τα event patterns
βασίζονται σε μικρά δείγματα. Καμία αυτόματη εκτέλεση συναλλαγών.
