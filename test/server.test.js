const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");
const assert = require("node:assert/strict");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clearpath-test-"));
process.env.FEEDBACK_FILE = path.join(tempDir, "feedback.json");
const { createServer, generateCounterfactuals, getOverview, predict } = require("../server");

const profile = {
  monthlyIncome: 2_000,
  monthlyObligations: 1_200,
  averageBalance: 100,
  incomeVolatility: 0.65,
  savingsMonths: 0.1,
  transactionRegularity: 0.4,
  bouncedPayments: 2,
  requestedAmount: 25_000,
};

let server;
let baseUrl;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Clearpath demo API", () => {
  it("serves a synthetic-only health check and seeded portfolio", async () => {
    const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
    const overview = await fetch(`${baseUrl}/api/overview`).then((response) => response.json());
    assert.deepEqual(health, { status: "ok", syntheticOnly: true });
    assert.equal(overview.applicants, 240);
    assert.equal(overview.feedbackCount, 0);
    assert.equal(overview.fairness.groups.length, 2);
    assert.equal(overview.fairness.ageGroups.length, 3);
  });

  it("returns an explainable score and concrete what-if actions for a rejected profile", async () => {
    const result = await fetch(`${baseUrl}/api/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile }),
    }).then((response) => response.json());
    assert.equal(result.approved, false);
    assert.equal(result.demoOnly, true);
    assert.ok(result.explanation.factors.length >= 4);
    assert.ok(result.counterfactuals.length > 0);
    assert.ok(result.counterfactuals.every((item) => item.action && item.score >= 58));
  });

  it("rejects malformed or out-of-range profiles", async () => {
    const invalid = await fetch(`${baseUrl}/api/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { ...profile, incomeVolatility: 1.2 } }),
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /between 0 and 1/);
  });

  it("adds a repayment outcome and retrains the model", async () => {
    const beforeVersion = getOverview().modelVersion;
    const response = await fetch(`${baseUrl}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, outcome: "on-time" }),
    });
    const saved = await response.json();
    assert.equal(response.status, 201);
    assert.equal(saved.modelVersion, beforeVersion + 1);
    assert.equal(getOverview().feedbackCount, 1);
    assert.equal(predict(profile).probability >= 0, true);
    assert.equal(JSON.parse(fs.readFileSync(process.env.FEEDBACK_FILE, "utf8")).length, 1);
  });

  it("finds at least one path to the illustrative threshold", () => {
    const actions = generateCounterfactuals(profile);
    assert.ok(actions.length > 0);
    assert.ok(actions[0].action.length > 0);
    assert.ok(actions[0].score >= 58);
  });
});
