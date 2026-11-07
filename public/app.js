const Analysis = window.ClearpathAnalysis;
const MAX_ROWS = 20_000;
const PREVIEW_ROWS = 100;
const MAPPING_FIELDS = [
  { key: "applicant", label: "Applicant / case reference", required: false },
  { key: "income", label: "Monthly net income", required: true },
  { key: "obligations", label: "Existing monthly obligations", required: true },
  { key: "amount", label: "Requested principal", required: true },
  { key: "balance", label: "Average account balance", required: false },
  { key: "rate", label: "Annual rate (%)", required: false },
  { key: "term", label: "Term (months)", required: false },
];

let sheet = null;
let reviewedRows = [];
let currentFilename = "";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]));

const readOptions = () => ({
  rate: document.querySelector("#default-rate").value,
  term: document.querySelector("#default-term").value,
  ceiling: document.querySelector("#review-ceiling").value,
});

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 2800);
}

function setView(name) {
  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `view-${name}`);
  });
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  document.querySelector("#current-crumb").textContent = ({
    workspace: "Sheet workspace",
    review: "Cash-flow review",
    fairness: "Decision audit",
  })[name];
  if (name === "review" && sheet) renderReview();
  if (name === "fairness" && sheet) renderFairness();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("The CSV has an unclosed quoted field.");
  row.push(field);
  if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
  return rows;
}

