#!/usr/bin/env python3
"""
scan.py — Ξανατρέχει το scoring όλων των μετοχών του trading-copilot dashboard
και γράφει το ../data.json, σε πολλαπλές αγορές (ΗΠΑ + διεθνείς).

Πηγή δεδομένων: stockanalysis.com (δωρεάν, δημόσιο). Μεθοδολογία scoring: ίδια
με αυτή που περιγράφεται στο footer του dashboard (Long-Term Score & Swing
Score, μέσος όρος normalized υπο-δεικτών 0-100).

Πολλαπλές αγορές (MARKET_META): κάθε μη-αμερικανική μετοχή αποθηκεύεται με
επίθημα στο ticker της (σύμβαση Yahoo/Google Finance — π.χ. AZN.L, SAP.DE,
BHP.AX) ώστε να μη συγκρούεται με ομώνυμα αμερικανικά tickers (π.χ. "T" =
AT&T στις ΗΠΑ αλλά Telus στον Καναδά) και να παραμένει μοναδικό κλειδί σε
όλη την εφαρμογή. Οι αμερικανικές μετοχές δεν παίρνουν επίθημα (ίδια
συμπεριφορά με πριν, ώστε να μη σπάσει το Trading212 sync/θέσεις/journal).

Σχεδιασμένο να είναι ανθεκτικό: αν αποτύχει η ανάκτηση/parsing για μια μετοχή,
κρατάει τα προηγούμενα γνωστά δεδομένα της αντί να ρίξει όλο το script.
"""
import base64
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

ROOT = Path(__file__).resolve().parent.parent
DATA_JSON = ROOT / "data.json"
NEWS_JSON = ROOT / "news.json"

# Καθυστέρηση μεταξύ requests (δευτ.) — SCAN_SLEEP=0.5 για γρηγορότερο τοπικό run
SCAN_SLEEP = float(os.environ.get("SCAN_SLEEP", "1.2"))

# Στατικό fallback: ticker -> εμφανιζόμενο όνομα (μόνο ΗΠΑ).
# Το πραγματικό universe ΗΠΑ έρχεται δυναμικά από τη λίστα S&P 500 (fetch_universe) —
# αυτό εδώ χρησιμοποιείται μόνο αν αποτύχει το fetch της λίστας.
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

# ---------------------------------------------------------------------------
# V6 — Πολλαπλές αγορές
# ---------------------------------------------------------------------------
# exchange_code: το τμήμα της διεύθυνσης stockanalysis.com/quote/{exchange_code}/{ticker}/
#   (None για ΗΠΑ, που χρησιμοποιεί το παλιό μοτίβο /stocks/{ticker}/)
# suffix: προστίθεται στο ΔΙΚΟ ΜΑΣ ticker (Yahoo/Google Finance σύμβαση) ώστε να
#   μένει μοναδικό — π.χ. Telus (Καναδάς) -> "T.TO", ώστε να μη συγκρούεται με
#   το αμερικανικό "T" (AT&T).
MARKET_META = {
    "us": {"label": "ΗΠΑ (S&P 500)",         "flag": "🇺🇸", "suffix": "",    "exchange_code": None},
    "gr": {"label": "Ελλάδα (ATHEX)",         "flag": "🇬🇷", "suffix": ".AT", "exchange_code": "ath"},
    "fr": {"label": "Γαλλία (Euronext Paris)", "flag": "🇫🇷", "suffix": ".PA", "exchange_code": "epa"},
    "jp": {"label": "Ιαπωνία (Tokyo)",        "flag": "🇯🇵", "suffix": ".T",  "exchange_code": "tyo"},
    "au": {"label": "Αυστραλία (ASX)",        "flag": "🇦🇺", "suffix": ".AX", "exchange_code": "asx"},
    "uk": {"label": "Ην. Βασίλειο (FTSE 100)", "flag": "🇬🇧", "suffix": ".L",  "exchange_code": "lon"},
    "de": {"label": "Γερμανία (DAX 40)",      "flag": "🇩🇪", "suffix": ".DE", "exchange_code": "etr"},
    "hk": {"label": "Hong Kong (Hang Seng)",  "flag": "🇭🇰", "suffix": ".HK", "exchange_code": "hkg"},
    "ca": {"label": "Καναδάς (TSX 60)",       "flag": "🇨🇦", "suffix": ".TO", "exchange_code": "tsx"},
}

# "Καθαρές" αγορές: η raw λίστα του stockanalysis.com δεν έχει μόλυνση από
# δευτερεύουσες εισαγωγές (dual-listings) μεγάλων αμερικανικών εταιρειών —
# οπότε μπορούμε να πάρουμε απευθείας τις πρώτες N κατά κεφαλαιοποίηση.
# (url, μέγιστος αριθμός μετοχών)
DYNAMIC_LIST_URLS = {
    "gr": ("https://stockanalysis.com/list/athens-stock-exchange/", 100),
    "fr": ("https://stockanalysis.com/list/euronext-paris/", 40),
    "jp": ("https://stockanalysis.com/list/tokyo-stock-exchange/", 100),
    "au": ("https://stockanalysis.com/list/australian-securities-exchange/", 100),
}

