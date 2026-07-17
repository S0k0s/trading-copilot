#!/usr/bin/env python3
"""
scan.py — Ξανατρέχει το scoring όλων των μετοχών του trading-copilot dashboard
και γράφει το ../data.json.

Πηγή δεδομένων: stockanalysis.com/stocks/{ticker}/statistics/ (δωρεάν, δημόσιο).
Μεθοδολογία scoring: ίδια με αυτή που περιγράφεται στο footer του dashboard
(Long-Term Score & Swing Score, μέσος όρος normalized υπο-δεικτών 0-100).

Σχεδιασμένο να είναι ανθεκτικό: αν αποτύχει η ανάκτηση/parsing για μια μετοχή,
κρατάει τα προηγούμενα γνωστά δεδομένα της αντί να ρίξει όλο το script.
"""
import json
import re
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
DATA_JSON = ROOT / "data.json"

# ticker -> εμφανιζόμενο όνομα
TICKERS = {
    "NVDA": "NVIDIA", "GOOGL": "Alphabet", "AAPL": "Apple", "MSFT": "Microsoft",
    "AMZN": "Amazon", "AVGO": "Broadcom", "META": "Meta Platforms", "TSLA": "Tesla",
    "WMT": "Walmart", "BRK.B": "Berkshire Hathaway", "LLY": "Eli Lilly", "JPM": "JPMorgan Chase",
    "MU": "Micron Technology", "AMD": "Advanced Micro Devices", "XOM": "ExxonMobil", "V": "Visa",
    "JNJ": "Johnson & Johnson", "INTC": "Intel", "ORCL": "Oracle", "COST": "Costco Wholesale",
    "CSCO": "Cisco Systems", "MA": "Mastercard", "CAT": "Caterpillar", "CVX": "Chevron",
    "NFLX": "Netflix", "ABBV": "AbbVie", "BAC": "Bank of America", "UNH": "UnitedHealth Group",
    "KO": "Coca-Cola", "LRCX": "Lam Research", "PG": "Procter & Gamble", "AMAT": "Applied Materials",
    "PLTR": "Palantir Technologies", "MS": "Morgan Stanley", "HD": "Home Depot",
    "PM": "Philip Morris International", "GE": "GE Aerospace", "GS": "Goldman Sachs",
    "MRK": "Merck & Co.", "TXN": "Texas Instruments", "GEV": "GE Vernova", "RTX": "RTX Corporation",
    "LIN": "Linde", "KLAC": "KLA Corporation", "WFC": "Wells Fargo", "QCOM": "Qualcomm",
    "AXP": "American Express", "IBM": "IBM", "C": "Citigroup", "TMUS": "T-Mobile US",
    "ADI": "Analog Devices", "PEP": "PepsiCo", "PANW": "Palo Alto Networks", "MCD": "McDonald's",
    "VZ": "Verizon Communications", "NEE": "NextEra Energy", "DIS": "Walt Disney",
    "ANET": "Arista Networks", "BLK": "BlackRock",
    # V3.1 — ευρύτερο universe
    "ADBE": "Adobe", "CRM": "Salesforce", "NOW": "ServiceNow", "UBER": "Uber Technologies",
    "SBUX": "Starbucks", "NKE": "Nike", "LOW": "Lowe's", "TMO": "Thermo Fisher Scientific",
    "ABT": "Abbott Laboratories", "BKNG": "Booking Holdings", "SPGI": "S&P Global",
    "ISRG": "Intuitive Surgical", "VRTX": "Vertex Pharmaceuticals", "SCHW": "Charles Schwab",
    "CMCSA": "Comcast", "T": "AT&T", "CB": "Chubb", "SYK": "Stryker",
    "PYPL": "PayPal", "INTU": "Intuit",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

LABELS = {
    "pe_ratio": ["PE Ratio"],
    "peg_ratio": ["PEG Ratio"],
    "debt_equity": ["Debt / Equity"],
    "roe": ["Return on Equity (ROE)"],
    "roic": ["Return on Invested Capital (ROIC)"],
    "fcf_yield": ["FCF Yield"],
    "rsi": ["Relative Strength Index (RSI)"],
    "ma50": ["50-Day Moving Average"],
    "ma200": ["200-Day Moving Average"],
    "week52_change": ["52-Week Price Change"],
    "beta": ["Beta (5Y)"],
    "price_target": ["Price Target"],
    "eps_growth_forecast_3y": ["EPS Growth Forecast (3Y)"],
    "revenue_growth_forecast_3y": ["Revenue Growth Forecast (3Y)"],
    "altman_z": ["Altman Z-Score"],
    "piotroski_f": ["Piotroski F-Score"],
    "market_cap": ["Market Cap"],
    "analyst_consensus": ["Analyst Consensus"],
    "shares_outstanding": ["Shares Outstanding", "Current Share Class"],
}


def to_number(txt):
    """'37.16%' -> 37.16, '1.94' -> 1.94, 'n/a' -> None, '5.03B' -> 5030000000.0"""
    if txt is None:
        return None
    t = txt.strip()
    if t in ("", "n/a", "N/A", "—", "-"):
        return None
    neg = t.startswith("(") and t.endswith(")")
    t = t.strip("()")
    mult = 1
    if t.endswith("%"):
        t = t[:-1]
    elif t and t[-1] in "KMBT":
        mult = {"K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}[t[-1]]
        t = t[:-1]
    t = t.replace(",", "").replace("+", "").strip()
    try:
        val = float(t) * mult
        return -val if neg else val
    except ValueError:
        return None


def fetch_table_map(ticker):
    """Κατεβάζει τη σελίδα στατιστικών και επιστρέφει dict label->value_text
    από ΟΛΑ τα label/value ζευγάρια σε <tr> με 2 κελιά, σε όλη τη σελίδα."""
    slug = ticker.lower().replace(".", "-")
    url = f"https://stockanalysis.com/stocks/{slug}/statistics/"
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=25) as resp:
        html = resp.read()
    soup = BeautifulSoup(html, "lxml")
    out = {}
    for tr in soup.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if len(cells) == 2:
            label = cells[0].get_text(strip=True)
            value = cells[1].get_text(strip=True)
            if label and label not in out:
                out[label] = value
    # Τρέχουσα τιμή: πρώτος μεγάλος αριθμός στην κορυφή της σελίδας.
    price = None
    price_el = soup.select_one("[class*=price], [data-testid*=price]")
    text_blob = soup.get_text("\n", strip=True)
    m = re.search(r"\n([\d,]+\.\d{2,4})\n", "\n" + text_blob)
    if m:
        price = to_number(m.group(1))
    return out, price


def score_from(row):
    """Υπολογίζει long_term_score & swing_score βάσει της μεθοδολογίας του dashboard."""

    def clamp(v, lo, hi):
        return max(lo, min(hi, v))

    # --- Long-Term Score: μέσος όρος 6 normalized υπο-δεικτών ---
    parts = []
    if row.get("piotroski_f") is not None:
        parts.append(clamp(row["piotroski_f"] / 9 * 100, 0, 100))
    if row.get("altman_z") is not None:
        az = row["altman_z"]
        parts.append(100 if az >= 3 else 0 if az < 1.8 else (az - 1.8) / 1.2 * 100)
    if row.get("roe") is not None:
        parts.append(clamp(row["roe"], 0, 30) / 30 * 100)
    if row.get("peg_ratio") is not None and row["peg_ratio"] > 0:
        pg = row["peg_ratio"]
        parts.append(100 if pg <= 1 else 0 if pg >= 3 else (3 - pg) / 2 * 100)
    if row.get("debt_equity") is not None:
        de = row["debt_equity"]
        parts.append(100 if de <= 0 else 0 if de >= 2 else (2 - de) / 2 * 100)
    if row.get("eps_growth_forecast_3y") is not None:
        parts.append(clamp(row["eps_growth_forecast_3y"], 0, 50) / 50 * 100)
    long_term_score = round(sum(parts) / len(parts), 1) if parts else None

    # --- Swing Score: μέσος όρος 4 normalized υπο-δεικτών ---
    sparts = []
    price, ma50, ma200 = row.get("price"), row.get("ma50"), row.get("ma200")
    if None not in (price, ma50, ma200):
        if price > ma50 > ma200:
            sparts.append(100)
        elif price < ma50 < ma200:
            sparts.append(0)
        else:
            sparts.append(50)
    if row.get("rsi") is not None:
        rsi = row["rsi"]
        if 45 <= rsi <= 65:
            sparts.append(100)
        else:
            edge = 45 if rsi < 45 else 65
            sparts.append(clamp(100 - abs(rsi - edge) * 4, 0, 100))
    if row.get("week52_change") is not None:
        sparts.append(clamp(row["week52_change"], 0, 100))
    if row.get("beta") is not None:
        sparts.append(clamp(row["beta"], 0, 3) / 3 * 100)
    swing_score = round(sum(sparts) / len(sparts), 1) if sparts else None

    return long_term_score, swing_score


def scan_ticker(ticker, name, previous):
    try:
        tbl, price = fetch_table_map(ticker)
    except (URLError, HTTPError, TimeoutError, OSError) as e:
        print(f"  ! {ticker}: δικτυακό σφάλμα ({e}) — κρατάω παλιά δεδομένα")
        return previous

    row = {
        "ticker": ticker,
        "name": name,
        "price": price,
        "pe_ratio": to_number(tbl.get("PE Ratio")),
        "peg_ratio": to_number(tbl.get("PEG Ratio")),
        "debt_equity": to_number(tbl.get("Debt / Equity")),
        "roe": to_number(tbl.get("Return on Equity (ROE)")),
        "roic": to_number(tbl.get("Return on Invested Capital (ROIC)")),
        "fcf_yield": to_number(tbl.get("FCF Yield")),
        "rsi": to_number(tbl.get("Relative Strength Index (RSI)")),
        "ma50": to_number(tbl.get("50-Day Moving Average")),
        "ma200": to_number(tbl.get("200-Day Moving Average")),
        "week52_change": to_number(tbl.get("52-Week Price Change")),
        "beta": to_number(tbl.get("Beta (5Y)")),
        "analyst_consensus": tbl.get("Analyst Consensus"),
        "price_target": to_number(tbl.get("Price Target")),
        "eps_growth_forecast_3y": to_number(tbl.get("EPS Growth Forecast (3Y)")),
        "revenue_growth_forecast_3y": to_number(tbl.get("Revenue Growth Forecast (3Y)")),
        "altman_z": to_number(tbl.get("Altman Z-Score")),
        "piotroski_f": to_number(tbl.get("Piotroski F-Score")),
        "market_cap": tbl.get("Market Cap"),
    }

    # Fallback τιμής: Market Cap / Shares Outstanding, αν δεν βρέθηκε απευθείας τιμή.
    if row["price"] is None:
        mc = to_number(tbl.get("Market Cap"))
        so = to_number(tbl.get("Shares Outstanding") or tbl.get("Current Share Class"))
        if mc and so:
            row["price"] = round(mc / so, 2)

    # Αν λείπουν πάρα πολλά βασικά πεδία, μάλλον απέτυχε το parsing -> κράτα τα παλιά.
    critical = ["price", "rsi", "ma50", "ma200"]
    missing_critical = sum(1 for k in critical if row.get(k) is None)
    if missing_critical >= 3 and previous:
        print(f"  ! {ticker}: πολλά κενά πεδία, μάλλον fail στο parsing — κρατάω παλιά δεδομένα")
        return previous

    row["long_term_score"], row["swing_score"] = score_from(row)
    if row["long_term_score"] is None and previous:
        row["long_term_score"] = previous.get("long_term_score")
    if row["swing_score"] is None and previous:
        row["swing_score"] = previous.get("swing_score")

    return row


def main():
    previous_by_ticker = {}
    if DATA_JSON.exists():
        try:
            old = json.loads(DATA_JSON.read_text(encoding="utf-8"))
            for s in old.get("stocks", []):
                previous_by_ticker[s["ticker"]] = s
        except Exception:
            pass

    results = []
    failures = 0
    for i, (ticker, name) in enumerate(TICKERS.items(), 1):
        print(f"[{i}/{len(TICKERS)}] {ticker} ({name})")
        prev = previous_by_ticker.get(ticker)
        try:
            row = scan_ticker(ticker, name, prev)
        except Exception as e:
            print(f"  ! {ticker}: απροσδόκητο σφάλμα ({e})")
            row = prev
            failures += 1
        if row:
            results.append(row)
        time.sleep(1.2)  # ευγενική καθυστέρηση μεταξύ requests

    if not results:
        print("Καμία μετοχή δεν ανακτήθηκε επιτυχώς — δεν γράφω data.json.", file=sys.stderr)
        sys.exit(1)

    out = {
        "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "stocks": results,
    }
    DATA_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=None), encoding="utf-8")
    print(f"\nΈγραψα {len(results)} μετοχές στο {DATA_JSON} ({failures} απέτυχαν πλήρως).")


if __name__ == "__main__":
    main()
