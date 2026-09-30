// GET /api/quote?symbol=<forbes-or-yahoo-ticker>&range=1y
// Live stock quote + price history from Yahoo Finance (free, no API key).
// Retries with host rotation/backoff (Yahoo rate-limits datacenter IPs) and is
// edge-cached per symbol so bursts don't hammer the source.

const F = require("./_forbes");
const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const INTERVAL = { "5d": "15m", "1mo": "1d", "6mo": "1d", "1y": "1d", "5y": "1wk", "max": "1mo" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async (req, res) => {
  const raw = (req.query && req.query.symbol) ||
    new URL(req.url, "http://x").searchParams.get("symbol");
  const range = (req.query && req.query.range) ||
    new URL(req.url, "http://x").searchParams.get("range") || "1y";
  if (!raw) return res.status(400).json({ error: "missing symbol" });

  const sym = F.yahooSymbol(raw);
  const interval = INTERVAL[range] || "1d";
  let lastStatus = 0;

  for (let i = 0; i < 4; i++) {
    const host = HOSTS[i % HOSTS.length];
    try {
      const r = await fetch(
        `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`,
        { headers: F.HEADERS }
      );
      lastStatus = r.status;
      if (r.status === 429 || r.status >= 500) { await sleep(500 * (i + 1)); continue; }
      if (!r.ok) return res.status(502).json({ error: "Yahoo HTTP " + r.status, symbol: sym });

      const j = await r.json();
      const rr = j.chart && j.chart.result && j.chart.result[0];
      if (!rr) {
        const desc = j.chart && j.chart.error && j.chart.error.description;
        return res.status(404).json({ error: desc || "no data for symbol", symbol: sym });
      }
      const m = rr.meta || {};
      const ts = rr.timestamp || [];
      const cl = (rr.indicators && rr.indicators.quote && rr.indicators.quote[0] &&
        rr.indicators.quote[0].close) || [];
      const series = [];
      for (let k = 0; k < ts.length; k++) if (cl[k] != null) series.push({ t: ts[k], c: cl[k] });

      const lastC = series.length ? series[series.length - 1].c : null;
      const prevC = series.length > 1 ? series[series.length - 2].c : null;
      const price = m.regularMarketPrice != null ? m.regularMarketPrice : lastC;
      // Day change from the last two bars (correct on daily/intraday intervals);
      // meta.chartPreviousClose is range-relative so it would show the whole
      // range's move, not the day's.
      const daily = interval === "1d" || interval.endsWith("m");
      const prev = (daily && prevC != null) ? prevC
        : (m.previousClose != null ? m.previousClose : (m.chartPreviousClose != null ? m.chartPreviousClose : prevC));

      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
      return res.status(200).json({
        symbol: sym,
        name: m.longName || m.shortName || sym,
        currency: m.currency || "",
        exchange: m.fullExchangeName || m.exchangeName || "",
        price, prev,
        change: (price != null && prev != null) ? price - prev : null,
        changePct: (price != null && prev) ? (price - prev) / prev * 100 : null,
        dayHigh: m.regularMarketDayHigh != null ? m.regularMarketDayHigh : null,
        dayLow: m.regularMarketDayLow != null ? m.regularMarketDayLow : null,
        fiftyTwoHigh: m.fiftyTwoWeekHigh != null ? m.fiftyTwoWeekHigh : null,
        fiftyTwoLow: m.fiftyTwoWeekLow != null ? m.fiftyTwoWeekLow : null,
        marketCap: m.marketCap != null ? m.marketCap : null,
        range, series,
      });
    } catch (e) {
      await sleep(500 * (i + 1));
    }
  }
  res.status(503).json({ error: "Yahoo unavailable (rate-limited). Try again shortly.", symbol: sym, lastStatus });
};