# "Επιμελημένες" αγορές: η raw λίστα του stockanalysis.com είναι κυριαρχημένη
# από dual-listings μεγάλων αμερικανικών εταιρειών (π.χ. στο LSE η πρώτη θέση
# κατά κεφαλαιοποίηση είναι η NVIDIA, όχι βρετανική εταιρεία) — χρειάζεται
# πραγματική λίστα συστατικών δείκτη από αξιόπιστη πηγή (Wikipedia / index
# provider). Συμπληρώνεται παρακάτω.
# Πηγή: https://en.wikipedia.org/wiki/FTSE_100_Index ("as of 19 June 2026")
FTSE_100 = {
    "III": "3i Group", "ABDN": "Aberdeen Group", "ADM": "Admiral Group", "AAF": "Airtel Africa",
    "ALW": "Alliance Witan", "AAL": "Anglo American", "ANTO": "Antofagasta", "ABF": "Associated British Foods",
    "AZN": "AstraZeneca", "AUTO": "Auto Trader Group", "AV": "Aviva", "BAB": "Babcock International",
    "BA": "BAE Systems", "BARC": "Barclays", "BTRW": "Barratt Redrow", "BEZ": "Beazley",
    "BP": "BP", "BATS": "British American Tobacco", "BLND": "British Land", "BT.A": "BT Group",
    "BNZL": "Bunzl", "BRBY": "Burberry", "CNA": "Centrica", "CCEP": "Coca-Cola Europacific Partners",
    "CCH": "Coca-Cola HBC", "CPG": "Compass Group", "CCC": "Computacenter", "CTEC": "Convatec Group",
    "CRDA": "Croda International", "DCC": "DCC", "DGE": "Diageo", "DPLM": "Diploma",
    "EDV": "Endeavour Mining", "ENT": "Entain", "EXPN": "Experian", "FCIT": "F&C Investment Trust",
    "FRES": "Fresnillo", "GAW": "Games Workshop", "GLEN": "Glencore", "GSK": "GSK",
    "HLN": "Haleon", "HLMA": "Halma", "HSX": "Hiscox", "HWDN": "Howdens Joinery",
    "HSBA": "HSBC Holdings", "ICG": "ICG", "IGG": "IG Group", "IHG": "IHG Hotels & Resorts",
    "IMI": "IMI", "IMB": "Imperial Brands", "INF": "Informa", "IAG": "International Airlines Group",
    "ITRK": "Intertek Group", "INVP": "Investec", "JD": "JD Sports Fashion", "BGEO": "Lion Finance Group",
    "KGF": "Kingfisher", "LAND": "Land Securities", "LGEN": "Legal & General", "LLOY": "Lloyds Banking Group",
    "LMP": "LondonMetric Property", "LSEG": "London Stock Exchange Group", "MNG": "M&G", "MKS": "Marks & Spencer",
    "MRO": "Melrose Industries", "MTLN": "Metlen Energy & Metals", "NG": "National Grid", "NWG": "NatWest Group",
    "NXT": "Next", "PSON": "Pearson", "PSH": "Pershing Square Holdings", "PSN": "Persimmon",
    "PCT": "Polar Capital Technology Trust", "PRU": "Prudential", "RKT": "Reckitt Benckiser", "REL": "RELX",
    "RTO": "Rentokil Initial", "RIO": "Rio Tinto", "RR": "Rolls-Royce Holdings", "SGE": "Sage Group",
    "SBRY": "Sainsbury's", "SDR": "Schroders", "SMT": "Scottish Mortgage Investment Trust", "SGRO": "Segro",
    "SVT": "Severn Trent", "SHEL": "Shell", "SMIN": "Smiths Group", "SN": "Smith & Nephew",
    "SPX": "Spirax Group", "SSE": "SSE", "STAN": "Standard Chartered", "SDLF": "Standard Life",
    "STJ": "St. James's Place", "TSCO": "Tesco", "BBOX": "Tritax Big Box REIT", "ULVR": "Unilever",
    "UU": "United Utilities", "VOD": "Vodafone Group", "WEIR": "Weir Group", "WTB": "Whitbread",
}

# Πηγή: https://en.wikipedia.org/wiki/DAX ("as of 22 September 2025" — παλαιότερο snapshot
# από τα υπόλοιπα 3, αλλά η σύνθεση του DAX 40 σπάνια αλλάζει)
DAX_40 = {
    "ADS": "Adidas", "AIR": "Airbus", "ALV": "Allianz", "BAS": "BASF",
    "BAYN": "Bayer", "BEI": "Beiersdorf", "BMW": "BMW", "BNR": "Brenntag",
    "CBK": "Commerzbank", "CON": "Continental", "DTG": "Daimler Truck", "DBK": "Deutsche Bank",
    "DB1": "Deutsche Börse", "DHL": "DHL Group", "DTE": "Deutsche Telekom", "EOAN": "E.ON",
    "FRE": "Fresenius", "FME": "Fresenius Medical Care", "G1A": "GEA Group", "HNR1": "Hannover Re",
    "HEI": "Heidelberg Materials", "HEN3": "Henkel", "IFX": "Infineon Technologies", "MBG": "Mercedes-Benz Group",
    "MRK": "Merck KGaA", "MTX": "MTU Aero Engines", "MUV2": "Munich Re", "PAH3": "Porsche SE",
    "QIA": "Qiagen", "RHM": "Rheinmetall", "RWE": "RWE", "SAP": "SAP",
    "G24": "Scout24", "SIE": "Siemens", "ENR": "Siemens Energy", "SHL": "Siemens Healthineers",
    "SY1": "Symrise", "VOW3": "Volkswagen", "VNA": "Vonovia", "ZAL": "Zalando",
}

