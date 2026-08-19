# CrowdFund360 Agent Instructions

Follow `CrowdFund360-Agent-AI-Phase-by-Phase-Development-PLAN.md` for sequencing and scope.

## Mandatory Rules

- Work on one bounded capability at a time.
- Add or update tests for behavioral changes.
- Do not invent legal, KYC, tax, accounting, suitability, or distribution rules.
- Never bypass tenant/project isolation, maker-checker controls, approval limits, audit logging, or financial immutability.
- Never use real PII, NID, bank data, credentials, or production secrets in source, prompts, fixtures, tests, or logs.
- Posted accounting entries must be corrected through reversal workflows, not destructive edits.
- AI may assist, classify, summarize, or recommend, but cannot approve KYC, vouchers, projects, refunds, releases, distributions, or financial advice.

## Validation

Run before handing off work:

```powershell
npm run validate
```

