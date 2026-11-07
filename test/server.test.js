const { after, before, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../server");

let server;
let baseUrl;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("local-only web server", () => {
  it("serves the spreadsheet workspace and local Excel parser", async () => {
    const page = await fetch(`${baseUrl}/`).then((response) => response.text());
    const parser = await fetch(`${baseUrl}/vendor/read-excel-file.min.js`).then((response) => response.text());
    assert.match(page, /Your spreadsheet is read in this browser/);
    assert.match(page, /read-excel-file\.min\.js/);
    assert.match(parser, /readXlsxFile/);
  });

  it("does not accept uploaded files or expose decision APIs", async () => {
    const post = await fetch(`${baseUrl}/`, { method: "POST" });
    const api = await fetch(`${baseUrl}/api/decision`);
    assert.equal(post.status, 405);
    assert.equal(api.status, 404);
  });

  it("sets browser security headers", async () => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-security-policy"), /connect-src 'self'/);
  });
});
