const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function createServer() {
  return http.createServer((request, response) => {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }

    const pathname = new URL(request.url, `http://${request.headers.host || HOST}`).pathname;
    const target = path.resolve(PUBLIC_DIR, `.${pathname === "/" ? "/index.html" : pathname}`);
    const isPublicFile = target.startsWith(`${PUBLIC_DIR}${path.sep}`);
    if (!isPublicFile) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    fs.readFile(target, (error, contents) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500);
        response.end(error.code === "ENOENT" ? "Not found" : "Unable to read requested asset");
        return;
      }
      response.writeHead(200, {
        "Content-Type": TYPES[path.extname(target)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "Cache-Control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : contents);
    });
  });
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`Clearpath local spreadsheet workspace: http://${HOST}:${PORT}`);
    console.log("Spreadsheet contents are processed in the browser; this server has no data upload API.");
  });
}

module.exports = { createServer };
