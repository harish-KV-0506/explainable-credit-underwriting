# Clearpath — Explainable Credit Underwriting

A real-time, local web demo for cash-flow underwriting on entirely generated Account Aggregator-style data. It combines an explainable readiness score, concrete what-if actions, a repayment-feedback retraining loop, portfolio monitoring, and a lightweight fairness audit.

> **Research demo only.** This project is not a credit bureau score, lending recommendation, or production underwriting system. Do not enter real applicant or account data, and do not use results to make lending decisions.

## Run locally

Requires Node.js 20 or newer. No third-party packages are needed.

```powershell
npm start
```

Open [http://localhost:3000](http://localhost:3000). Set a different port with `$env:PORT=3001; npm start`.

Run the automated checks:

```powershell
npm test
```

## What is included

- **Overview:** generated portfolio metrics, repayment trend, modeled exposure estimate, and cohort approval rates.
- **Decision studio:** editable cash-flow inputs, a repayment-readiness estimate, reason codes, and single-variable counterfactuals that show concrete changes which would cross the demo criteria.
- **Feedback loop:** submit a synthetic on-time, late, or default outcome. The local service saves it in `data/feedback.json`, retrains its logistic model against the generated portfolio plus new feedback, and uses the updated model version for subsequent scores.
- **Fairness audit:** approval-rate parity summaries for synthetic gender and age cohorts. Sensitive group labels are excluded from model features and from feedback records. The displayed rates are monitoring signals, not proof of fairness or legal compliance.

## Architecture

- `server.js` serves the UI and JSON API using Node.js built-ins. The portfolio is seeded for repeatable results.
- `public/` contains the responsive browser dashboard; it polls the API for the portfolio and submits assessments and repayment outcomes.
- `data/feedback.json` is created locally only after a feedback event. It is git-ignored; no applicant data or feedback is sent to a third party.
- `test/server.test.js` checks the API, input validation, counterfactual output, and feedback-driven retraining.

## Demo API

- `GET /api/health`
- `GET /api/overview`
- `POST /api/decision` with `{ "profile": { ...cash-flow fields } }`
- `POST /api/feedback` with `{ "profile": { ...cash-flow fields }, "outcome": "on-time" | "late" | "default" }`

The simple 12-month payment estimate assumes a fixed illustrative 24% annual rate. The readiness threshold and repayment model are intentionally illustrative; they have not been calibrated, validated, or reviewed for lending use.
