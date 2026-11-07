const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const FEEDBACK_FILE = process.env.FEEDBACK_FILE || path.join(__dirname, "data", "feedback.json");
const DATA_DIR = path.dirname(FEEDBACK_FILE);
const APPROVAL_THRESHOLD = 0.58;
const MAX_BODY_BYTES = 16_384;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const sigmoid = (value) => 1 / (1 + Math.exp(-value));

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function createSyntheticApplicants(count = 240) {
  const random = seededRandom(202603);
  return Array.from({ length: count }, (_, index) => {
    const monthlyIncome = Math.round(14_000 + random() * 46_000);
    const obligations = Math.round(monthlyIncome * (0.08 + random() * 0.48));
    const volatility = Number((0.08 + random() * 0.72).toFixed(2));
    const balance = Math.round(monthlyIncome * (random() * 1.5));
    const savingsMonths = Number((random() * 5).toFixed(1));
    const regularity = Number((0.3 + random() * 0.7).toFixed(2));
    const bouncedPayments = Math.floor(random() * 5);
    const requestedAmount = Math.round((5_000 + random() * 55_000) / 500) * 500;
    const gender = random() < 0.49 ? "Women" : "Men";
    const ageBand = random() < 0.47 ? "18–29" : random() < 0.5 ? "30–44" : "45+";
    const profile = {
      monthlyIncome,
      monthlyObligations: obligations,
      averageBalance: balance,
      incomeVolatility: volatility,
      savingsMonths,
      transactionRegularity: regularity,
      bouncedPayments,
      requestedAmount,
      gender,
      ageBand,
    };
    const latentScore = scoreFeatures(profile);
    const outcomeRandom = random();
    const repaidOnTime = outcomeRandom < clamp(latentScore.probability + 0.16, 0.08, 0.94) ? 1 : 0;
    return { id: index + 1, profile, repaidOnTime };
  });
}

function monthlyPayment(profile) {
  const monthlyRate = 0.24 / 12;
  const months = 12;
  return Math.round(
    (profile.requestedAmount * monthlyRate) / (1 - (1 + monthlyRate) ** -months),
  );
}

function scoreFeatures(profile) {
  const income = Math.max(1, profile.monthlyIncome);
  const disposable = Math.max(0, income - profile.monthlyObligations);
  const payment = monthlyPayment(profile);
  const paymentBurden = payment / Math.max(1, disposable);
  const stability = 1 - clamp(profile.incomeVolatility, 0, 1);
  const balanceBuffer = clamp(profile.averageBalance / (income * 0.35), 0, 1);
  const repaymentCapacity = clamp(1 - profile.monthlyObligations / income, 0, 1);
  const savings = clamp(profile.savingsMonths / 4, 0, 1);
  const regularity = clamp(profile.transactionRegularity, 0, 1);
  const affordability = 1 - clamp(paymentBurden, 0, 1);
  const bounces = clamp(profile.bouncedPayments / 4, 0, 1);
  return {
    probability: sigmoid(
      -1.65 +
        0.8 * stability +
        0.45 * balanceBuffer +
        0.85 * repaymentCapacity +
        0.3 * savings +
        0.4 * regularity +
        0.55 * affordability -
        0.45 * bounces,
    ),
    payment,
    paymentBurden,
    disposable,
    stability,
    balanceBuffer,
    repaymentCapacity,
    savings,
    regularity,
    affordability,
    bounces,
  };
}

function featureVector(profile) {
  const features = scoreFeatures(profile);
  return [
    1,
    features.stability,
    features.balanceBuffer,
    features.repaymentCapacity,
    features.savings,
    features.regularity,
    features.affordability,
    features.bounces,
  ];
}

function trainModel(rows, initialWeights) {
  const weights = initialWeights ? [...initialWeights] : [-1.65, 0.8, 0.45, 0.85, 0.3, 0.4, 0.55, -0.45];
  const epochs = 90;
  const learningRate = 0.055;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (const row of rows) {
      const vector = featureVector(row.profile);
      const predicted = sigmoid(vector.reduce((sum, value, i) => sum + value * weights[i], 0));
      const error = row.repaidOnTime - predicted;
      for (let i = 0; i < weights.length; i += 1) {
        weights[i] += learningRate * error * vector[i] / Math.max(1, rows.length / 30);
      }
    }
  }
  return weights;
}

const applicants = createSyntheticApplicants();
const syntheticWeights = trainModel(applicants);
let feedback = readFeedback();
let modelVersion = 1 + feedback.length;
let weights = trainModel([...applicants, ...feedback], syntheticWeights);

function readFeedback() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FEEDBACK_FILE, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error("Stored feedback must be a JSON array.");
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function predict(profile) {
  const vector = featureVector(profile);
  const features = scoreFeatures(profile);
  const probability = sigmoid(vector.reduce((sum, value, i) => sum + value * weights[i], 0));
  const approved = probability >= APPROVAL_THRESHOLD && features.paymentBurden <= 0.4;
  return { ...features, probability, approved };
}