# Πηγή: https://en.wikipedia.org/wiki/Hang_Seng_Index ("as of January 2026")
HANG_SENG = {
    "0005": "HSBC Holdings", "0388": "HKEX", "0939": "China Construction Bank", "1299": "AIA Group",
    "1398": "ICBC", "2318": "Ping An Insurance", "2388": "BOC Hong Kong", "2628": "China Life Insurance",
    "3968": "China Merchants Bank", "3988": "Bank of China", "0002": "CLP Holdings", "0003": "Hong Kong and China Gas",
    "0006": "Power Assets Holdings", "0836": "China Resources Power", "1038": "CK Infrastructure Holdings", "2688": "ENN Energy",
    "0012": "Henderson Land Development", "0016": "Sun Hung Kai Properties", "0101": "Hang Lung Properties", "0688": "China Overseas Land & Investment",
    "0823": "Link REIT", "0960": "Longfor Group", "1109": "China Resources Land", "1113": "CK Asset Holdings",
    "1209": "China Resources Mixc Lifestyle", "1997": "Wharf REIC", "0001": "CK Hutchison Holdings", "0027": "Galaxy Entertainment Group",
    "0066": "MTR Corporation", "0175": "Geely Auto", "0241": "Alibaba Health", "0267": "CITIC",
    "0285": "BYD Electronic", "0288": "WH Group", "0291": "China Resources Beer", "0300": "Midea Group",
    "0316": "Orient Overseas International", "0322": "Tingyi", "0386": "Sinopec Corp", "0669": "Techtronic Industries",
    "0700": "Tencent Holdings", "0762": "China Unicom Hong Kong", "0857": "PetroChina", "0868": "Xinyi Glass",
    "0881": "Zhongsheng Group", "0883": "CNOOC", "0941": "China Mobile", "0968": "Xinyi Solar",
    "0981": "SMIC", "0992": "Lenovo Group", "1024": "Kuaishou Technology", "1044": "Hengan International",
    "1088": "China Shenhua Energy", "1093": "CSPC Pharmaceutical Group", "1099": "Sinopharm Group", "1177": "Sino Biopharmaceutical",
    "1211": "BYD Company", "1378": "China Hongqiao Group", "1810": "Xiaomi", "1876": "Budweiser APAC",
    "1928": "Sands China", "1929": "Chow Tai Fook Jewellery", "2015": "Li Auto", "2020": "Anta Sports",
    "2057": "ZTO Express", "2269": "WuXi Biologics", "2313": "Shenzhou International", "2319": "China Mengniu Dairy",
    "2331": "Li Ning", "2359": "WuXi AppTec", "2382": "Sunny Optical Technology", "2618": "JD Logistics",
    "2899": "Zijin Mining", "3690": "Meituan", "3692": "Hansoh Pharmaceutical", "6618": "JD Health International",
    "6690": "Haier Smart Home", "6862": "Haidilao International", "9618": "JD.com", "9633": "Nongfu Spring",
    "9888": "Baidu", "9961": "Trip.com Group", "9988": "Alibaba Group", "9992": "Pop Mart",
    "9999": "NetEase",
}

# Πηγή: https://en.wikipedia.org/wiki/S%26P/TSX_60 ("as of January 31, 2026")
TSX_60 = {
    "AEM": "Agnico Eagle Mines", "ATD": "Alimentation Couche-Tard", "BMO": "Bank of Montreal", "BNS": "Bank of Nova Scotia",
    "ABX": "Barrick Mining", "BCE": "BCE", "BAM": "Brookfield Asset Management", "BN": "Brookfield Corporation",
    "BIP.UN": "Brookfield Infrastructure Partners", "CAE": "CAE", "CCO": "Cameco", "CM": "Canadian Imperial Bank of Commerce",
    "CNR": "Canadian National Railway", "CNQ": "Canadian Natural Resources", "CP": "Canadian Pacific Kansas City", "CTC.A": "Canadian Tire",
    "CCL.B": "CCL Industries", "CLS": "Celestica", "CVE": "Cenovus Energy", "GIB.A": "CGI",
    "CSU": "Constellation Software", "DOL": "Dollarama", "EMA": "Emera", "ENB": "Enbridge",
    "FFH": "Fairfax Financial Holdings", "FM": "First Quantum Minerals", "FSV": "FirstService", "FTS": "Fortis",
    "FNV": "Franco-Nevada", "WN": "George Weston", "GIL": "Gildan Activewear", "H": "Hydro One",
    "IMO": "Imperial Oil", "IFC": "Intact Financial", "K": "Kinross Gold", "L": "Loblaw Companies",
    "MG": "Magna International", "MFC": "Manulife Financial", "MRU": "Metro", "NA": "National Bank of Canada",
    "NTR": "Nutrien", "OTEX": "Open Text", "PPL": "Pembina Pipeline", "POW": "Power Corporation of Canada",
    "QSR": "Restaurant Brands International", "RCI.B": "Rogers Communications", "RY": "Royal Bank of Canada", "SAP": "Saputo",
    "SHOP": "Shopify", "SLF": "Sun Life Financial", "SU": "Suncor Energy", "TRP": "TC Energy",
    "TECK.B": "Teck Resources", "T": "Telus", "TRI": "Thomson Reuters", "TD": "Toronto-Dominion Bank",
    "TOU": "Tourmaline Oil", "WCN": "Waste Connections", "WPM": "Wheaton Precious Metals", "WSP": "WSP Global",
}
STATIC_LISTS = {"uk": FTSE_100, "de": DAX_40, "hk": HANG_SENG, "ca": TSX_60}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

