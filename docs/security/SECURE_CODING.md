# Secure Coding

- Validate all command DTOs explicitly.
- Use command-specific request shapes to prevent mass assignment.
- Require authorization, tenant scope, project scope, state, and approval-limit checks before sensitive actions.
- Mask identity, bank, and financial data in logs and exports.
- Add negative tests for horizontal and vertical privilege attempts.
- Treat webhooks as hostile until signature, timestamp, nonce, and idempotency checks pass.
- Do not store credentials in source control.