function explain(profile, result) {
  const factors = [
    {
      label: "Income stability",
      value: `${Math.round((1 - profile.incomeVolatility) * 100)}%`,
      direction: profile.incomeVolatility <= 0.4 ? "positive" : "watch",
      detail: "How consistently income arrives month to month.",
    },
    {
      label: "Monthly cash cushion",
      value: `${Math.round((profile.averageBalance / Math.max(1, profile.monthlyIncome)) * 100)}%`,
      direction: profile.averageBalance >= profile.monthlyIncome * 0.2 ? "positive" : "watch",
      detail: "Average balance compared with one month of income.",
    },
    {
      label: "Existing obligations",
      value: `${Math.round((profile.monthlyObligations / Math.max(1, profile.monthlyIncome)) * 100)}%`,
      direction: profile.monthlyObligations / profile.monthlyIncome <= 0.35 ? "positive" : "watch",
      detail: "Monthly commitments relative to verified income.",
    },
    {
      label: "Payment history signals",
      value: `${profile.bouncedPayments} returned`,
      direction: profile.bouncedPayments === 0 ? "positive" : "watch",
      detail: "Returned payments observed in the synthetic history.",
    },
  ];
  const reasons = [];
  if (result.paymentBurden > 0.4) reasons.push("The estimated payment is high relative to disposable monthly income.");
  if (result.probability < APPROVAL_THRESHOLD) reasons.push("The cash-flow readiness score is below the demo threshold.");
  if (reasons.length === 0) reasons.push("Cash-flow readiness and estimated payment burden meet the demo criteria.");
  return { factors, reasons };
}

function generateCounterfactuals(profile) {
  const original = predict(profile);
  if (original.approved) return [];

  const candidates = [];
  const attempts = [
    {
      key: "monthlyIncome",
      steps: 80,
      stepSize: 250,
      change: (candidate, step, size) => { candidate.monthlyIncome += step * size; },
      label: (amount) => `Document about $${amount.toLocaleString()} more monthly income`,
    },
    {
      key: "monthlyObligations",
      steps: 80,
      stepSize: 100,
      change: (candidate, step, size) => { candidate.monthlyObligations = Math.max(0, candidate.monthlyObligations - step * size); },
      label: (amount) => `Reduce monthly obligations by about $${amount.toLocaleString()}`,
    },
    {
      key: "averageBalance",
      steps: 80,
      stepSize: 250,
      change: (candidate, step, size) => { candidate.averageBalance += step * size; },
      label: (amount) => `Build an average balance about $${amount.toLocaleString()} higher`,
    },
    {
      key: "incomeVolatility",
      steps: 28,
      stepSize: 0.02,
      change: (candidate, step, size) => { candidate.incomeVolatility = Math.max(0, candidate.incomeVolatility - step * size); },
      label: (amount) => `Show income variation about ${Math.round(amount * 100)} percentage points lower`,
    },
    {
      key: "transactionRegularity",
      steps: 28,
      stepSize: 0.02,
      change: (candidate, step, size) => { candidate.transactionRegularity = Math.min(1, candidate.transactionRegularity + step * size); },
      label: (amount) => `Build transaction regularity about ${Math.round(amount * 100)} points higher`,
    },
    {
      key: "requestedAmount",
      steps: 80,
      stepSize: 250,
      change: (candidate, step, size) => { candidate.requestedAmount = Math.max(1_000, candidate.requestedAmount - step * size); },
      label: (amount) => `Request about $${amount.toLocaleString()} less`,
    },
  ];

  for (const attempt of attempts) {
    for (let step = 1; step <= attempt.steps; step += 1) {
      const candidate = { ...profile };
      attempt.change(candidate, step, attempt.stepSize);
      const result = predict(candidate);
      if (result.approved) {
        const changeAmount = step * attempt.stepSize;
        const effort = changeAmount / Math.max(1, profile[attempt.key]);
        candidates.push({
          action: attempt.label(changeAmount),
          score: Math.round(result.probability * 100),
          effort,
        });
        break;
      }
    }
  }
  return candidates
    .sort((a, b) => a.effort - b.effort)
    .slice(0, 3)
    .map(({ action, score }) => ({ action, score }));
}

