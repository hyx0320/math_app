/*
  Minimal static server for the Web Demo (no dependencies).

  Usage:
    node server.js           # default port 5173
    node server.js 5173      # specify port
    node server.js --port 5173
*/

const http = require("http");
const fs = require("fs");
const path = require("path");

function parsePort(argv) {
  const def = 5173;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" && argv[i + 1]) {
      const p = Number(argv[i + 1]);
      if (Number.isFinite(p) && p > 0) return p;
    }
    if (/^\d+$/.test(a)) {
      const p = Number(a);
      if (Number.isFinite(p) && p > 0) return p;
    }
  }
  return def;
}

const port = parsePort(process.argv.slice(2));
const root = __dirname;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf"
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const cleaned = decoded.replace(/\\/g, "/");
  const withIndex = cleaned.endsWith("/") ? cleaned + "index.html" : cleaned;
  const abs = path.resolve(root, "." + withIndex);
  if (!abs.startsWith(root)) return null;
  return abs;
}

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }

  const file = safePath(req.url);
  if (!file) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    const ext = path.extname(file).toLowerCase();
    const type = mime[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });

    const rs = fs.createReadStream(file);
    rs.on("error", () => {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal Server Error");
    });
    rs.pipe(res);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[web-demo] Static server running: http://localhost:${port}`);
  console.log(`[web-demo] Root: ${root}`);
});
