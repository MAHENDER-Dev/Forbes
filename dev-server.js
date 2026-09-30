// Local-only dev server to preview the dashboard (NOT deployed; gitignored).
// Serves index.html and runs the /api handlers via the same code Vercel uses.
const http = require("http");
const fs = require("fs");
const path = require("path");

const data = require("./api/data.js");
const person = require("./api/person.js");
const quote = require("./api/quote.js");

function mkRes(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
  return res;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  mkRes(res);
  req.query = Object.fromEntries(u.searchParams);
  try {
    if (u.pathname === "/api/data") return await data(req, res);
    if (u.pathname === "/api/person") return await person(req, res);
    if (u.pathname === "/api/quote") return await quote(req, res);
    if (u.pathname === "/" || u.pathname === "/index.html") {
      res.setHeader("Content-Type", "text/html");
      return void res.end(fs.readFileSync(path.join(__dirname, "index.html")));
    }
    res.statusCode = 404; res.end("not found");
  } catch (e) {
    // Never let an async error crash the process (Node exits on unhandled rejection).
    try { res.statusCode = 500; res.json({ error: String((e && e.message) || e) }); } catch (_) {}
  }
});

process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e && e.message));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e && e.message));

const PORT = process.env.PORT || 4700;
server.listen(PORT, () => console.log("Dashboard dev server on http://localhost:" + PORT));