# Σε κάποια τοπικά Python (π.χ. python.org στο macOS) το urllib δεν βρίσκει CA
# certificates — αν υπάρχει το certifi, χρησιμοποίησε το bundle του.
_SSL_CTX = None
try:
    import ssl
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    pass


def _urlopen(req, timeout=25):
    if _SSL_CTX is not None:
        return urlopen(req, timeout=timeout, context=_SSL_CTX)
    return urlopen(req, timeout=timeout)


def _base_url(raw_ticker, exchange_code, sub_path=""):
    """URL builder που δουλεύει και για ΗΠΑ (/stocks/{ticker}/...) και για
    διεθνείς αγορές (/quote/{exchange_code}/{ticker}/...)."""
    if exchange_code is None:
        slug = raw_ticker.lower().replace(".", "-")
        return f"https://stockanalysis.com/stocks/{slug}/{sub_path}"
    return f"https://stockanalysis.com/quote/{exchange_code}/{raw_ticker}/{sub_path}"


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
    "quick_ratio": ["Quick Ratio"],
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


def fetch_table_map(raw_ticker, exchange_code=None):
    """Κατεβάζει τη σελίδα στατιστικών και επιστρέφει dict label->value_text
    από ΟΛΑ τα label/value ζευγάρια σε <tr> με 2 κελιά, σε όλη τη σελίδα."""
    from bs4 import BeautifulSoup  # lazy: μόνο το stats scraping το χρειάζεται
    url = _base_url(raw_ticker, exchange_code, "statistics/")
    req = Request(url, headers=HEADERS)
    with _urlopen(req) as resp:
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
    text_blob = soup.get_text("\n", strip=True)
    m = re.search(r"\n([\d,]+\.\d{2,4})\n", "\n" + text_blob)
    if m:
        price = to_number(m.group(1))
    return out, price


_NAME_SUFFIX_RE = re.compile(
    r"[,]?\s+(Incorporated|Corporation|Company|Holdings?|Inc|Corp|Co|plc|Ltd|N\.V\.|S\.A\.)\.?$",
    re.IGNORECASE)


def _clean_company_name(name):
    """'NVIDIA Corporation' -> 'NVIDIA', 'Apple Inc.' -> 'Apple' (για καθαρό UI)."""
    prev = None
    while prev != name:
        prev = name
        name = _NAME_SUFFIX_RE.sub("", name).strip().rstrip("&,").strip()
    return name or prev


def fetch_universe():
    """Δυναμικό universe ΗΠΑ: όλες οι μετοχές του S&P 500 από το stockanalysis.com,
    ταξινομημένες κατά κεφαλαιοποίηση. Επιστρέφει dict ticker->name ή None."""
    from bs4 import BeautifulSoup
    url = "https://stockanalysis.com/list/sp-500-stocks/"
    try:
        req = Request(url, headers=HEADERS)
        with _urlopen(req) as resp:
            soup = BeautifulSoup(resp.read(), "lxml")
        table = soup.find("table")
        out = {}
        for tr in (table.find_all("tr")[1:] if table else []):
            cells = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
            if len(cells) >= 3 and cells[1]:
                out[cells[1]] = _clean_company_name(cells[2])
        if len(out) < 400:  # κάτι πήγε στραβά — μην εμπιστευτείς μισή λίστα
            print(f"! Λίστα S&P 500: μόνο {len(out)} σύμβολα — χρήση στατικού fallback.")
            return None
        return out
    except Exception as e:
        print(f"! Αποτυχία λήψης λίστας S&P 500 ({e}) — χρήση στατικού fallback.")
        return None


def resolve_universe():
    """Τελικό universe ΗΠΑ: δυναμική λίστα S&P 500, με τα ονόματα του στατικού
    TICKERS να προηγούνται (πιο σύντομα/οικεία) όπου υπάρχουν."""
    fetched = fetch_universe()
    if not fetched:
        return dict(TICKERS)
    merged = dict(fetched)
    merged.update({k: v for k, v in TICKERS.items() if k in merged})
    # κράτα και τυχόν δικά μας tickers εκτός S&P 500
    for k, v in TICKERS.items():
        merged.setdefault(k, v)
    return merged


def fetch_market_list(url, cap):
    """Top-N (κατά κεφαλαιοποίηση) από raw λίστα χρηματιστηρίου — μόνο για τις
    'καθαρές' αγορές του DYNAMIC_LIST_URLS. Επιστρέφει [(raw_ticker, name), ...]."""
    from bs4 import BeautifulSoup
    try:
        req = Request(url, headers=HEADERS)
        with _urlopen(req) as resp:
            soup = BeautifulSoup(resp.read(), "lxml")
        table = soup.find("table")
        out = []
        for tr in (table.find_all("tr")[1:] if table else []):
            cells = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
            if len(cells) >= 3 and cells[1]:
                out.append((cells[1], _clean_company_name(cells[2])))
            if len(out) >= cap:
                break
        return out
    except Exception as e:
        print(f"! Αποτυχία λήψης λίστας {url} ({e})")
        return []


