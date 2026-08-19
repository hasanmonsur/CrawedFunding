# CrowdFund360 Worker

Background worker placeholder for outbox processing, notifications, reconciliation, documents, reports, and distribution jobs.

The first executable worker slice should process transactional outbox records idempotently and move poison messages to a dead-letter queue with alert metadata.