function getOverview() {
  const scored = applicants.map((row) => ({
    ...row,
    result: predict(row.profile),
  }));
  const approvals = scored.filter((row) => row.result.approved).length;
  const expectedLoss = scored.reduce(
    (sum, row) => sum + (1 - row.result.probability) * row.profile.requestedAmount * 0.12,
    0,
  );
  const avgRisk = scored.reduce((sum, row) => sum + 1 - row.result.probability, 0) / scored.length;
  const groups = [...new Set(scored.map((row) => row.profile.gender))].sort().map((group) => {
    const rows = scored.filter((row) => row.profile.gender === group);
    return {
      group,
      count: rows.length,
      approvalRate: rows.filter((row) => row.result.approved).length / rows.length,
      avgScore: rows.reduce((sum, row) => sum + row.result.probability, 0) / rows.length,
    };
  });
  const ageGroups = [...new Set(scored.map((row) => row.profile.ageBand))].sort().map((group) => {
    const rows = scored.filter((row) => row.profile.ageBand === group);
    return {
      group,
      count: rows.length,
      approvalRate: rows.filter((row) => row.result.approved).length / rows.length,
    };
  });
  const accuracy = scored.filter((row) => row.result.approved === Boolean(row.repaidOnTime)).length / scored.length;
  return {
    applicants: scored.length,
    approvals,
    approvalRate: approvals / scored.length,
    averageRisk: avgRisk,
    expectedLoss,
    accuracy,
    feedbackCount: feedback.length,
    modelVersion,
    threshold: APPROVAL_THRESHOLD,
    fairness: { groups, ageGroups },
    repayment: [
      { month: "Jun", onTime: 87, late: 9, default: 4 },
      { month: "Jul", onTime: 89, late: 8, default: 3 },
      { month: "Aug", onTime: 88, late: 9, default: 3 },
      { month: "Sep", onTime: 91, late: 6, default: 3 },
      { month: "Oct", onTime: 90, late: 7, default: 3 },
      { month: "Nov", onTime: Math.round((1 - avgRisk) * 100), late: Math.round(avgRisk * 65), default: Math.round(avgRisk * 35) },
    ],
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function validateProfile(input) {
  const numericFields = [
    "monthlyIncome",
    "monthlyObligations",
    "averageBalance",
    "incomeVolatility",
    "savingsMonths",
    "transactionRegularity",
    "bouncedPayments",
    "requestedAmount",
  ];
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Provide a profile object.";
  for (const field of numericFields) {
    if (typeof input[field] !== "number" || !Number.isFinite(input[field])) {
      return `${field} must be a finite number.`;
    }
  }
  if (input.monthlyIncome <= 0 || input.requestedAmount <= 0) return "Income and requested amount must be positive.";
  if (input.monthlyObligations < 0 || input.averageBalance < 0 || input.savingsMonths < 0) {
    return "Obligations, balance, and savings history cannot be negative.";
  }
  if (input.incomeVolatility < 0 || input.incomeVolatility > 1 || input.transactionRegularity < 0 || input.transactionRegularity > 1) {
    return "Volatility and transaction regularity must be between 0 and 1.";
  }
  if (!Number.isInteger(input.bouncedPayments) || input.bouncedPayments < 0 || input.bouncedPayments > 20) {
    return "Returned payment count must be a whole number between 0 and 20.";
  }
  return null;
}

function createServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { status: "ok", syntheticOnly: true });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/overview") {
        sendJson(response, 200, getOverview());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/decision") {
        const body = await readRequestBody(request);
        const validationError = validateProfile(body.profile);
        if (validationError) {
          sendJson(response, 400, { error: validationError });
          return;
        }
        const result = predict(body.profile);
        sendJson(response, 200, {
          ...result,
          explanation: explain(body.profile, result),
          counterfactuals: generateCounterfactuals(body.profile),
          demoOnly: true,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/feedback") {
        const body = await readRequestBody(request);
        const validationError = validateProfile(body.profile);
        if (validationError) {
          sendJson(response, 400, { error: validationError });
          return;
        }
        if (!["on-time", "late", "default"].includes(body.outcome)) {
          sendJson(response, 400, { error: "Outcome must be on-time, late, or default." });
          return;
        }
        const feedbackRow = {
          profile: Object.fromEntries(
            Object.entries(body.profile).filter(([key]) => key !== "gender" && key !== "ageBand"),
          ),
          repaidOnTime: body.outcome === "on-time" ? 1 : 0,
          outcome: body.outcome,
          createdAt: new Date().toISOString(),
        };
        feedback = [...feedback, feedbackRow];
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(FEEDBACK_FILE, `${JSON.stringify(feedback, null, 2)}\n`, { flag: "w" });
        weights = trainModel([...applicants, ...feedback], weights);
        modelVersion += 1;
        sendJson(response, 201, { saved: true, modelVersion, feedbackCount: feedback.length });
        return;
      }
      if (request.method === "GET") {
        const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
        const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
        if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
          response.writeHead(403);
          response.end("Forbidden");
          return;
        }
        fs.readFile(filePath, (error, contents) => {
          if (error) {
            response.writeHead(404);
            response.end("Not found");
            return;
          }
          const extension = path.extname(filePath);
          const contentType = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
          }[extension] || "application/octet-stream";
          response.writeHead(200, { "Content-Type": contentType });
          response.end(contents);
        });
        return;
      }
      sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, error.status || 500, { error: error.status ? error.message : "The request could not be completed." });
      }
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`Explainable Credit Underwriting is running at http://localhost:${PORT}`);
    console.log("Demo only: synthetic data; never use for real lending decisions.");
  });
}

module.exports = {
  APPROVAL_THRESHOLD,
  createServer,
  generateCounterfactuals,
  getOverview,
  predict,
  scoreFeatures,
  validateProfile,
};
