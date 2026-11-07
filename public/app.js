const pages = ["overview", "decision", "feedback", "fairness"];
const pageTitles = {
  overview: "Overview",
  decision: "Decision studio",
  feedback: "Feedback loop",
  fairness: "Fairness audit",
};

let latestProfile = null;
let latestOutcome = null;
let overviewData = null;

const money = (value) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
}).format(value);

const percent = (value) => `${Math.round(value * 100)}%`;

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function setView(name) {
  if (!pages.includes(name)) return;
  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `view-${name}`);
  });
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  document.querySelector("#current-crumb").textContent = pageTitles[name];
  if (name === "fairness" && overviewData) renderFairness(overviewData);
  if (name === "feedback" && overviewData) renderFeedback(overviewData);
}

function renderPerformance(rows) {
  const chart = document.querySelector("#performance-chart");
  const width = 620;
  const height = 142;
  const left = 31;
  const right = 10;
  const top = 7;
  const bottom = 8;
  const plotHeight = height - top - bottom;
  const plotWidth = width - left - right;
  const groupWidth = plotWidth / rows.length;
  const barWidth = 28;
  const yLabels = [100, 75, 50, 25, 0];
  const grid = yLabels.map((label) => {
    const y = top + (100 - label) / 100 * plotHeight;
    return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#edf0ed" stroke-dasharray="3 4"/><text x="0" y="${y + 3}" fill="#a4aaa6" font-size="8">${label}%</text>`;
  }).join("");
  const bars = rows.map((row, index) => {
    const x = left + groupWidth * index + (groupWidth - barWidth) / 2;
    let y = top + plotHeight;
    return [["onTime", "#42b49e"], ["late", "#efb44e"], ["default", "#ed8278"]].map(([key, color]) => {
      const barHeight = row[key] / 100 * plotHeight;
      y -= barHeight;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="2" fill="${color}"><title>${row.month}: ${row[key]}% ${key === "onTime" ? "on time" : key}</title></rect>`;
    }).join("");
  }).join("");
  chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly repayment outcome percentages">${grid}${bars}</svg>`;
}

function renderFairnessPreview(data) {
  const root = document.querySelector("#fairness-preview");
  root.innerHTML = data.fairness.groups.map((group) => `
    <div>
      <div class="mini-group-heading"><span>${group.group}</span><strong>${percent(group.approvalRate)}</strong></div>
      <div class="mini-track"><span style="width:${Math.max(3, group.approvalRate * 100)}%"></span></div>
    </div>
  `).join("");
}

function renderAuditGroups(selector, groups) {
  const root = document.querySelector(selector);
  const max = Math.max(...groups.map((group) => group.approvalRate), 0.01);
  root.innerHTML = groups.map((group) => `
    <div class="audit-group">
      <span class="audit-group-name">${group.group}</span>
      <div class="audit-track"><span style="width:${Math.max(2, group.approvalRate * 100)}%"></span></div>
      <strong class="audit-rate">${percent(group.approvalRate)}</strong>
      <span class="audit-count">${group.count} profiles</span>
    </div>
  `).join("");
  return max;
}

function renderFairness(data) {
  const genderRates = data.fairness.groups.map((group) => group.approvalRate);
  const highest = Math.max(...genderRates);
  const lowest = Math.min(...genderRates);
  const gap = (highest - lowest) * 100;
  document.querySelector("#fairness-gap").textContent = `${gap.toFixed(1)} pp`;
  document.querySelector("#parity-ratio").textContent = `${Math.round((highest > 0 ? lowest / highest : 1) * 100)}%`;
  document.querySelector("#audited-count").textContent = data.applicants.toLocaleString();
  renderAuditGroups("#gender-audit", data.fairness.groups);
  renderAuditGroups("#age-audit", data.fairness.ageGroups);
}

function renderFeedback(data) {
  document.querySelector("#feedback-model-badge").textContent = `MODEL v${data.modelVersion}`;
  document.querySelector("#feedback-activity-count").textContent =
    `${data.feedbackCount} ${data.feedbackCount === 1 ? "outcome" : "outcomes"}`;
  if (latestOutcome) {
    const ago = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(latestOutcome.createdAt));
    document.querySelector("#feedback-activity").innerHTML = `
      <span class="activity-check">✓</span>
      <div><strong>Model updated to v${data.modelVersion}</strong>
      <p>One ${latestOutcome.outcome} repayment outcome was added at ${ago}. ${data.feedbackCount} demo outcome${data.feedbackCount === 1 ? "" : "s"} recorded.</p></div>`;
  } else if (data.feedbackCount > 0) {
    document.querySelector("#feedback-activity").innerHTML = `
      <span class="activity-check">✓</span>
      <div><strong>${data.feedbackCount} repayment outcomes in the loop</strong>
      <p>The local model is trained on the generated portfolio and recorded demo outcomes.</p></div>`;
  }
}

function renderOverview(data) {
  overviewData = data;
  document.querySelector("#stat-applicants").textContent = data.applicants.toLocaleString();
  document.querySelector("#stat-approval").textContent = percent(data.approvalRate);
  document.querySelector("#stat-loss").textContent = money(data.expectedLoss);
  document.querySelector("#stat-accuracy").textContent = percent(data.accuracy);
  document.querySelector("#stat-threshold").textContent = percent(data.threshold);
  document.querySelector("#stat-model-version").textContent = `Model v${data.modelVersion} · ${data.feedbackCount} feedback`;
  document.querySelector("#average-risk").textContent = percent(data.averageRisk);
  document.querySelector("#risk-meter-fill").style.left = `${Math.min(96, data.averageRisk * 100)}%`;
  document.querySelector("#approved-count").textContent = data.approvals.toLocaleString();
  document.querySelector("#feedback-count").textContent = data.feedbackCount.toLocaleString();
  renderPerformance(data.repayment);
  renderFairnessPreview(data);
  renderFairness(data);
  renderFeedback(data);
}

function collectProfile() {
  const form = document.querySelector("#decision-form");
  const data = new FormData(form);
  return {
    monthlyIncome: Number(data.get("monthlyIncome")),
    monthlyObligations: Number(data.get("monthlyObligations")),
    averageBalance: Number(data.get("averageBalance")),
    requestedAmount: Number(data.get("requestedAmount")),
    incomeVolatility: Number(data.get("incomeVolatility")),
    transactionRegularity: Number(data.get("transactionRegularity")),
    savingsMonths: Number(data.get("savingsMonths")),
    bouncedPayments: Number(data.get("bouncedPayments")),
    gender: "Women",
    ageBand: "30–44",
  };
}

function renderDecision(result) {
  const root = document.querySelector("#decision-results");
  const score = Math.round(result.probability * 100);
  const statusClass = result.approved ? "" : "rejected";
  const circumference = 2 * Math.PI * 42;
  const dash = circumference * result.probability;
  const factors = result.explanation.factors.map((factor) => `
    <div class="factor-row">
      <span class="factor-name">${factor.label}</span>
      <span class="factor-value">${factor.value}</span>
      <span class="factor-direction ${factor.direction === "watch" ? "watch" : ""}">${factor.direction === "watch" ? "Needs attention" : "Supportive"}</span>
    </div>
  `).join("");
  const reasons = result.explanation.reasons.map((reason) => `<div class="reason"><i>!</i><span>${reason}</span></div>`).join("");
  const actions = result.counterfactuals.length
    ? result.counterfactuals.map((item, index) => `<div class="action-item"><span>${index + 1}</span><div>${item.action}<br><strong>What-if score: ${item.score}%</strong></div></div>`).join("")
    : `<div class="no-actions">No single change in the modeled range reaches the demo criteria. Consider a smaller request or a qualified human review. The score is not a promise of approval.</div>`;
  root.innerHTML = `
    <div class="decision-status"><span class="decision-status-label ${statusClass}"><span></span>${result.approved ? "MEETS DEMO CRITERIA" : "DOES NOT MEET DEMO CRITERIA"}</span><span class="model-badge">MODEL v${overviewData?.modelVersion || 1}</span></div>
    <article class="panel decision-score-card">
      <div class="score-ring ${statusClass}">
        <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="42"></circle><circle class="progress" cx="50" cy="50" r="42" stroke-dasharray="${dash} ${circumference}"></circle></svg>
        <div class="score-ring-inner"><strong>${score}</strong><small>READINESS</small></div>
      </div>
      <div class="decision-score-copy"><span class="score-kicker">ESTIMATED REPAYMENT READINESS</span><h2>${result.approved ? "Cash flow looks steady." : "There may be a path forward."}</h2><p>${result.approved ? "This synthetic profile meets the illustrative score and payment-burden criteria." : "See which measurable cash-flow changes could meet the demo criteria."}</p></div>
    </article>
    <div class="decision-meta">
      <div class="panel meta-box"><span>Estimated monthly payment</span><strong>${money(result.payment)}</strong></div>
      <div class="panel meta-box"><span>Payment / disposable income</span><strong>${percent(result.paymentBurden)}</strong></div>
    </div>
    <article class="panel explanation-panel"><h3>Why this result</h3><div class="reason-list">${reasons}</div><div class="factor-list">${factors}</div></article>
    <article class="panel counterfactual-panel"><h3>How to qualify · what-if actions</h3><p>Illustrative single-variable scenarios, not a guarantee or instruction to take on debt.</p><div class="action-list">${actions}</div></article>
  `;
}

async function loadOverview() {
  try {
    renderOverview(await api("/api/overview"));
  } catch (error) {
    showToast(`Could not load portfolio: ${error.message}`);
  }
}

document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});
document.querySelectorAll("[data-open-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.openView));
});
document.querySelector("#refresh-button").addEventListener("click", loadOverview);

