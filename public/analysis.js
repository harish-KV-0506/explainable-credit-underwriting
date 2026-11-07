(function exposeAnalysis(root, factory) {
  const analysis = factory();
  if (typeof module === "object" && module.exports) module.exports = analysis;
  if (root) root.ClearpathAnalysis = analysis;
})(typeof globalThis === "undefined" ? this : globalThis, function createAnalysis() {
  const aliases = {
    applicant: ["applicant", "applicant id", "borrower", "borrower id", "customer id", "case id", "reference", "id"],
    income: ["monthly income", "income", "monthly net income", "net monthly income", "verified monthly income", "monthly cash inflow"],
    obligations: ["monthly obligations", "obligations", "monthly debt", "monthly debt payments", "existing monthly payments", "monthly expenses", "monthly commitments"],
    amount: ["requested amount", "loan amount", "amount requested", "principal", "requested principal"],
    balance: ["average balance", "average monthly balance", "monthly average balance", "account balance"],
    rate: ["annual interest rate", "annual rate", "apr", "interest rate", "rate percent"],
    term: ["term months", "loan term months", "tenure months", "term", "tenure"],
    decision: ["decision", "historical decision", "application decision", "decision outcome", "approval status", "status"],
    cohort: ["group", "cohort", "gender", "age group", "demographic group", "audit group"],
  };

  function normalizeHeader(value) {
    return String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  }

  function findColumn(headers, field) {
    const candidates = aliases[field] || [];
    return headers.find((header) => candidates.includes(normalizeHeader(header))) || "";
  }

  function parseAmount(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || !value.trim()) return null;
    let text = value.trim().replace(/[\s,$£€₹¥]/g, "").replace(/^\((.*)\)$/, "-$1");
    if (text.endsWith("%")) text = text.slice(0, -1);
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return null;
    const result = Number(text);
    return Number.isFinite(result) ? result : null;
  }

  function money(value) {
    if (!Number.isFinite(value)) return "—";
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  }

  function monthlyPayment(principal, annualRatePercent, termMonths) {
    if (!(Number.isFinite(principal) && principal >= 0 &&
      Number.isFinite(annualRatePercent) && annualRatePercent >= 0 &&
      Number.isInteger(termMonths) && termMonths > 0)) return null;
    if (principal === 0) return 0;
    const monthlyRate = annualRatePercent / 1200;
    if (monthlyRate === 0) return principal / termMonths;
    return principal * monthlyRate / (1 - (1 + monthlyRate) ** -termMonths);
  }

  function mapRecord(row, columns) {
    const value = (field) => columns[field] ? row[columns[field]] : null;
    return {
      applicant: value("applicant"),
      income: parseAmount(value("income")),
      obligations: parseAmount(value("obligations")),
      amount: parseAmount(value("amount")),
      balance: parseAmount(value("balance")),
      rate: parseAmount(value("rate")),
      term: parseAmount(value("term")),
    };
  }

  function reviewRecord(row, columns, options = {}) {
    const values = mapRecord(row, columns);
    const issues = [];
    if (!(values.income > 0)) issues.push("Monthly income is missing or must be greater than zero.");
    if (!(values.obligations >= 0)) issues.push("Monthly obligations are missing or invalid.");
    if (!(values.amount > 0)) issues.push("Requested amount is missing or must be greater than zero.");
    const disposable = values.income !== null && values.obligations !== null
      ? values.income - values.obligations
      : null;

    const rate = values.rate ?? parseAmount(options.rate);
    const termValue = values.term ?? parseAmount(options.term);
    const term = Number.isInteger(termValue) ? termValue : null;
    const productValid = Number.isFinite(rate) && rate >= 0 && rate <= 100 &&
      Number.isInteger(term) && term >= 1 && term <= 360;
    if (Number.isFinite(rate) && (rate < 0 || rate > 100)) issues.push("Annual rate must be between 0 and 100%.");
    if (termValue !== null && (!Number.isInteger(termValue) || termValue < 1 || termValue > 360)) {
      issues.push("Term must be a whole number between 1 and 360 months.");
    }

    const payment = productValid && values.amount > 0
      ? monthlyPayment(values.amount, rate, term)
      : null;
    const burden = Number.isFinite(payment) && disposable > 0 ? payment / disposable : null;
    const ceiling = parseAmount(options.ceiling);
    const ceilingRatio = Number.isFinite(ceiling) && ceiling > 0 && ceiling <= 100
      ? ceiling / 100
      : null;
    let status = "Product terms missing";
    if (issues.some((issue) => issue.includes("missing") || issue.includes("invalid") || issue.includes("greater than zero"))) {
      status = "Incomplete row";
    } else if (disposable <= 0) {
      status = "No monthly surplus";
      issues.push("Mapped obligations equal or exceed monthly income.");
    } else if (payment !== null && ceilingRatio === null) {
      status = "Set a review ceiling";
    } else if (payment !== null && ceilingRatio !== null) {
      status = burden <= ceilingRatio ? "Within review ceiling" : "Above review ceiling";
    }

    if (!productValid && status !== "Incomplete row" && status !== "No monthly surplus") {
      issues.push("Provide a valid APR and term in the sheet or product assumptions.");
    }
    if (payment !== null && ceilingRatio !== null && burden > ceilingRatio) {
      issues.push(`Estimated installment uses ${money(burden * 100)}% of remaining monthly cash; the configured ceiling is ${money(ceiling)}%.`);
    }
    if (payment !== null && ceilingRatio === null) {
      issues.push("No payment-capacity ceiling is set. This row is not classified against a lending policy.");
    }

    const scenarios = [];
    if (payment !== null && ceilingRatio !== null && disposable > 0 && burden > ceilingRatio) {
      const affordablePayment = disposable * ceilingRatio;
      const monthlyRate = rate / 1200;
      const principalCapacity = monthlyRate === 0
        ? affordablePayment * term
        : affordablePayment * (1 - (1 + monthlyRate) ** -term) / monthlyRate;
      if (principalCapacity > 0 && values.amount > principalCapacity) {
        scenarios.push(`Scenario only: request about ${money(values.amount - principalCapacity)} less to fit the selected payment ceiling.`);
      }
      const additionalMonthlyCash = payment / ceilingRatio - disposable;
      if (additionalMonthlyCash > 0) {
        scenarios.push(`Scenario only: about ${money(additionalMonthlyCash)} more monthly net income, or the same reduction in obligations, would reach that ceiling.`);
      }
    }

    return {
      values,
      disposable,
      payment,
      burden,
      status,
      issues,
      scenarios,
      rate: productValid ? rate : null,
      term: productValid ? term : null,
    };
  }

  function historicalDecision(value) {
    const label = normalizeHeader(value);
    if (["approved", "approve", "accepted", "accept", "funded", "yes", "1"].includes(label)) return "approved";
    if (["declined", "decline", "rejected", "reject", "denied", "no", "0"].includes(label)) return "declined";
    return null;
  }

  function summarizeGroups(rows, decisionColumn, cohortColumn) {
    const groups = new Map();
    for (const row of rows) {
      const outcome = historicalDecision(row[decisionColumn]);
      const group = String(row[cohortColumn] ?? "").trim();
      if (!outcome || !group) continue;
      const summary = groups.get(group) || { group, total: 0, approved: 0 };
      summary.total += 1;
      if (outcome === "approved") summary.approved += 1;
      groups.set(group, summary);
    }
    return [...groups.values()]
      .map((group) => ({ ...group, rate: group.approved / group.total }))
      .sort((a, b) => a.group.localeCompare(b.group));
  }

  return { findColumn, historicalDecision, mapRecord, money, monthlyPayment, normalizeHeader, parseAmount, reviewRecord, summarizeGroups };
});