def resolve_all_markets():
    """Πλήρες universe όλων των αγορών: [{ticker, raw, name, market, exchange_code}].
    'ticker' = το δικό μας μοναδικό σύμβολο (με επίθημα για μη-ΗΠΑ)."""
    entries = []

    us_universe = resolve_universe()
    for raw, name in us_universe.items():
        entries.append({"ticker": raw, "raw": raw, "name": name,
                         "market": "us", "exchange_code": None})

    for mkt, (url, cap) in DYNAMIC_LIST_URLS.items():
        meta = MARKET_META[mkt]
        for raw, name in fetch_market_list(url, cap):
            entries.append({"ticker": raw + meta["suffix"], "raw": raw, "name": name,
                             "market": mkt, "exchange_code": meta["exchange_code"]})
        time.sleep(SCAN_SLEEP)

    for mkt, static_dict in STATIC_LISTS.items():
        meta = MARKET_META[mkt]
        for raw, name in static_dict.items():
            entries.append({"ticker": raw + meta["suffix"], "raw": raw, "name": name,
                             "market": mkt, "exchange_code": meta["exchange_code"]})

    return entries


def fetch_sector_industry(raw_ticker, exchange_code=None):
    """Sector/Industry από τη σελίδα company/ (δεν υπάρχουν στο statistics/)."""
    from bs4 import BeautifulSoup
    url = _base_url(raw_ticker, exchange_code, "company/")
    req = Request(url, headers=HEADERS)
    with _urlopen(req) as resp:
        soup = BeautifulSoup(resp.read(), "lxml")
    sector, industry = None, None
    for tr in soup.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if len(cells) != 2:
            continue
        label = cells[0].get_text(strip=True)
        if label == "Sector":
            sector = cells[1].get_text(strip=True)
        elif label == "Industry":
            industry = cells[1].get_text(strip=True)
    return sector, industry


def fetch_roe_5y_avg(raw_ticker, exchange_code=None):
    """Μ.ο. ROE των 5 τελευταίων fiscal years από τη σελίδα financials/ratios.
    Αγνοεί τη στήλη 'Current' (ttm). Επιστρέφει None αν δεν βρεθεί."""
    from bs4 import BeautifulSoup
    url = _base_url(raw_ticker, exchange_code, "financials/ratios/")
    req = Request(url, headers=HEADERS)
    with _urlopen(req) as resp:
        soup = BeautifulSoup(resp.read(), "lxml")
    # Η σελίδα έχει πολλούς πίνακες (ένας ανά κατηγορία δεικτών) — ψάξε όλους.
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        headers = [c.get_text(strip=True) for c in rows[0].find_all(["td", "th"])]
        for tr in rows[1:]:
            cells = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
            if not cells or "Return on Equity" not in cells[0]:
                continue
            vals = []
            for i, cell in enumerate(cells[1:], start=1):
                if i < len(headers) and not headers[i].startswith("FY"):
                    continue  # στήλη 'Current' ή άσχετη
                v = to_number(cell)
                if v is not None:
                    vals.append(v)
                if len(vals) == 5:
                    break
            return round(sum(vals) / len(vals), 1) if vals else None
    return None


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


def scan_ticker(entry, previous):
    ticker = entry["ticker"]
    raw = entry["raw"]
    name = entry["name"]
    market = entry["market"]
    exchange_code = entry["exchange_code"]

    try:
        tbl, price = fetch_table_map(raw, exchange_code)
    except (URLError, HTTPError, TimeoutError, OSError) as e:
        print(f"  ! {ticker}: δικτυακό σφάλμα ({e}) — κρατάω παλιά δεδομένα")
        return previous

    row = {
        "ticker": ticker,
        "name": name,
        "market": market,
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
        "quick_ratio": to_number(tbl.get("Quick Ratio")),
        "market_cap": tbl.get("Market Cap"),
    }

    # ROE μ.ο. 5ετίας (για το quest checklist) — δεύτερο request, ανεκτικό σε αποτυχία
    time.sleep(SCAN_SLEEP * 0.6)
    try:
        row["roe_5y_avg"] = fetch_roe_5y_avg(raw, exchange_code)
    except Exception as e:
        print(f"  ! {ticker}: αποτυχία ROE 5Y ({e})")
        row["roe_5y_avg"] = previous.get("roe_5y_avg") if previous else None

    # Sector/Industry (για φίλτρα στο "Όλες οι μετοχές") — τρίτο request, ανεκτικό σε αποτυχία
    time.sleep(SCAN_SLEEP * 0.6)
    try:
        row["sector"], row["industry"] = fetch_sector_industry(raw, exchange_code)
    except Exception as e:
        print(f"  ! {ticker}: αποτυχία sector/industry ({e})")
        row["sector"] = previous.get("sector") if previous else None
        row["industry"] = previous.get("industry") if previous else None

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


# ---------------------------------------------------------------------------
# Ειδήσεις & sentiment (τροφοδοτεί την "Πρόβλεψη τάσης" του Trend Lab)
# ---------------------------------------------------------------------------

POSITIVE_WORDS = {
    "beat", "beats", "tops", "top", "record", "surge", "surges", "soar", "soars",
    "jump", "jumps", "rally", "rallies", "upgrade", "upgrades", "upgraded",
    "raises", "raised", "boost", "boosts", "outperform", "strong", "stronger",
    "growth", "gain", "gains", "wins", "win", "deal", "partnership", "partnering",
    "expands", "expansion", "bullish", "upside", "breakthrough", "approval",
    "approves", "buyback", "dividend", "profit", "profitable", "success",
    "milestone", "launches", "launch", "unveils", "accelerates", "momentum",
}
NEGATIVE_WORDS = {
    "miss", "misses", "missed", "falls", "fall", "drop", "drops", "plunge",
    "plunges", "slump", "slumps", "cut", "cuts", "downgrade", "downgrades",
    "downgraded", "underperform", "weak", "weaker", "lawsuit", "sues", "sued",
    "probe", "investigation", "recall", "layoffs", "bearish", "downside",
    "risk", "risks", "fears", "fear", "warning", "warns", "warn", "delay",
    "delays", "delayed", "ban", "bans", "fine", "fined", "decline", "declines",
    "tumble", "tumbles", "crash", "crashes", "loss", "losses", "danger",
    "concern", "concerns", "selloff", "sell-off", "halt", "halts",
}