document.querySelector("#decision-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorNode = document.querySelector("#decision-error");
  const button = event.currentTarget.querySelector('button[type="submit"]');
  errorNode.textContent = "";
  button.disabled = true;
  button.textContent = "Assessing…";
  try {
    latestProfile = collectProfile();
    const result = await api("/api/decision", {
      method: "POST",
      body: JSON.stringify({ profile: latestProfile }),
    });
    renderDecision(result);
    document.querySelector("#feedback-no-profile").style.display = "none";
    document.querySelector("#feedback-submit").disabled = false;
    document.querySelector("#feedback-success").textContent = "";
    showToast("Assessment complete — synthetic demo only.");
  } catch (error) {
    errorNode.textContent = error.message;
  } finally {
    button.disabled = false;
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> Run assessment';
  }
});

document.querySelector("#feedback-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!latestProfile) return;
  const button = document.querySelector("#feedback-submit");
  const success = document.querySelector("#feedback-success");
  button.disabled = true;
  success.textContent = "";
  try {
    const outcome = new FormData(event.currentTarget).get("outcome");
    const result = await api("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ profile: latestProfile, outcome }),
    });
    latestOutcome = { outcome, createdAt: new Date().toISOString() };
    await loadOverview();
    success.textContent = `Outcome saved. Demo model retrained to v${result.modelVersion}.`;
    showToast(`Repayment recorded · model v${result.modelVersion}`);
  } catch (error) {
    success.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#reset-profile").addEventListener("click", () => {
  const form = document.querySelector("#decision-form");
  form.reset();
  document.querySelector("#volatility-value").textContent = `${Math.round(Number(form.elements.incomeVolatility.value) * 100)}%`;
  document.querySelector("#regularity-value").textContent = `${Math.round(Number(form.elements.transactionRegularity.value) * 100)}%`;
  document.querySelector("#decision-error").textContent = "";
});

document.querySelector('[name="incomeVolatility"]').addEventListener("input", (event) => {
  document.querySelector("#volatility-value").textContent = `${Math.round(Number(event.target.value) * 100)}%`;
});
document.querySelector('[name="transactionRegularity"]').addEventListener("input", (event) => {
  document.querySelector("#regularity-value").textContent = `${Math.round(Number(event.target.value) * 100)}%`;
});

loadOverview();
