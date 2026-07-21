# trading-copilot

Προσωπικό AI-assisted dashboard για stock screening, παρακολούθηση θέσεων, ανάλυση τάσεων και live candlestick charts. Static site (GitHub Pages), χωρίς backend και χωρίς build step.

**Live:** https://s0k0s.github.io/trading-copilot/

## Δομή (V4)

```
├── index.html            # Markup, CSS και ο βασικός screener (tabs, modal, journal)
├── assets/
│   ├── analysis.js       # Κοινή βιβλιοθήκη: ιστορικά τιμών (stockanalysis API, client-side,
│   │                     #   cache 6h σε localStorage), δείκτες (SMA/RSI/ATR), pivots,
│   │                     #   αυτόματο κανάλι στήριξης/αντίστασης, προβολή τάσης, backtests
│   ├── trendlab.js       # Tab "Τάσεις & Πρόβλεψη": custom canvas candlestick chart με κανάλι
│   │                     #   S/R, στατιστική προβολή 20 συνεδριάσεων, σύνθετη εκτίμηση τάσης
│   │                     #   (τεχνική εικόνα + news sentiment) και λίστα ειδήσεων
│   ├── events.js         # Tab "Event Patterns": μέση ιστορική πορεία ±21 συνεδριάσεις γύρω
│   │                     #   από παρουσιάσεις προϊόντων (AAPL/TSLA/NVDA/META/GOOGL/MSFT/AMD),
│   │                     #   win rates, custom events σε localStorage
│   ├── strategies.js     # Tab "Στρατηγικές": οδηγός 5 στρατηγικών, mini backtest σε
│   │                     #   πραγματικό ιστορικό, υπολογιστής μεγέθους θέσης βάσει ρίσκου
│   └── markets.js        # Tab "Αγορές & Earnings": ώρες 11 χρηματιστηρίων (DST-aware,
│                         #   live status, 24ωρο timeline) + ημερολόγιο επερχόμενων
│                         #   earnings του universe (πηγή: earningsDate στο news.json)
├── data.json             # Scores/θεμελιώδη ανά μετοχή (γράφεται από scanner/scan.py)
├── news.json             # Ειδήσεις + sentiment ανά μετοχή (γράφεται από scanner/scan.py)
├── positions.json        # Live θέσεις από Trading212 (γράφεται από το sync — δεν υπάρχει
│                         #   μέχρι να ρυθμιστεί το T212_API_KEY secret)
├── scanner/scan.py       # Scraper/scorer + news sentiment + Trading212 sync
└── .github/workflows/
    ├── update.yml        # Cron Δευ–Παρ 21:30 UTC: scan.py → commit data+news(+positions)
    └── positions.yml     # Cron κάθε 2h (07–21 UTC, Δευ–Παρ): μόνο sync θέσεων
```

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

## Πηγές δεδομένων

- **Θεμελιώδη/στατιστικά:** scrape του stockanalysis.com/stocks/{ticker}/statistics/ (scanner).
- **Ιστορικά OHLCV:** `stockanalysis.com/api/symbol/s/{TICKER}/history?range=…&period=Daily` —
  ανοιχτό CORS, καλείται client-side με cache 6h στο localStorage.
- **Ειδήσεις:** `stockanalysis.com/stocks/{slug}/__data.json` (SvelteKit devalue format) —
  γίνεται decode στον scanner, sentiment με λεξικό λέξεων, αποτέλεσμα στο `news.json`.
- **Live charts στα modals:** δωρεάν TradingView widget.

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