WORD_RE = re.compile(r"[a-z']+")


def sentiment_of(text):
    """Απλό lexicon score ενός headline: -1.0 .. +1.0 (0 = ουδέτερο)."""
    words = WORD_RE.findall((text or "").lower())
    pos = sum(1 for w in words if w in POSITIVE_WORDS)
    neg = sum(1 for w in words if w in NEGATIVE_WORDS)
    raw = max(-3, min(3, pos - neg))
    return round(raw / 3, 2)


def _devalue_resolve(data, i, depth=0):
    """Αποκωδικοποίηση του συμπαγούς (devalue) format των SvelteKit __data.json:
    το data είναι flat array και τα values των dict/list είναι δείκτες σε αυτό."""
    if depth > 12 or not isinstance(i, int) or i < 0 or i >= len(data):
        return None
    v = data[i]
    if isinstance(v, dict):
        return {k: _devalue_resolve(data, idx, depth + 1) for k, idx in v.items()}
    if isinstance(v, list):
        return [_devalue_resolve(data, idx, depth + 1) for idx in v]
    return v


_MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def _parse_us_date(t):
    """'Jul 30, 2026' -> '2026-07-30' (αλλιώς None)."""
    m = re.match(r"([A-Z][a-z]{2}) (\d{1,2}), (\d{4})", (t or "").strip())
    if not m or m.group(1) not in _MONTHS:
        return None
    return f"{int(m.group(3)):04d}-{_MONTHS[m.group(1)]:02d}-{int(m.group(2)):02d}"


def _parse_news_time(t):
    """'2026-07-21T15:20:11.000Z' -> epoch· αλλιώς προσπάθησε 'Jul 20, 2026, ...'."""
    if not t:
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})", t)
    if m:
        y, mo, d, h, mi = map(int, m.groups())
        try:
            import calendar
            return calendar.timegm((y, mo, d, h, mi, 0, 0, 0, 0))
        except Exception:
            return None
    m = re.match(r"([A-Z][a-z]{2}) (\d{1,2}), (\d{4})", t)
    if m:
        months = {m_: i_ for i_, m_ in enumerate(
            ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
             "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}
        try:
            import calendar
            return calendar.timegm((int(m.group(3)), months[m.group(1)],
                                    int(m.group(2)), 12, 0, 0, 0, 0, 0))
        except Exception:
            return None
    return None


def fetch_news(raw_ticker, exchange_code=None):
    """Επιστρέφει (λίστα από {t, d, s, src, u}, earnings_date ISO ή None, rev_growth)."""
    url = _base_url(raw_ticker, exchange_code, "__data.json")
    req = Request(url, headers=HEADERS)
    with _urlopen(req) as resp:
        raw = json.loads(resp.read())
    items = []
    earnings = None
    rev_growth = None
    for node in raw.get("nodes", []):
        if not node or node.get("type") != "data":
            continue
        data = node["data"]
        for i, v in enumerate(data):
            if isinstance(v, dict) and "title" in v and "url" in v and "source" in v:
                it = _devalue_resolve(data, i)
                if it and isinstance(it.get("title"), str):
                    items.append(it)
            elif isinstance(v, dict) and "earningsDate" in v and earnings is None:
                idx = v["earningsDate"]
                val = data[idx] if isinstance(idx, int) and 0 <= idx < len(data) else None
                earnings = _parse_us_date(val)
                if rev_growth is None and "revenueGrowth" in v:
                    ri = v["revenueGrowth"]
                    rv = data[ri] if isinstance(ri, int) and 0 <= ri < len(data) else None
                    if isinstance(rv, (int, float)):
                        rev_growth = round(float(rv), 2)
    out = []
    for it in items:
        title = it["title"].strip()
        snippet = (it.get("text") or "")[:250]
        epoch = _parse_news_time(it.get("time"))
        out.append({
            "t": title,
            "d": time.strftime("%Y-%m-%d", time.gmtime(epoch)) if epoch else None,
            "epoch": epoch,
            "s": sentiment_of(title + " " + snippet),
            "src": it.get("source"),
            "u": it.get("url"),
        })
    return out, earnings, rev_growth


def ticker_news_summary(items, earnings=None, rev_growth=None):
    """Συνολικό sentiment -100..+100 με βάρος πρόσφατο (half-life 3 μέρες)."""
    now = time.time()
    wsum, wtot = 0.0, 0.0
    for it in items:
        age_days = (now - it["epoch"]) / 86400 if it["epoch"] else 14
        w = 0.5 ** (max(0.0, age_days) / 3.0)
        wsum += w * it["s"]
        wtot += w
    score = round((wsum / wtot) * 100) if wtot > 0 else 0
    headlines = [{k: it[k] for k in ("t", "d", "s", "src", "u")} for it in items[:8]]
    return {"score": score, "n": len(items), "headlines": headlines,
            "earnings_date": earnings, "revenue_growth_yoy": rev_growth}


def scan_news(entries=None, delay=None):
    if entries is None:
        entries = resolve_all_markets()
    if delay is None:
        delay = SCAN_SLEEP * 0.8
    previous = {}
    if NEWS_JSON.exists():
        try:
            previous = json.loads(NEWS_JSON.read_text(encoding="utf-8")).get("tickers", {})
        except Exception:
            pass

    tickers_out = {}
    for i, entry in enumerate(entries, 1):
        ticker = entry["ticker"]
        try:
            items, earnings, rev_growth = fetch_news(entry["raw"], entry["exchange_code"])
            tickers_out[ticker] = ticker_news_summary(items, earnings, rev_growth)
            print(f"[{i}/{len(entries)}] news {ticker}: {tickers_out[ticker]['n']} άρθρα, "
                  f"sentiment {tickers_out[ticker]['score']:+d}, earnings {earnings or '—'}")
        except Exception as e:
            print(f"  ! news {ticker}: {e} — κρατάω παλιά δεδομένα")
            if ticker in previous:
                tickers_out[ticker] = previous[ticker]
        time.sleep(delay)

    if not tickers_out:
        print("Καμία είδηση δεν ανακτήθηκε — δεν γράφω news.json.", file=sys.stderr)
        return
    out = {
        "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "tickers": tickers_out,
    }
    NEWS_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=None), encoding="utf-8")
    print(f"\nΈγραψα ειδήσεις/sentiment για {len(tickers_out)} μετοχές στο {NEWS_JSON}.")


