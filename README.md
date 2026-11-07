# Clearpath — Local Cash-Flow Spreadsheet Review

Open a CSV or Excel workbook and review its real rows in a browser-only workspace. No account or login is required. Spreadsheet contents are parsed and analyzed on your device; this app has no upload, persistence, or applicant-data API.

The app calculates transparent cash-flow figures from user-mapped columns and user-supplied product terms. It can compare estimated installments with an optional review ceiling set by the user, explain row-level data issues, show mathematical what-if scenarios, export an annotated CSV, and summarize historical decision labels by a selected cohort.

## Run locally

Requires Node.js 20 or newer.

```powershell
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). The server binds to `127.0.0.1` by default. Change the port with `$env:PORT=3001; npm start`. The spreadsheet parser is served locally from the installed package; no third-party spreadsheet service is contacted.

Run the automated checks:

```powershell
npm test
```

## Use your own sheet

1. Select **Sheet workspace** and open a `.csv`, `.xlsx`, or `.xlsm` file (first worksheet, up to 20,000 rows and 25 MB).
2. Confirm the mapped columns for monthly net income, existing monthly obligations, and requested principal. Optional columns include a case reference, average balance, row-level APR, and row-level term.
3. If row-level product terms are not present, enter the actual APR and term for that loan product. Set a payment-to-remaining-cash ceiling only if you have an authorized policy value. The app deliberately does not choose one.
4. Review the row-by-row calculations, data-quality notes, and what-if arithmetic. Download the annotated CSV if needed.
5. To audit historical decisions, choose the sheet's existing decision and cohort columns in **Decision audit**. This compares historical labels only; cohort fields do not affect cash-flow calculations.

The blank template can be downloaded from the start page. It contains headers only—no generated applicant records.

## Calculations and boundaries

- Estimated monthly installment uses the standard fixed-rate amortization formula and the APR and term supplied by the user or mapped from the sheet.
- Remaining monthly cash is mapped monthly net income minus mapped existing monthly obligations.
- If an optional review ceiling is set, the app reports whether estimated installment is within that ceiling as a **review signal only**. Counterfactuals show the arithmetic for a smaller request or a different monthly cash position under the same supplied assumption.
- Missing terms or required values are surfaced. No rate, term, threshold, risk probability, lending decision, or repayment outcome is invented.
- The fairness view only counts recognizable historical “approved” and “declined” labels grouped by the selected column. It is a descriptive screen, not proof of fair lending or legal compliance.

## Privacy and real-world use

This is a local spreadsheet calculator—not a live bank feed, credit bureau connection, or validated underwriting system. It does not retrieve Account Aggregator data, store files, retrain a model, or make approval/decline decisions. A reviewer must independently verify inputs and apply the organization's compliant, validated policy. Before handling real applicant data, confirm authorization, consent, data-retention, security, and applicable lending and privacy requirements.
