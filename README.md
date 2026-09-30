# Billionaires Live — Wealth Dashboard

A live Forbes billionaires dashboard. **No Google Apps Script, no daily fetch quota.**
Vercel serverless functions pull Forbes on the server and **edge-cache** the result,
so Forbes is hit at most ~once every 3 minutes no matter how many people view it.

## What it shows
- **Full ranked list** of every billionaire, ranked by **live net worth** (not the frozen annual rank).
- Live 24h change (color-coded), industry, source, age, gender, country, city, self-made score, philanthropy.
- **Search + filters** (industry, country, self-made vs inherited), click-to-sort every column, **CSV export**.
- **Drill-down** on any person: wealth-history chart + **public-company holdings** (ticker, shares, price,
  stake value, % of net worth) — the "trading view".

## Structure
```
forbes-dashboard/
  index.html        # the dashboard (static, vanilla JS)
  api/
    _forbes.js      # shared helpers (not a route — the _ prefix hides it)
    data.js         # GET /api/data     -> full ranked list (cached 3 min)
    person.js       # GET /api/person?uri=... -> one person's holdings + history
  vercel.json
  package.json
```

## Run locally (optional)
```bash
npm i -g vercel
cd forbes-dashboard
vercel dev
```
Open http://localhost:3000

## Deploy to Vercel via your MAHENDER-Dev GitHub

1. Create an empty repo under the **MAHENDER-Dev** account, e.g. `billionaires-dashboard`.
2. From this folder:
   ```bash
   cd forbes-dashboard
   git init
   git add .
   git commit -m "Live billionaires dashboard"
   git branch -M main
   git remote add origin https://github.com/MAHENDER-Dev/billionaires-dashboard.git
   git push -u origin main
   ```
3. In Vercel → **Add New Project** → import that GitHub repo → **Deploy**.
   No env vars, no build settings needed (Vercel auto-detects static + `api/`).
4. You get a live URL like `https://billionaires-dashboard.vercel.app`.

## Notes
- If `/api/data` ever returns an HTTP error, Forbes is rate-limiting the *server* IP
  momentarily — just hit **Refresh**; the cache smooths this out.
- Everything is served from cache between refreshes, so it stays fast and cheap.
