const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  findColumn,
  monthlyPayment,
  parseAmount,
  reviewRecord,
  summarizeGroups,
} = require("../public/analysis");

const row = {
  "case_ref": "case-001",
  "net_monthly_income": "4,000",
  "existing_monthly_payments": "1,000",
  "loan_amount": "10,000",
  "apr": 12,
  "term_months": 12,
};
const columns = {
  applicant: "case_ref",
  income: "net_monthly_income",
  obligations: "existing_monthly_payments",
  amount: "loan_amount",
  rate: "apr",
  term: "term_months",
};

describe("local cash-flow calculations", () => {
  it("maps common spreadsheet headings without inventing fields", () => {
    assert.equal(findColumn(["case_ref", "net_monthly_income"], "income"), "net_monthly_income");
    assert.equal(findColumn(["monthly_income", "loan_amount"], "amount"), "loan_amount");
    assert.equal(findColumn(["loan_balance"], "balance"), "");
  });

  it("parses common currency-formatted numeric cells and rejects ambiguous text", () => {
    assert.equal(parseAmount("₹ 1,23,456.50"), 123456.5);
    assert.equal(parseAmount("(250.75)"), -250.75);
    assert.equal(parseAmount("not supplied"), null);
    assert.equal(parseAmount(""), null);
  });

  it("calculates installments from the provided product terms", () => {
    assert.equal(monthlyPayment(12000, 0, 12), 1000);
    assert.ok(Math.abs(monthlyPayment(10000, 12, 12) - 888.4879) < 0.01);
    assert.equal(monthlyPayment(10000, 12, 0), null);
  });

  it("does not classify a row against a policy when no ceiling is supplied", () => {
    const result = reviewRecord(row, columns);
    assert.equal(result.status, "Set a review ceiling");
    assert.equal(result.disposable, 3000);
    assert.ok(result.payment > 0);
    assert.equal(result.scenarios.length, 0);
  });

  it("uses a supplied ceiling only as a review signal and explains what-if arithmetic", () => {
    const result = reviewRecord(row, columns, { ceiling: 20 });
    assert.equal(result.status, "Above review ceiling");
    assert.equal(result.issues.some((issue) => issue.includes("configured ceiling is 20%")), true);
    assert.equal(result.scenarios.length, 2);
    assert.match(result.scenarios[0], /Scenario only/);
  });

  it("flags missing required values instead of generating a score", () => {
    const result = reviewRecord({ ...row, loan_amount: "" }, columns);
    assert.equal(result.status, "Incomplete row");
    assert.equal(result.payment, null);
    assert.ok(result.issues.some((issue) => issue.includes("Requested amount")));
  });

  it("summarizes only recognizable historical outcomes by selected cohort", () => {
    const groups = summarizeGroups([
      { decision: "Approved", cohort: "Group A" },
      { decision: "declined", cohort: "Group A" },
      { decision: "funded", cohort: "Group B" },
      { decision: "pending", cohort: "Group B" },
      { decision: "approved", cohort: "" },
    ], "decision", "cohort");
    assert.deepEqual(groups, [
      { group: "Group A", total: 2, approved: 1, rate: 0.5 },
      { group: "Group B", total: 1, approved: 1, rate: 1 },
    ]);
  });
});
