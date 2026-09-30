// GET /api/fundamentals?symbol=<ticker>
// Company fundamentals. Prefers Financial Modeling Prep (FMP_KEY) for rich, clean
// data; falls back to Yahoo quoteSummary (keyless crumb) if FMP is unset/unavailable.
// Keys live ONLY in server env vars, never sent to the browser.

const F = require("./_forbes");
const FMP = "https://financialmodelingprep.com/stable";
const jget = async (url) => { const r = await fetch(url); return r.ok ? r.json() : null; };

async function fromFMP(sym, key) {
  const [pf, rt, km] = await Promise.all([
    jget(`${FMP}/profile?symbol=${encodeURIComponent(sym)}&apikey=${key}`),
    jget(`${FMP}/ratios-ttm?symbol=${encodeURIComponent(sym)}&apikey=${key}`),
    jget(`${FMP}/key-metrics-ttm?symbol=${encodeURIComponent(sym)}&apikey=${key}`),
  ]);
  const p = pf && pf[0], r = (rt && rt[0]) || {}, k = (km && km[0]) || {};
  if (!p) return null;
  return {
    symbol: sym, source: "FMP",
    name: p.companyName || "",
    marketCap: p.marketCap != null ? p.marketCap : null,
    pe: r.priceToEarningsRatioTTM != null ? r.priceToEarningsRatioTTM : null,
    forwardPe: null,
    eps: k.netIncomePerShareTTM != null ? k.netIncomePerShareTTM : null,
    beta: p.beta != null ? p.beta : null,
    profitMargin: r.netProfitMarginTTM != null ? r.netProfitMarginTTM : null,
    grossMargin: r.grossProfitMarginTTM != null ? r.grossProfitMarginTTM : null,
    revenue: k.revenuePerShareTTM != null && p.marketCap && p.price ? (k.revenuePerShareTTM * (p.marketCap / p.price)) : null,
    revenueGrowth: null,
    roe: k.returnOnEquityTTM != null ? k.returnOnEquityTTM : null,
    priceToBook: r.priceToBookRatioTTM != null ? r.priceToBookRatioTTM : null,
    dividendYield: r.dividendYieldTTM != null ? r.dividendYieldTTM : null,
    payoutRatio: null,
    targetMean: null, recommendation: "",
    sector: p.sector || "", industry: p.industry || "",
    employees: p.fullTimeEmployees != null ? p.fullTimeEmployees : null,
    country: p.country || "", website: p.website || "",
    ceo: p.ceo || "", summary: p.description || "",
  };
}

async function fromYahoo(sym) {
  const MODULES = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile";
  const call = async (crumb, cookie) => fetch(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${MODULES}&crumb=${encodeURIComponent(crumb)}`,
    { headers: Object.assign({}, F.HEADERS, { Cookie: cookie }) }
  );
  let { crumb, cookie } = await F.yahooCrumb();
  let r = await call(crumb, cookie);
  if (r.status === 401 || r.status === 403) { ({ crumb, cookie } = await F.yahooCrumb(true)); r = await call(crumb, cookie); }
  if (!r.ok) return null;
  const j = await r.json();
  const R = j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
  if (!R) return null;
  const sd = R.summaryDetail || {}, ks = R.defaultKeyStatistics || {}, fd = R.financialData || {}, pr = R.price || {}, ap = R.assetProfile || {};
  const n = (o) => (o && o.raw != null ? o.raw : null);
  return {
    symbol: sym, source: "Yahoo",
    name: pr.longName || pr.shortName || "",
    marketCap: n(pr.marketCap) || n(sd.marketCap), pe: n(sd.trailingPE), forwardPe: n(sd.forwardPE),
    eps: n(ks.trailingEps), beta: n(sd.beta) || n(ks.beta),
    profitMargin: n(fd.profitMargins), grossMargin: n(fd.grossMargins),
    revenue: n(fd.totalRevenue), revenueGrowth: n(fd.revenueGrowth),
    roe: n(fd.returnOnEquity), priceToBook: n(ks.priceToBook),
    dividendYield: n(sd.dividendYield), payoutRatio: n(sd.payoutRatio),
    targetMean: n(fd.targetMeanPrice), recommendation: fd.recommendationKey || "",
    sector: ap.sector || "", industry: ap.industry || "",
    employees: n(ap.fullTimeEmployees), country: ap.country || "", website: ap.website || "",
    ceo: "", summary: ap.longBusinessSummary || "",
  };
}

module.exports = async (req, res) => {
  const raw = (req.query && req.query.symbol) || new URL(req.url, "http://x").searchParams.get("symbol");
  if (!raw) return res.status(400).json({ error: "missing symbol" });
  const sym = F.yahooSymbol(raw);   // US -> bare, else BASE.SUFFIX (works for both FMP & Yahoo)
  try {
    let out = null;
    if (process.env.FMP_KEY) { try { out = await fromFMP(sym, process.env.FMP_KEY); } catch (e) {} }
    if (!out) out = await fromYahoo(sym);
    if (!out) return res.status(404).json({ error: "no fundamentals", symbol: sym });
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=21600");
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e), symbol: sym });
  }
};
