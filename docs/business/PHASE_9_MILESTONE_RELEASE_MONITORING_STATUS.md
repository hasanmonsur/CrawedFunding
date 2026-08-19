# Phase 9 Milestone Release and Project Monitoring Status

## Implemented in Current Foundation

- Milestone plans with deliverables, due dates, target amounts, and progress.
- Milestone evidence submission with review comments.
- Independent milestone verification.
- Fund-release request gated by verified milestone.
- Finance approval by account manager.
- Compliance approval by compliance officer.
- Final fund release gated by approval chain and posted accounting voucher verification.
- Posted voucher amount and currency matching before release.
- Investor-visible project update feed.
- Project timeline read model for milestones, releases, and updates.
- Delayed milestone alerts.
- Project health score with explainable delay signals.
- Audit events for milestone, release, and update commands.

## Current Synthetic API Tokens

- `demo-token-project-manager`: creates milestones, submits evidence, requests releases, and publishes updates.
- `demo-token-project-admin`: verifies milestone evidence.
- `demo-token-account-manager`: finance-approves fund releases.
- `demo-token-compliance`: compliance-approves fund releases.
- `demo-token-voucher-authorizer`: marks funds released after posted voucher verification.

## API Surface

- `POST /api/v1/operations/milestones`
- `POST /api/v1/operations/milestones/evidence`
- `POST /api/v1/operations/milestones/verify`
- `POST /api/v1/operations/fund-releases`
- `POST /api/v1/operations/fund-releases/finance-approve`
- `POST /api/v1/operations/fund-releases/compliance-approve`
- `POST /api/v1/operations/fund-releases/release`
- `POST /api/v1/operations/project-updates`
- `GET /api/v1/operations/timeline`
- `GET /api/v1/operations/health`
- `GET /api/v1/operations/milestone-alerts`

## Remaining Phase 9 Work

- Persist milestone plans, evidence, releases, and timelines through repositories.
- Add independent third-party verification for high-value/high-risk milestones.
- Add material-change workflows for delay, cost overrun, risk escalation, and failed evidence.
- Add investor notice and consent workflow when policy requires it.
- Add notification delivery channels and escalation queues.
