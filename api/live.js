// GET /api/live?symbol=<ticker>
// Real-time quote from Finnhub (US stocks, free tier). The API key lives ONLY in
// the FINNHUB_KEY server env var — never sent to the browser. If no key is set,
// returns {enabled:false} so the client falls back to (delayed) Yahoo polling.

// Finnhub uses bare US tickers; strip a trailing "-US"/"-XX" exchange suffix.
function finnhubSymbol(t) {
  return String(t || "").trim().toUpperCase().replace(/-[A-Z]{1,3}$/, "");
}

module.exports = async (req, res) => {
  const key = process.env.FINNHUB_KEY;
  const raw = (req.query && req.query.symbol) ||
    new URL(req.url, "http://x").searchParams.get("symbol");
  if (!raw) return res.status(400).json({ error: "missing symbol" });

  if (!key) { res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ enabled: false }); }

  const sym = finnhubSymbol(raw);
  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${key}`
    );
    if (!r.ok) return res.status(502).json({ enabled: true, error: "Finnhub HTTP " + r.status, symbol: sym });
    const q = await r.json();               // {c,d,dp,h,l,o,pc,t}
    if (q.c == null || q.c === 0) return res.status(404).json({ enabled: true, error: "no real-time data", symbol: sym });
    res.setHeader("Cache-Control", "no-store");   // real-time: never cache
    res.status(200).json({
      enabled: true, realtime: true, symbol: sym,
      price: q.c, change: q.d, changePct: q.dp,
      high: q.h, low: q.l, open: q.o, prevClose: q.pc, t: q.t,
    });
  } catch (e) {
    res.status(500).json({ enabled: true, error: String((e && e.message) || e), symbol: sym });
  }
};