# ---------------------------------------------------------------------------
# Ιστορικό επιδόσεων ("Ιστορικό Επιδόσεων" tab) — καθημερινό snapshot των
# Top-5 Long-Term / Top-5 Swing που δείχνει το tab "Σήμερα", ώστε αργότερα
# να συγκρίνουμε τι πρότεινε πραγματικά η εφαρμογή με το τι έγινε στην
# πράξη (win rate, μέση απόδοση, σύγκριση με SPY ως proxy του S&P 500).
# Append-only: κάθε scan προσθέτει ΤΟ ΠΟΛΥ ένα snapshot/ημέρα.
# ---------------------------------------------------------------------------

PICKS_HISTORY_JSON = ROOT / "picks_history.json"
MAX_SNAPSHOTS = 180  # ~6 μήνες καθημερινών snapshots πριν κόψουμε τα παλιά


def fetch_benchmark_price():
    """Τρέχουσα τιμή SPY (ETF που ακολουθεί τον S&P 500) ως σημείο αναφοράς."""
    req = Request("https://stockanalysis.com/etf/spy/", headers=HEADERS)
    with _urlopen(req) as resp:
        html = resp.read().decode("utf-8", errors="ignore")
    text_blob = re.sub(r"<[^>]+>", "\n", html)
    m = re.search(r"\n([\d,]+\.\d{2,4})\n", "\n" + text_blob)
    return to_number(m.group(1)) if m else None


def snapshot_picks(results):
    history = {"snapshots": []}
    if PICKS_HISTORY_JSON.exists():
        try:
            history = json.loads(PICKS_HISTORY_JSON.read_text(encoding="utf-8"))
        except Exception:
            pass

    today = time.strftime("%Y-%m-%d", time.gmtime())
    if any(s.get("date") == today for s in history.get("snapshots", [])):
        print(f"Ήδη υπάρχει snapshot picks για {today} — παραλείπω.")
        return

    try:
        spy_price = fetch_benchmark_price()
    except Exception as e:
        print(f"  ! Αποτυχία τιμής SPY ({e}) — snapshot χωρίς benchmark.")
        spy_price = None

    def top5(score_key):
        ranked = sorted(
            (r for r in results if r.get(score_key) is not None and r.get("price") is not None),
            key=lambda r: r[score_key], reverse=True,
        )[:5]
        return [{"ticker": r["ticker"], "market": r.get("market"), "price": r["price"]} for r in ranked]

    snapshot = {
        "date": today,
        "spy_price": spy_price,
        "long_term_top5": top5("long_term_score"),
        "swing_top5": top5("swing_score"),
    }
    history.setdefault("snapshots", []).append(snapshot)
    history["snapshots"] = history["snapshots"][-MAX_SNAPSHOTS:]

    PICKS_HISTORY_JSON.write_text(json.dumps(history, ensure_ascii=False, indent=None), encoding="utf-8")
    print(f"Snapshot picks {today}: {len(snapshot['long_term_top5'])} LT + "
          f"{len(snapshot['swing_top5'])} Swing (SPY={spy_price}) -> {PICKS_HISTORY_JSON}")


# ---------------------------------------------------------------------------
# Trading212 — αυτόματο sync θέσεων (προαιρετικό)
#
# Χρειάζεται τα env vars T212_API_KEY + T212_API_SECRET (ζευγάρι από Trading212
# → Settings → API — Basic Auth: base64("KEY:SECRET"), όχι πια μονό token).
# Προαιρετικά T212_MODE=demo|live (default: demo, δηλ. practice λογαριασμός).
# Στο GitHub Actions τα δίνουμε ως repository secrets — ΠΟΤΕ hardcoded εδώ.
# Χωρίς key, το sync απλά παραλείπεται και το site δείχνει τα χειροκίνητα
# POSITIONS του index.html.
# ---------------------------------------------------------------------------

POSITIONS_JSON = ROOT / "positions.json"


def t212_request(path, api_key, api_secret, mode):
    base = "https://demo.trading212.com" if mode == "demo" else "https://live.trading212.com"
    # Το Trading212 API χρησιμοποιεί HTTP Basic Auth: base64("API_KEY:API_SECRET").
    creds = base64.b64encode(f"{api_key}:{api_secret}".encode()).decode()
    req = Request(base + path, headers={"Authorization": f"Basic {creds}"})
    with _urlopen(req) as resp:
        return json.loads(resp.read())