function uniqueHeaders(rawHeaders) {
  const seen = new Map();
  return rawHeaders.map((raw, index) => {
    const base = String(raw ?? "").replace(/^\uFEFF/, "").trim() || `Column ${index + 1}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function convertRows(matrix) {
  if (!matrix.length) throw new Error("The selected sheet is empty.");
  const headers = uniqueHeaders(matrix[0]);
  const rows = matrix.slice(1).map((cells) => Object.fromEntries(
    headers.map((header, index) => [header, cells[index] instanceof Date ? cells[index].toISOString() : cells[index] ?? ""]),
  ));
  const nonempty = rows.filter((row) => Object.values(row).some((value) => String(value).trim() !== ""));
  if (!nonempty.length) throw new Error("The selected sheet has column headers but no data rows.");
  if (nonempty.length > MAX_ROWS) throw new Error(`This file has ${nonempty.length.toLocaleString()} rows. The local review limit is ${MAX_ROWS.toLocaleString()}.`);
  return { headers, rows: nonempty };
}

async function readFile(file) {
  if (file.size > 25 * 1024 * 1024) throw new Error("Files larger than 25 MB are not supported for local review.");
  const extension = file.name.split(".").pop().toLowerCase();
  if (extension === "csv") return convertRows(parseCsv(await file.text()));
  if (["xlsx", "xlsm"].includes(extension)) {
    if (typeof window.readXlsxFile !== "function") throw new Error("The spreadsheet reader did not load. Restart the app and try again.");
    const workbookSheets = await window.readXlsxFile(file);
    if (!Array.isArray(workbookSheets) || !workbookSheets[0]?.data) {
      throw new Error("No readable worksheet was found in this workbook.");
    }
    return convertRows(workbookSheets[0].data);
  }
  throw new Error("Choose a .csv, .xlsx, or .xlsm file.");
}

function renderMappings() {
  const columns = sheet.headers;
  const fields = MAPPING_FIELDS.map(({ key, label, required }) => {
    const selected = Analysis.findColumn(columns, key);
    return `<label class="field"><span>${escapeHtml(label)}${required ? ' <b class="required-mark">Required</b>' : ""}</span>
      <select data-map="${key}" aria-label="${escapeHtml(label)}">
        <option value="">${required ? "Select a column" : "Not mapped"}</option>
        ${columns.map((column) => `<option value="${escapeHtml(column)}" ${selected === column ? "selected" : ""}>${escapeHtml(column)}</option>`).join("")}
      </select>
    </label>`;
  });
  document.querySelector("#mapping-grid").innerHTML = fields.join("");
  renderFairnessSelectors();
}

function selectedMappings() {
  return Object.fromEntries([...document.querySelectorAll("[data-map]")].map((select) => [select.dataset.map, select.value]));
}

function renderReview() {
  if (!sheet) return;
  const columns = selectedMappings();
  const options = readOptions();
  reviewedRows = sheet.rows.map((row, index) => ({
    row,
    rowNumber: index + 2,
    result: Analysis.reviewRecord(row, columns, options),
  }));
  const complete = reviewedRows.filter(({ result }) => result.status !== "Incomplete row").length;
  const within = reviewedRows.filter(({ result }) => result.status === "Within review ceiling").length;
  const payments = reviewedRows.reduce((total, { result }) => total + (result.payment ?? 0), 0);
  const hasPayments = reviewedRows.some(({ result }) => result.payment !== null);
  document.querySelector("#row-count").textContent = reviewedRows.length.toLocaleString();
  document.querySelector("#incomplete-count").textContent = (reviewedRows.length - complete).toLocaleString();
  document.querySelector("#within-count").textContent = options.ceiling ? within.toLocaleString() : "—";
  document.querySelector("#total-payment").textContent = hasPayments ? Analysis.money(payments) : "—";
  document.querySelector("#table-title").textContent = `${currentFilename} · ${reviewedRows.length.toLocaleString()} rows`;
  document.querySelector("#file-indicator").textContent = `${currentFilename} · ${reviewedRows.length.toLocaleString()} rows`;
  renderTable(columns);
  document.querySelector("#export-button").disabled = false;
  document.querySelector("#mapping-message").textContent = "Review these mappings; values remain in this browser.";
}

function statusClass(status) {
  if (status === "Within review ceiling") return "status-within";
  if (status === "Above review ceiling" || status === "No monthly surplus") return "status-attention";
  if (status === "Incomplete row" || status === "Product terms missing") return "status-incomplete";
  return "status-neutral";
}

function renderTable(columns) {
  const displayColumns = sheet.headers.filter((column) => column !== columns.applicant).slice(0, 5);
  const calculated = [
    { key: "disposable", label: "Monthly cash remaining" },
    { key: "payment", label: "Est. installment" },
    { key: "burden", label: "Installment / cash" },
    { key: "status", label: "Review signal" },
    { key: "issues", label: "Why / what-if" },
  ];
  document.querySelector("#table-head").innerHTML = [
    "<th>Applicant / row</th>",
    ...displayColumns.map((column) => `<th>${escapeHtml(column)}</th>`),
    ...calculated.map((column) => `<th>${escapeHtml(column.label)}</th>`),
  ].join("");
  const visible = reviewedRows.slice(0, PREVIEW_ROWS);
  document.querySelector("#table-body").innerHTML = visible.map(({ row, rowNumber, result }) => {
    const values = displayColumns.map((column) => `<td title="${escapeHtml(row[column])}">${escapeHtml(row[column])}</td>`);
    const disposable = result.disposable === null ? "—" : Analysis.money(result.disposable);
    const payment = result.payment === null ? "Add terms" : Analysis.money(result.payment);
    const burden = result.burden === null ? "—" : `${Analysis.money(result.burden * 100)}%`;
    const explanations = [...result.issues, ...result.scenarios].join(" ");
    const status = `<span class="status-pill ${statusClass(result.status)}">${escapeHtml(result.status)}</span>`;
    const id = columns.applicant ? row[columns.applicant] : `Row ${rowNumber}`;
    return `<tr><td class="record-cell">${escapeHtml(id || `Row ${rowNumber}`)}</td>${values.join("")}
      <td>${escapeHtml(disposable)}</td><td>${escapeHtml(payment)}</td><td>${escapeHtml(burden)}</td>
      <td>${status}</td><td class="explanation-cell" title="${escapeHtml(explanations)}">${escapeHtml(explanations || "No exceptions detected in mapped fields.")}</td></tr>`;
  }).join("");
  document.querySelector("#table-foot").textContent = reviewedRows.length > PREVIEW_ROWS
    ? `Showing first ${PREVIEW_ROWS} of ${reviewedRows.length.toLocaleString()} rows. Export includes every row.`
    : `Showing all ${reviewedRows.length.toLocaleString()} rows.`;
}

function renderFairnessSelectors() {
  const options = [`<option value="">Select a column</option>`, ...sheet.headers.map((header) => `<option value="${escapeHtml(header)}">${escapeHtml(header)}</option>`)].join("");
  const decision = Analysis.findColumn(sheet.headers, "decision");
  const cohort = Analysis.findColumn(sheet.headers, "cohort");
  document.querySelector("#historical-column").innerHTML = options;
  document.querySelector("#cohort-column").innerHTML = options;
  document.querySelector("#historical-column").value = decision;
  document.querySelector("#cohort-column").value = cohort;
  document.querySelector("#fairness-empty").hidden = true;
  document.querySelector("#fairness-config").hidden = false;
  renderFairness();
}

function renderFairness() {
  if (!sheet) return;
  const decisionColumn = document.querySelector("#historical-column").value;
  const cohortColumn = document.querySelector("#cohort-column").value;
  const root = document.querySelector("#audit-result");
  if (!decisionColumn || !cohortColumn || decisionColumn === cohortColumn) {
    root.innerHTML = '<div class="empty-audit">Choose different decision and group columns to compare historical labels.</div>';
    return;
  }
  const groups = Analysis.summarizeGroups(sheet.rows, decisionColumn, cohortColumn);
  if (!groups.length) {
    root.innerHTML = '<div class="empty-audit">No recognized approved/declined labels with a group value were found. Check the selected columns and labels.</div>';
    return;
  }
  const highest = Math.max(...groups.map((group) => group.rate));
  const lowest = Math.min(...groups.map((group) => group.rate));
  root.innerHTML = `
    <div class="audit-summary"><div><span>Largest observed approval-rate difference</span><strong>${Analysis.money((highest - lowest) * 100)} pp</strong></div><div><span>Historical records counted</span><strong>${groups.reduce((sum, group) => sum + group.total, 0).toLocaleString()}</strong></div></div>
    <div class="audit-groups">${groups.map((group) => `<div class="audit-row"><span>${escapeHtml(group.group)}</span><progress class="audit-progress" max="100" value="${group.rate * 100}" aria-label="${escapeHtml(group.group)} historical approval rate"></progress><strong>${Analysis.money(group.rate * 100)}%</strong><small>${group.total} ${group.total === 1 ? "record" : "records"}</small></div>`).join("")}</div>`;
}

function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv() {
  if (!sheet || !reviewedRows.length) return;
  const headers = [
    ...sheet.headers,
    "Review signal (not a decision)",
    "Monthly cash remaining",
    "Estimated monthly installment",
    "Installment / remaining cash (%)",
    "Calculation notes",
    "What-if scenarios (not a promise)",
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const { row, result } of reviewedRows) {
    lines.push([
      ...sheet.headers.map((header) => row[header]),
      result.status,
      result.disposable,
      result.payment,
      result.burden === null ? null : result.burden * 100,
      result.issues.join(" "),
      result.scenarios.join(" "),
    ].map(csvCell).join(","));
  }
  const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${currentFilename.replace(/\.[^.]+$/, "")}-review.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Reviewed CSV downloaded to your device.");
}

async function openFile(file) {
  const error = document.querySelector("#import-error");
  error.textContent = "";
  try {
    const parsed = await readFile(file);
    sheet = parsed;
    currentFilename = file.name;
    document.querySelector("#import-panel").classList.add("has-file");
    document.querySelector("#review-content").hidden = false;
    document.querySelector("#no-sheet").hidden = true;
    renderMappings();
    renderReview();
    setView("review");
    showToast(`${parsed.rows.length.toLocaleString()} rows opened locally.`);
  } catch (issue) {
    error.textContent = issue.message;
  }
}

function downloadTemplate() {
  const headers = ["applicant_id", "monthly_income", "monthly_obligations", "requested_amount", "average_balance", "annual_interest_rate", "term_months", "historical_decision", "cohort"];
  const blob = new Blob([`${headers.map(csvCell).join(",")}\r\n`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "cash-flow-review-template.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
document.querySelectorAll("[data-open-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.openView)));
document.querySelector("#file-input").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) openFile(file);
  event.target.value = "";
});
document.querySelector("#template-button").addEventListener("click", downloadTemplate);
document.querySelector("#apply-mapping").addEventListener("click", () => {
  renderReview();
  showToast("Sheet review updated in this browser.");
});
document.querySelector("#export-button").addEventListener("click", exportCsv);
document.querySelector("#change-file").addEventListener("click", () => setView("workspace"));
document.querySelector("#historical-column").addEventListener("change", renderFairness);
document.querySelector("#cohort-column").addEventListener("change", renderFairness);

for (const input of ["#default-rate", "#default-term", "#review-ceiling"]) {
  document.querySelector(input).addEventListener("input", () => {
    if (sheet) renderReview();
  });
}

const dropZone = document.querySelector("#drop-zone");
for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
}
dropZone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer.files;
  if (file) openFile(file);
});
