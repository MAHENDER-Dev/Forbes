// Shared Forbes helpers (files prefixed with "_" are NOT exposed as API routes).
// Node 18+ global fetch is used (Vercel default runtime).

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": UA,
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://www.forbes.com/real-time-billionaires/",
  "Accept-Language": "en-US,en;q=0.9",
};

const RICH_FIELDS = [
  "rank", "uri", "personName", "finalWorth", "estWorthPrev", "squareImage",
  "birthDate", "gender", "industries", "source", "countryOfCitizenship",
  "city", "selfMade", "selfMadeRank", "philanthropyScore",
].join(",");

// Real-time feed with holdings attached (the only place financialAssets lives).
const RTB_FIELDS = RICH_FIELDS + ",financialAssets";

// USD value of one holding. Forbes already reports sharePrice in USD (even when
// currencyCode is a local currency), so do NOT multiply by exchangeRate — that
// would inflate non-USD holdings ~thousand-fold. Verified against net worth.
function assetValueUSD(a) {
  const shares = Number(a.numberOfShares || 0);
  const price = Number(a.sharePrice != null ? a.sharePrice : (a.currentPrice || 0));
  const v = shares * price;
  return v > 0 ? v : 0;
}

// Compact, ranked holdings for one person (value stored in $M to match net worth).
function holdingsOf(financialAssets, cap) {
  if (!Array.isArray(financialAssets)) return [];
  const out = financialAssets.map((a) => ({
    ticker: (a.ticker || "").replace(/-US$/, ""),
    exchange: a.exchange || "",
    company: a.companyName || a.ticker || "",
    shares: Number(a.numberOfShares || 0),
    price: Number(a.sharePrice != null ? a.sharePrice : (a.currentPrice || 0)),
    currency: a.currencyCode || "USD",
    value: Math.round(assetValueUSD(a) / 1e6),   // $M
  })).filter((c) => c.company);
  out.sort((x, y) => y.value - x.value);
  return cap && out.length > cap ? out.slice(0, cap) : out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch with small retry/backoff — Forbes occasionally 503s a datacenter IP.
async function fetchJson(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.ok) return r.json();
      lastErr = new Error("Forbes HTTP " + r.status);
      if (r.status < 500 && r.status !== 429) break; // 4xx (except 429) won't fix on retry
    } catch (e) {
      lastErr = e;
    }
    if (i < tries - 1) await sleep(600 * (i + 1));
  }
  throw lastErr || new Error("fetch failed");
}

async function fetchList(url) {
  const j = await fetchJson(url);
  return (j.personList && j.personList.personsLists) || [];
}

// The annual "World's Billionaires" list is the COMPLETE ranked list.
async function fetchAnnual() {
  const year = new Date().getFullYear();
  for (let y = year; y >= year - 2; y--) {
    try {
      const l = await fetchList(
        `https://www.forbes.com/forbesapi/person/billionaires/${y}/position/true.json?fields=${RICH_FIELDS}`
      );
      if (l.length) return l;
    } catch (e) { /* try previous year */ }
  }
  return [];
}

function buildImage(squareImage) {
  if (!squareImage) return "";
  const m = String(squareImage).match(/imageserve\/([a-f0-9]{24})/i);
  if (m) {
    return "https://imageio.forbes.com/specials-images/imageserve/" + m[1] +
      "/416x416.jpg?format=jpg&width=416&height=416";
  }
  if (String(squareImage).indexOf("//") === 0) return "https:" + squareImage;
  return squareImage;
}

function ageOf(birthDateMs) {
  if (birthDateMs == null || birthDateMs === "") return null;
  const yrs = (Date.now() - Number(birthDateMs)) / (365.25 * 24 * 3600 * 1000);
  return (yrs > 0 && yrs < 130) ? Math.floor(yrs) : null;
}

function dobOf(birthDateMs) {
  if (birthDateMs == null || birthDateMs === "") return null;
  const d = new Date(Number(birthDateMs));
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 1900 || y > new Date().getUTCFullYear()) return null;
  return d.toISOString().slice(0, 10);
}

function genderOf(g) {
  if (!g) return "";
  const u = String(g).trim().toUpperCase();
  if (u === "M" || u === "MALE") return "Male";
  if (u === "F" || u === "FEMALE") return "Female";
  return String(g);
}

// Map a Forbes ticker (e.g. "AAPL-US", "VIC-VN") to a Yahoo Finance symbol.
// US -> bare ("AAPL"); others -> "BASE.SUFFIX" with a small exchange remap.
const YAHOO_SUFFIX = {
  US: "", VN: "VN", HK: "HK", IN: "NS", UK: "L", GB: "L", JP: "T", FR: "PA",
  DE: "DE", CN: "SS", TW: "TW", KR: "KS", CA: "TO", AU: "AX", BR: "SA",
  SE: "ST", CH: "SW", IT: "MI", ES: "MC", NL: "AS", RU: "ME", ID: "JK",
  TH: "BK", SG: "SI", MY: "KL", PH: "PS", MX: "MX", NO: "OL", DK: "CO", FI: "HE",
};
function yahooSymbol(t) {
  if (!t) return "";
  t = String(t).trim().toUpperCase();
  const m = t.match(/^(.+)-([A-Z]{1,3})$/);
  if (!m) return t;
  const base = m[1], ex = m[2];
  if (Object.prototype.hasOwnProperty.call(YAHOO_SUFFIX, ex)) {
    const suf = YAHOO_SUFFIX[ex];
    return suf ? base + "." + suf : base;
  }
  return base + "." + ex; // best effort for unmapped exchanges
}

// Yahoo now gates quoteSummary behind a cookie+crumb handshake (still keyless).
// Cache the pair on the warm instance so we don't re-handshake every call.
let _crumb = null, _cookie = null, _crumbTs = 0;
async function yahooCrumb(force) {
  if (!force && _crumb && _cookie && (Date.now() - _crumbTs) < 25 * 60 * 1000) {
    return { crumb: _crumb, cookie: _cookie };
  }
  const r1 = await fetch("https://fc.yahoo.com/", { headers: HEADERS, redirect: "manual" });
  const cookie = (r1.headers.get("set-cookie") || "").split(";")[0];
  const r2 = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb",
    { headers: Object.assign({}, HEADERS, { Cookie: cookie }) });
  const crumb = (await r2.text()).trim();
  if (cookie && crumb && !/[<{]/.test(crumb)) { _crumb = crumb; _cookie = cookie; _crumbTs = Date.now(); }
  return { crumb: _crumb, cookie: _cookie };
}

module.exports = {
  HEADERS, RICH_FIELDS, RTB_FIELDS, fetchJson, fetchList, fetchAnnual,
  buildImage, ageOf, dobOf, genderOf, assetValueUSD, holdingsOf, yahooSymbol, yahooCrumb,
};