def t212_plain_ticker(t):
    """'AAPL_US_EQ' -> 'AAPL' · 'BRKb_US_EQ' -> 'BRK.B' (πεζό στο τέλος = share class)."""
    core = (t or "").split("_")[0]
    if len(core) > 1 and core[-1].islower():
        core = core[:-1] + "." + core[-1].upper()
    return core.upper()


def sync_positions():
    import os
    api_key = os.environ.get("T212_API_KEY", "").strip()
    api_secret = os.environ.get("T212_API_SECRET", "").strip()
    mode = (os.environ.get("T212_MODE", "demo").strip() or "demo").lower()
    if not api_key or not api_secret:
        print("Χωρίς T212_API_KEY/T212_API_SECRET — παραλείπω το sync θέσεων (fallback στα χειροκίνητα POSITIONS).")
        return False

    try:
        portfolio = t212_request("/api/v0/equity/portfolio", api_key, api_secret, mode)
        time.sleep(1.5)  # όριο ρυθμού του T212 API
        cash = t212_request("/api/v0/equity/account/cash", api_key, api_secret, mode)
    except HTTPError as e:
        print(f"! Trading212 API: HTTP {e.code} — {'λάθος/ληγμένο key;' if e.code in (401, 403) else 'σφάλμα'} "
              f"Δεν γράφω positions.json.", file=sys.stderr)
        return False
    except (URLError, TimeoutError, OSError) as e:
        print(f"! Trading212 API: δικτυακό σφάλμα ({e}) — δεν γράφω positions.json.", file=sys.stderr)
        return False

    positions = []
    for p in portfolio if isinstance(portfolio, list) else []:
        positions.append({
            "ticker": t212_plain_ticker(p.get("ticker")),
            "t212_ticker": p.get("ticker"),
            "quantity": p.get("quantity"),
            "avg_price": p.get("averagePrice"),
            "current_price": p.get("currentPrice"),
            "ppl": p.get("ppl"),
            "fx_ppl": p.get("fxPpl"),
            "since": (p.get("initialFillDate") or "")[:10] or None,
        })

    out = {
        "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "mode": mode,
        "cash": {k: cash.get(k) for k in ("free", "total", "invested", "ppl", "result")}
        if isinstance(cash, dict) else {},
        "positions": positions,
    }
    POSITIONS_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=None), encoding="utf-8")
    print(f"Sync Trading212 ({mode}): {len(positions)} θέσεις -> {POSITIONS_JSON}")
    return True


def main():
    if "--news-only" in sys.argv:
        scan_news()
        return
    if "--positions-only" in sys.argv:
        sync_positions()
        return
    if "--snapshot-only" in sys.argv:
        if not DATA_JSON.exists():
            print("Δεν υπάρχει ακόμα data.json — τρέξε πρώτα πλήρες scan.", file=sys.stderr)
            sys.exit(1)
        results = json.loads(DATA_JSON.read_text(encoding="utf-8")).get("stocks", [])
        snapshot_picks(results)
        return

    entries = resolve_all_markets()
    by_market = {}
    for e in entries:
        by_market[e["market"]] = by_market.get(e["market"], 0) + 1
    summary = ", ".join(f"{MARKET_META[m]['flag']} {m}={n}" for m, n in by_market.items())
    print(f"Universe: {len(entries)} μετοχές σε {len(by_market)} αγορές: {summary}")

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
    for i, entry in enumerate(entries, 1):
        print(f"[{i}/{len(entries)}] {entry['ticker']} ({entry['name']}) [{entry['market']}]")
        prev = previous_by_ticker.get(entry["ticker"])
        try:
            row = scan_ticker(entry, prev)
        except Exception as e:
            print(f"  ! {entry['ticker']}: απροσδόκητο σφάλμα ({e})")
            row = prev
            failures += 1
        if row:
            results.append(row)
        time.sleep(SCAN_SLEEP)  # ευγενική καθυστέρηση μεταξύ requests

    if not results:
        print("Καμία μετοχή δεν ανακτήθηκε επιτυχώς — δεν γράφω data.json.", file=sys.stderr)
        sys.exit(1)

    out = {
        "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "stocks": results,
    }
    DATA_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=None), encoding="utf-8")
    print(f"\nΈγραψα {len(results)} μετοχές στο {DATA_JSON} ({failures} απέτυχαν πλήρως).")

    # Ειδήσεις & sentiment για το Trend Lab (ανθεκτικό: αποτυχία εδώ δεν ρίχνει το run)
    try:
        scan_news(entries)
    except Exception as e:
        print(f"! Το news scan απέτυχε συνολικά ({e}) — το data.json γράφτηκε κανονικά.")

    # Ιστορικό επιδόσεων: καταγραφή σημερινού Top-5 LT/Swing (ανθεκτικό)
    try:
        snapshot_picks(results)
    except Exception as e:
        print(f"! Το snapshot picks απέτυχε ({e}) — τα υπόλοιπα δεδομένα γράφτηκαν κανονικά.")

    # Sync θέσεων Trading212 (no-op χωρίς T212_API_KEY)
    try:
        sync_positions()
    except Exception as e:
        print(f"! Το sync θέσεων απέτυχε ({e}) — τα υπόλοιπα δεδομένα γράφτηκαν κανονικά.")


if __name__ == "__main__":
    main()
