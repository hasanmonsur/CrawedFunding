import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "./server.js";
import { signProviderCallback } from "../../../packages/payments/src/index.js";

test("health endpoint returns standard envelope and correlation id", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { "x-correlation-id": "test-correlation" }
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-correlation-id"), "test-correlation");
    assert.equal(body.data.status, "ok");
    assert.equal(body.meta.correlationId, "test-correlation");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("platform context exposes disabled regulated boundaries", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/platform/context`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.boundaries.publicFundraisingEnabled, false);
    assert.equal(body.data.boundaries.autonomousFinancialAdviceEnabled, false);
    assert.ok(body.data.roles.includes("Investor"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("access-control roles endpoint exposes permission catalogue", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/access-control/roles`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.data.roles.some((entry) => entry.role === "Voucher Authorizer"));
    assert.ok(body.data.roles.some((entry) => entry.permissions.includes("voucher:authorize")));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("me endpoint requires bearer token and returns scoped assignments", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const denied = await fetch(`http://127.0.0.1:${port}/api/v1/me`);
    const deniedBody = await denied.json();
    assert.equal(denied.status, 401);
    assert.equal(deniedBody.code, "auth_required");

    const allowed = await fetch(`http://127.0.0.1:${port}/api/v1/me`, {
      headers: { authorization: "Bearer demo-token-project-manager" }
    });
    const allowedBody = await allowed.json();
    assert.equal(allowed.status, 200);
    assert.equal(allowedBody.data.user.userId, "user_pm_001");
    assert.equal(allowedBody.data.assignments[0].projectId, "project_agro_001");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("project scope endpoint blocks cross-project access", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const allowed = await fetch(
      `http://127.0.0.1:${port}/api/v1/projects/scope-check?organizationId=org_demo&projectId=project_agro_001`,
      { headers: { authorization: "Bearer demo-token-project-manager" } }
    );
    const allowedBody = await allowed.json();
    assert.equal(allowed.status, 200);
    assert.equal(allowedBody.data.authorizedBy.role, "Project Manager");

    const denied = await fetch(
      `http://127.0.0.1:${port}/api/v1/projects/scope-check?organizationId=org_demo&projectId=project_energy_001`,
      { headers: { authorization: "Bearer demo-token-project-manager" } }
    );
    const deniedBody = await denied.json();
    assert.equal(denied.status, 403);
    assert.equal(deniedBody.code, "assignment_scope_denied");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("voucher authorization preview enforces permission, limit, and four-eyes controls", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const allowed = await fetch(`http://127.0.0.1:${port}/api/v1/vouchers/authorization-preview`, {
      method: "POST",
      headers: {
        authorization: "Bearer demo-token-voucher-authorizer",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        organizationId: "org_demo",
        projectId: "project_agro_001",
        amount: "90000.0000",
        creatorUserId: "user_pm_001"
      })
    });
    const allowedBody = await allowed.json();
    assert.equal(allowed.status, 200);
    assert.equal(allowedBody.data.status, "authorization-preview-approved");

    const overLimit = await fetch(`http://127.0.0.1:${port}/api/v1/vouchers/authorization-preview`, {
      method: "POST",
      headers: {
        authorization: "Bearer demo-token-voucher-authorizer",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        organizationId: "org_demo",
        projectId: "project_agro_001",
        amount: "110000.0000",
        creatorUserId: "user_pm_001"
      })
    });
    const overLimitBody = await overLimit.json();
    assert.equal(overLimit.status, 403);
    assert.equal(overLimitBody.code, "approval_limit_denied");

    const wrongRole = await fetch(`http://127.0.0.1:${port}/api/v1/vouchers/authorization-preview`, {
      method: "POST",
      headers: {
        authorization: "Bearer demo-token-project-manager",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        organizationId: "org_demo",
        projectId: "project_agro_001",
        amount: "100.0000",
        creatorUserId: "user_accounts_001"
      })
    });
    assert.equal(wrongRole.status, 403);

    const selfApproval = await fetch(`http://127.0.0.1:${port}/api/v1/vouchers/authorization-preview`, {
      method: "POST",
      headers: {
        authorization: "Bearer demo-token-voucher-authorizer",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        organizationId: "org_demo",
        projectId: "project_agro_001",
        amount: "100.0000",
        creatorUserId: "user_authorizer_001"
      })
    });
    const selfApprovalBody = await selfApproval.json();
    assert.equal(selfApproval.status, 403);
    assert.equal(selfApprovalBody.code, "four_eyes_required");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("project command endpoints use explicit transitions and audit-safe authorization", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const list = await fetch(`http://127.0.0.1:${port}/api/v1/projects`, {
      headers: { authorization: "Bearer demo-token-project-manager" }
    });
    const listBody = await list.json();
    assert.equal(list.status, 200);
    assert.equal(listBody.data.projects.length, 1);

    const submit = await fetch(`http://127.0.0.1:${port}/api/v1/projects/submit-due-diligence`, {
      method: "POST",
      headers: {
        authorization: "Bearer demo-token-project-manager",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        organizationId: "org_demo",
        projectId: "project_agro_001"
      })
    });
    const submitBody = await submit.json();
    assert.equal(submit.status, 200);
    assert.equal(submitBody.data.project.status, "Due Diligence");

    const directPublish = await fetch(`http://127.0.0.1:${port}/api/v1/projects/publish`, {
      method: "POST",
      headers: {
        authorization: "Bearer demo-token-project-manager",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        organizationId: "org_demo",
        projectId: "project_agro_001"
      })
    });
    const publishBody = await directPublish.json();
    assert.equal(directPublish.status, 403);
    assert.equal(publishBody.code, "permission_denied");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("phase 3 project due diligence to offer publication flow is controlled", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    await postJson(`${base}/api/v1/projects/submit-due-diligence`, "demo-token-project-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001"
    });

    const blockedReview = await postJson(`${base}/api/v1/projects/submit-review`, "demo-token-compliance", {
      organizationId: "org_demo",
      projectId: "project_agro_001"
    });
    assert.equal(blockedReview.status, 409);
    assert.equal(blockedReview.body.code, "due_diligence_incomplete");

    const legal = await postJson(`${base}/api/v1/projects/due-diligence/complete-item`, "demo-token-compliance", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      itemId: "dd_legal_identity",
      evidenceDocumentId: "doc_legal_001"
    });
    assert.equal(legal.status, 200);
    assert.equal(legal.body.data.item.status, "Completed");

    await postJson(`${base}/api/v1/projects/due-diligence/complete-item`, "demo-token-compliance", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      itemId: "dd_financial_assumptions",
      evidenceDocumentId: "doc_finance_001"
    });

    const risk = await postJson(`${base}/api/v1/projects/risk-assessments`, "demo-token-compliance", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      scores: { sponsor: 2, market: 3, finance: 3, execution: 2, legal: 2, governance: 3 }
    });
    assert.equal(risk.status, 200);
    assert.equal(risk.body.data.riskAssessment.band, "Medium");

    const review = await postJson(`${base}/api/v1/projects/submit-review`, "demo-token-compliance", {
      organizationId: "org_demo",
      projectId: "project_agro_001"
    });
    assert.equal(review.status, 200);
    assert.equal(review.body.data.project.status, "Review");

    const approved = await postJson(`${base}/api/v1/projects/approve`, "demo-token-project-admin", {
      organizationId: "org_demo",
      projectId: "project_agro_001"
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.project.status, "Approved");

    const published = await postJson(`${base}/api/v1/projects/publish`, "demo-token-project-admin", {
      organizationId: "org_demo",
      projectId: "project_agro_001"
    });
    assert.equal(published.status, 200);
    assert.equal(published.body.data.project.status, "Published");
    assert.equal(published.body.data.project.publishedOfferVersionId, "offer_project_agro_001_1");

    const offers = await fetch(`${base}/api/v1/projects/offer-versions?organizationId=org_demo&projectId=project_agro_001`, {
      headers: { authorization: "Bearer demo-token-project-manager" }
    });
    const offersBody = await offers.json();
    assert.equal(offers.status, 200);
    assert.equal(offersBody.data.offerVersions[0].snapshot.riskBand, "Medium");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("phase 3 findings endpoint records high-risk remediation requirement", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const response = await postJson(`http://127.0.0.1:${port}/api/v1/projects/due-diligence/findings`, "demo-token-compliance", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      itemId: "dd_legal_identity",
      severity: "High",
      note: "Synthetic license evidence is missing."
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.item.status, "Remediation Required");
    assert.equal(response.body.data.item.findings[0].severity, "High");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("phase 5 marketplace commitment flow preserves offer version and eligibility gates", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    const published = await postJson(`${base}/api/v1/projects/publish`, "demo-token-project-admin", {
      organizationId: "org_demo",
      projectId: "project_energy_001"
    });
    const offerVersionId = published.body.data.project.publishedOfferVersionId;

    const marketplace = await fetch(`${base}/api/v1/marketplace/projects?organizationId=org_demo`);
    const marketplaceBody = await marketplace.json();
    assert.equal(marketplace.status, 200);
    assert.equal(marketplaceBody.data.projects[0].offerVersionId, offerVersionId);

    const disclosure = await fetch(`${base}/api/v1/marketplace/offers?organizationId=org_demo&projectId=project_energy_001&offerVersionId=${offerVersionId}`);
    const disclosureBody = await disclosure.json();
    assert.equal(disclosure.status, 200);
    assert.equal(disclosureBody.data.offer.offerVersionId, offerVersionId);
    assert.ok(disclosureBody.data.disclosures.some((item) => item.includes("not guaranteed")));

    const blockedDraftInvestor = await postJson(`${base}/api/v1/investments/commitments`, "demo-token-investor", {
      organizationId: "org_demo",
      projectId: "project_energy_001",
      offerVersionId,
      amount: "50000.0000"
    });
    assert.equal(blockedDraftInvestor.status, 403);
    assert.equal(blockedDraftInvestor.body.code, "investor_kyc_not_approved");

    const blockedSuitability = await postJson(`${base}/api/v1/investments/commitments`, "demo-token-investor-approved", {
      organizationId: "org_demo",
      projectId: "project_energy_001",
      offerVersionId,
      amount: "50000.0000"
    });
    assert.equal(blockedSuitability.status, 409);
    assert.equal(blockedSuitability.body.code, "suitability_required");

    const suitability = await postJson(`${base}/api/v1/investments/suitability`, "demo-token-investor-approved", {
      organizationId: "org_demo",
      projectId: "project_energy_001",
      offerVersionId,
      answers: { horizon: "medium", understandsRisk: true },
      riskAcknowledged: true
    });
    assert.equal(suitability.status, 200);
    assert.equal(suitability.body.data.suitability.riskAcknowledged, true);

    await postJson(`${base}/api/v1/marketplace/watchlist`, "demo-token-investor-approved", {
      organizationId: "org_demo",
      projectId: "project_energy_001",
      offerVersionId
    });

    const commitment = await postJson(`${base}/api/v1/investments/commitments`, "demo-token-investor-approved", {
      organizationId: "org_demo",
      projectId: "project_energy_001",
      offerVersionId,
      amount: "50000.0000"
    });
    assert.equal(commitment.status, 200);
    assert.equal(commitment.body.data.commitment.status, "Reserved");
    assert.equal(commitment.body.data.commitment.acceptedOfferProjectVersion, 4);

    const accepted = await postJson(`${base}/api/v1/investments/agreements/accept`, "demo-token-investor-approved", {
      organizationId: "org_demo",
      commitmentId: commitment.body.data.commitment.commitmentId,
      agreementVersion: "agreement_v1"
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.data.commitment.status, "Awaiting Payment");

    const portfolio = await fetch(`${base}/api/v1/investments/portfolio?organizationId=org_demo`, {
      headers: { authorization: "Bearer demo-token-investor-approved" }
    });
    const portfolioBody = await portfolio.json();
    assert.equal(portfolio.status, 200);
    assert.equal(portfolioBody.data.commitments[0].offerVersionId, offerVersionId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("phase 6 payment reconciliation flow is idempotent and controlled", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    const published = await postJson(`${base}/api/v1/projects/publish`, "demo-token-project-admin", {
      organizationId: "org_demo",
      projectId: "project_energy_001"
    });
    const offerVersionId = published.body.data.project.publishedOfferVersionId;
    await postJson(`${base}/api/v1/investments/suitability`, "demo-token-investor-approved", {
      organizationId: "org_demo",
      projectId: "project_energy_001",
      offerVersionId,
      answers: { horizon: "medium" },
      riskAcknowledged: true
    });
    const commitment = await postJson(`${base}/api/v1/investments/commitments`, "demo-token-investor-approved", {
      organizationId: "org_demo",
      projectId: "project_energy_001",
      offerVersionId,
      amount: "50000.0000"
    });
    await postJson(`${base}/api/v1/investments/agreements/accept`, "demo-token-investor-approved", {
      organizationId: "org_demo",
      commitmentId: commitment.body.data.commitment.commitmentId,
      agreementVersion: "agreement_v1"
    });

    const instruction = await postJson(`${base}/api/v1/payments/instructions`, "demo-token-investor-approved", {
      organizationId: "org_demo",
      commitmentId: commitment.body.data.commitment.commitmentId
    }, { "idempotency-key": "instruction-api-1" });
    const replayInstruction = await postJson(`${base}/api/v1/payments/instructions`, "demo-token-investor-approved", {
      organizationId: "org_demo",
      commitmentId: commitment.body.data.commitment.commitmentId
    }, { "idempotency-key": "instruction-api-1" });
    assert.equal(instruction.status, 200);
    assert.equal(replayInstruction.body.data.instruction.instructionId, instruction.body.data.instruction.instructionId);

    const proof = await postJson(`${base}/api/v1/payments/proofs`, "demo-token-investor-approved", {
      organizationId: "org_demo",
      commitmentId: commitment.body.data.commitment.commitmentId,
      proofDocumentRef: "object://synthetic/payment-proof",
      paidAmount: "50000.0000"
    });
    assert.equal(proof.body.data.proof.status, "Submitted");

    const bankTransaction = await postJson(`${base}/api/v1/payments/bank-transactions`, "demo-token-account-manager", {
      organizationId: "org_demo",
      projectId: "project_energy_001",
      transactionRef: "api-bank-ref-001",
      paymentReference: instruction.body.data.instruction.paymentReference,
      amount: "50000.0000",
      valueDate: "2026-08-17"
    }, { "idempotency-key": "bank-api-1" });
    assert.equal(bankTransaction.status, 200);

    const reconciliation = await postJson(`${base}/api/v1/payments/reconciliations`, "demo-token-account-manager", {
      organizationId: "org_demo",
      commitmentId: commitment.body.data.commitment.commitmentId,
      bankTransactionId: bankTransaction.body.data.bankTransaction.bankTransactionId
    });
    assert.equal(reconciliation.body.data.reconciliation.status, "Matched");
    assert.equal(reconciliation.body.data.reconciliation.settlementKind, "Full");

    const unapproved = await postJson(`${base}/api/v1/payments/confirm-cleared`, "demo-token-account-manager", {
      organizationId: "org_demo",
      commitmentId: commitment.body.data.commitment.commitmentId
    });
    assert.equal(unapproved.status, 409);
    assert.equal(unapproved.body.code, "reconciliation_approval_required");

    const approvedReconciliation = await postJson(`${base}/api/v1/payments/reconciliations/approve`, "demo-token-voucher-authorizer", {
      organizationId: "org_demo",
      reconciliationId: reconciliation.body.data.reconciliation.reconciliationId
    });
    assert.equal(approvedReconciliation.body.data.reconciliation.status, "Approved");

    const cleared = await postJson(`${base}/api/v1/payments/confirm-cleared`, "demo-token-account-manager", {
      organizationId: "org_demo",
      commitmentId: commitment.body.data.commitment.commitmentId
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.data.instruction.status, "Cleared");
    assert.equal(cleared.body.data.commitment.status, "Reconciled");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("phase 7 accounting voucher workflow posts balanced ledger entries", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    const voucher = await postJson(`${base}/api/v1/accounting/vouchers`, "demo-token-project-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      voucherType: "Receipt",
      narration: "Synthetic investor receipt",
      lines: [
        { accountCode: "1000", debit: "50000.0000", credit: "0.0000" },
        { accountCode: "2000", debit: "0.0000", credit: "50000.0000", investorId: "investor_approved_001" }
      ]
    });
    assert.equal(voucher.status, 200);
    assert.equal(voucher.body.data.voucher.status, "Draft");

    await postJson(`${base}/api/v1/accounting/vouchers/submit`, "demo-token-project-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      voucherId: voucher.body.data.voucher.voucherId
    });
    await postJson(`${base}/api/v1/accounting/vouchers/check`, "demo-token-account-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      voucherId: voucher.body.data.voucher.voucherId
    });
    await postJson(`${base}/api/v1/accounting/vouchers/authorize`, "demo-token-voucher-authorizer", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      voucherId: voucher.body.data.voucher.voucherId
    });
    const posted = await postJson(`${base}/api/v1/accounting/vouchers/post`, "demo-token-voucher-authorizer", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      voucherId: voucher.body.data.voucher.voucherId
    });
    assert.equal(posted.body.data.voucher.status, "Posted");

    const trialBalance = await fetch(`${base}/api/v1/accounting/reports/trial-balance?organizationId=org_demo&projectId=project_agro_001`, {
      headers: { authorization: "Bearer demo-token-account-manager" }
    });
    const trialBalanceBody = await trialBalance.json();
    assert.equal(trialBalance.status, 200);
    assert.equal(trialBalanceBody.data.balances.reduce((sum, row) => sum + Number(row.debit), 0).toFixed(4), "50000.0000");
    assert.equal(trialBalanceBody.data.balances.reduce((sum, row) => sum + Number(row.credit), 0).toFixed(4), "50000.0000");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("phase 8 operations budget-to-asset workflow is controlled", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    const budget = await postJson(`${base}/api/v1/operations/budgets`, "demo-token-project-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      budgetCode: "CAPEX-EQUIPMENT",
      category: "Equipment",
      amount: "125000.0000",
      reason: "API equipment budget revision"
    });
    assert.equal(budget.status, 200);
    assert.equal(budget.body.data.budget.status, "Draft");

    const approvedBudget = await postJson(`${base}/api/v1/operations/budgets/approve`, "demo-token-project-admin", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      budgetId: budget.body.data.budget.budgetId
    });
    assert.equal(approvedBudget.body.data.budget.status, "Approved");

    const blocked = await postJson(`${base}/api/v1/operations/procurements`, "demo-token-project-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      budgetCode: "CAPEX-EQUIPMENT",
      vendorName: "Synthetic Vendor",
      amount: "150000.0000",
      description: "Over-budget machinery"
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, "budget_insufficient");

    const procurement = await postJson(`${base}/api/v1/operations/procurements`, "demo-token-project-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      budgetCode: "CAPEX-EQUIPMENT",
      vendorName: "Synthetic Vendor",
      amount: "60000.0000",
      description: "Dryer machinery"
    });
    assert.equal(procurement.body.data.procurement.status, "Requested");

    const approvedProcurement = await postJson(`${base}/api/v1/operations/procurements/approve`, "demo-token-project-admin", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      procurementId: procurement.body.data.procurement.procurementId
    });
    assert.equal(approvedProcurement.body.data.procurement.status, "Approved");

    const expense = await postJson(`${base}/api/v1/operations/expenses`, "demo-token-project-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      budgetCode: "CAPEX-EQUIPMENT",
      procurementId: procurement.body.data.procurement.procurementId,
      amount: "55000.0000",
      invoiceRef: "INV-API-001",
      description: "Final equipment invoice"
    });
    assert.equal(expense.body.data.expense.status, "Submitted");

    const approvedExpense = await postJson(`${base}/api/v1/operations/expenses/approve`, "demo-token-account-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      expenseId: expense.body.data.expense.expenseId
    });
    assert.equal(approvedExpense.body.data.expense.status, "Approved");

    const asset = await postJson(`${base}/api/v1/operations/assets`, "demo-token-project-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      expenseId: expense.body.data.expense.expenseId,
      assetTag: "AGRO-API-DRYER-001",
      assetType: "Equipment",
      custodyUserId: "user_pm_001"
    });
    assert.equal(asset.body.data.asset.status, "In Service");

    const variance = await fetch(`${base}/api/v1/operations/budget-variance?organizationId=org_demo&projectId=project_agro_001`, {
      headers: { authorization: "Bearer demo-token-project-manager" }
    });
    const varianceBody = await variance.json();
    assert.equal(variance.status, 200);
    assert.equal(varianceBody.data.variance[0].committed, "60000.0000");
    assert.equal(varianceBody.data.variance[0].actual, "55000.0000");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("phase 9 milestone release requires evidence, approvals, and posted voucher", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    const milestone = await postJson(`${base}/api/v1/operations/milestones`, "demo-token-project-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      title: "Equipment installed",
      dueDate: "2026-08-20",
      targetAmount: "40000.0000",
      deliverables: [{ title: "Installation evidence" }]
    });
    assert.equal(milestone.body.data.milestone.status, "Planned");

    const prematureRelease = await postJson(`${base}/api/v1/operations/fund-releases`, "demo-token-project-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      milestoneId: milestone.body.data.milestone.milestoneId,
      amount: "40000.0000",
      purpose: "Premature release"
    });
    assert.equal(prematureRelease.status, 409);
    assert.equal(prematureRelease.body.code, "milestone_not_verified");

    await postJson(`${base}/api/v1/operations/milestones/evidence`, "demo-token-project-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      milestoneId: milestone.body.data.milestone.milestoneId,
      evidenceRef: "object://synthetic/milestone-installation",
      progressPercent: 100,
      comment: "Installation completed"
    });
    const verified = await postJson(`${base}/api/v1/operations/milestones/verify`, "demo-token-project-admin", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      milestoneId: milestone.body.data.milestone.milestoneId,
      comment: "Evidence accepted"
    });
    assert.equal(verified.body.data.milestone.status, "Verified");

    const release = await postJson(`${base}/api/v1/operations/fund-releases`, "demo-token-project-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      milestoneId: milestone.body.data.milestone.milestoneId,
      amount: "40000.0000",
      purpose: "Release equipment installment"
    });
    assert.equal(release.body.data.release.status, "Requested");

    await postJson(`${base}/api/v1/operations/fund-releases/finance-approve`, "demo-token-account-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      releaseId: release.body.data.release.releaseId
    });
    await postJson(`${base}/api/v1/operations/fund-releases/compliance-approve`, "demo-token-compliance", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      releaseId: release.body.data.release.releaseId
    });

    const voucher = await createPostedVoucherViaApi({ base });
    const released = await postJson(`${base}/api/v1/operations/fund-releases/release`, "demo-token-voucher-authorizer", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      releaseId: release.body.data.release.releaseId,
      postedVoucherId: voucher.voucherId
    });
    assert.equal(released.body.data.release.status, "Released");
    assert.equal(released.body.data.release.voucher.amount, "40000.0000");

    await postJson(`${base}/api/v1/operations/project-updates`, "demo-token-project-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      title: "Milestone released",
      body: "Equipment installation milestone was released after approvals."
    });
    const timeline = await fetch(`${base}/api/v1/operations/timeline?organizationId=org_demo&projectId=project_agro_001`, {
      headers: { authorization: "Bearer demo-token-project-manager" }
    });
    const timelineBody = await timeline.json();
    assert.equal(timeline.status, 200);
    assert.equal(timelineBody.data.timeline.releases[0].status, "Released");
    assert.equal(timelineBody.data.timeline.updates[0].visibility, "Investors");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("phase 9 milestone alerts feed health explanations", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    await postJson(`${base}/api/v1/operations/milestones`, "demo-token-project-manager", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      title: "Delayed construction",
      dueDate: "2026-08-01",
      targetAmount: "10000.0000",
      deliverables: [{ title: "Photo evidence" }]
    });
    const alerts = await fetch(`${base}/api/v1/operations/milestone-alerts?organizationId=org_demo&projectId=project_agro_001&asOfDate=2026-08-17`, {
      headers: { authorization: "Bearer demo-token-project-manager" }
    });
    const alertsBody = await alerts.json();
    assert.equal(alerts.status, 200);
    assert.equal(alertsBody.data.alerts[0].severity, "High");

    const health = await fetch(`${base}/api/v1/operations/health?organizationId=org_demo&projectId=project_agro_001&asOfDate=2026-08-17`, {
      headers: { authorization: "Bearer demo-token-project-manager" }
    });
    const healthBody = await health.json();
    assert.equal(health.status, 200);
    assert.ok(healthBody.data.health.explanations[0].includes("Delayed construction"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function createPostedVoucherViaApi({ base }) {
  const voucher = await postJson(`${base}/api/v1/accounting/vouchers`, "demo-token-project-manager", {
    organizationId: "org_demo",
    projectId: "project_agro_001",
    voucherType: "Payment",
    narration: "Milestone fund release",
    attachments: [{ documentRef: "object://synthetic/payment-advice", description: "Bank payment advice" }],
    lines: [
      { accountCode: "5000", debit: "40000.0000", credit: "0.0000" },
      { accountCode: "1000", debit: "0.0000", credit: "40000.0000" }
    ]
  });
  await postJson(`${base}/api/v1/accounting/vouchers/submit`, "demo-token-project-manager", {
    organizationId: "org_demo",
    projectId: "project_agro_001",
    voucherId: voucher.body.data.voucher.voucherId
  });
  await postJson(`${base}/api/v1/accounting/vouchers/check`, "demo-token-account-manager", {
    organizationId: "org_demo",
    projectId: "project_agro_001",
    voucherId: voucher.body.data.voucher.voucherId
  });
  await postJson(`${base}/api/v1/accounting/vouchers/authorize`, "demo-token-voucher-authorizer", {
    organizationId: "org_demo",
    projectId: "project_agro_001",
    voucherId: voucher.body.data.voucher.voucherId
  });
  const posted = await postJson(`${base}/api/v1/accounting/vouchers/post`, "demo-token-voucher-authorizer", {
    organizationId: "org_demo",
    projectId: "project_agro_001",
    voucherId: voucher.body.data.voucher.voucherId
  });
  return posted.body.data.voucher;
}


test("phase 10 period close, distribution, payment, and settlement complete end to end", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    const scope = { organizationId: "org_demo", projectId: "project_energy_001" };
    const periodId = "period_energy_2026_08";

    const commitmentId = await createReconciledHolding({ base, scope });
    const allocated = await postJson(`${base}/api/v1/investments/allocations`, "demo-token-account-manager", {
      ...scope,
      commitmentId,
      allocatedAt: "2026-08-02T00:00:00.000Z"
    });
    assert.equal(allocated.status, 200);
    assert.equal(allocated.body.data.commitment.status, "Allocated");

    const activated = await postJson(`${base}/api/v1/investments/activations`, "demo-token-account-manager", {
      ...scope,
      commitmentId
    });
    assert.equal(activated.body.data.commitment.status, "Active");

    await postPeriodVoucher({ base, scope, lines: [
      { accountCode: "1000", debit: "60000.0000", credit: "0.0000" },
      { accountCode: "4000", debit: "0.0000", credit: "60000.0000" }
    ] });
    await postPeriodVoucher({ base, scope, lines: [
      { accountCode: "5000", debit: "20000.0000", credit: "0.0000" },
      { accountCode: "1000", debit: "0.0000", credit: "20000.0000" }
    ] });

    const earlyProposal = await postJson(`${base}/api/v1/distributions`, "demo-token-account-manager", {
      ...scope,
      periodId,
      formulaVersionId: "formula_1"
    });
    assert.equal(earlyProposal.status, 409);
    assert.equal(earlyProposal.body.code, "period_result_unavailable");

    await postJson(`${base}/api/v1/accounting/periods/start-close`, "demo-token-account-manager", { ...scope, periodId });
    const checklist = await getJson(
      `${base}/api/v1/accounting/periods/close-checklist?organizationId=org_demo&projectId=project_energy_001&periodId=${periodId}`,
      "demo-token-account-manager"
    );
    assert.equal(checklist.status, 200);
    for (const item of checklist.body.data.checklist.items.filter((entry) => !entry.automated)) {
      await postJson(`${base}/api/v1/accounting/periods/checklist-items`, "demo-token-account-manager", {
        ...scope,
        periodId,
        itemId: item.itemId,
        evidenceRef: `object://synthetic/close/${item.itemId}`
      });
    }

    const closed = await postJson(`${base}/api/v1/accounting/periods/close`, "demo-token-account-manager", { ...scope, periodId });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.data.period.result.netResult, "40000.0000");

    const profitAndLoss = await getJson(
      `${base}/api/v1/accounting/reports/profit-and-loss?organizationId=org_demo&projectId=project_energy_001&periodId=${periodId}`,
      "demo-token-account-manager"
    );
    assert.equal(profitAndLoss.body.data.profitAndLoss.revenueTotal, "60000.0000");
    assert.equal(profitAndLoss.body.data.profitAndLoss.expenseTotal, "20000.0000");

    const unlockedProposalAttempt = await postJson(`${base}/api/v1/distributions`, "demo-token-account-manager", {
      ...scope,
      periodId,
      formulaVersionId: "formula_1"
    });
    assert.equal(unlockedProposalAttempt.status, 409);
    assert.equal(unlockedProposalAttempt.body.code, "period_not_locked");

    const locked = await postJson(`${base}/api/v1/accounting/periods/lock`, "demo-token-voucher-authorizer", { ...scope, periodId });
    assert.equal(locked.body.data.period.status, "Locked");

    const formula = await postJson(`${base}/api/v1/distributions/formula-versions`, "demo-token-account-manager", {
      ...scope,
      basis: "capital",
      withholdingRatePercent: "10.0000"
    });
    assert.equal(formula.status, 201);
    const formulaVersionId = formula.body.data.formulaVersion.formulaVersionId;

    const unpublished = await postJson(`${base}/api/v1/distributions`, "demo-token-account-manager", {
      ...scope,
      periodId,
      formulaVersionId
    });
    assert.equal(unpublished.status, 409);
    assert.equal(unpublished.body.code, "formula_not_published");

    await postJson(`${base}/api/v1/distributions/formula-versions/publish`, "demo-token-project-admin", {
      ...scope,
      formulaVersionId
    });

    const proposal = await postJson(`${base}/api/v1/distributions`, "demo-token-account-manager", {
      ...scope,
      periodId,
      formulaVersionId
    });
    assert.equal(proposal.status, 201);
    const distributionId = proposal.body.data.distribution.distributionId;
    assert.equal(proposal.body.data.distribution.distributableAmount, "40000.0000");

    const calculated = await postJson(`${base}/api/v1/distributions/calculate`, "demo-token-account-manager", {
      ...scope,
      distributionId
    });
    assert.equal(calculated.body.data.distribution.grossTotal, "40000.0000");
    assert.equal(calculated.body.data.distribution.withholdingTotal, "4000.0000");
    assert.equal(calculated.body.data.distribution.netTotal, "36000.0000");
    assert.equal(calculated.body.data.distribution.residualAmount, "0.0000");
    assert.equal(calculated.body.data.distribution.entitlements.length, 1);
    assert.equal(calculated.body.data.distribution.entitlements[0].status, "Eligible");

    const selfApproval = await postJson(`${base}/api/v1/distributions/review`, "demo-token-account-manager", {
      ...scope,
      distributionId
    });
    assert.equal(selfApproval.status, 403);

    await postJson(`${base}/api/v1/distributions/review`, "demo-token-account-manager-two", { ...scope, distributionId });
    const approved = await postJson(`${base}/api/v1/distributions/approve`, "demo-token-project-admin", { ...scope, distributionId });
    assert.equal(approved.body.data.distribution.status, "Approved");

    const payableVoucherId = await postPeriodVoucher({ base, scope, lines: [
      { accountCode: "3000", debit: "40000.0000", credit: "0.0000" },
      { accountCode: "2100", debit: "0.0000", credit: "36000.0000" },
      { accountCode: "2200", debit: "0.0000", credit: "4000.0000", taxCode: "WHT-10" }
    ] });

    const mismatched = await postJson(`${base}/api/v1/distributions/post-payable`, "demo-token-voucher-authorizer", {
      ...scope,
      distributionId,
      postedVoucherId: "voucher_1"
    });
    assert.equal(mismatched.status, 409);

    const payable = await postJson(`${base}/api/v1/distributions/post-payable`, "demo-token-voucher-authorizer", {
      ...scope,
      distributionId,
      postedVoucherId: payableVoucherId
    });
    assert.equal(payable.body.data.distribution.status, "Payable Posted");

    const batch = await postJson(`${base}/api/v1/distributions/payment-batches`, "demo-token-voucher-authorizer", {
      ...scope,
      distributionId
    });
    assert.equal(batch.status, 201);
    assert.equal(batch.body.data.batch.lines.length, 1);
    assert.equal(batch.body.data.batch.lines[0].netAmount, "36000.0000");
    assert.match(batch.body.data.batch.lines[0].payoutAccountRef, /^masked:/);

    await postJson(`${base}/api/v1/distributions/payment-results`, "demo-token-voucher-authorizer", {
      ...scope,
      distributionId,
      results: [{
        entitlementId: batch.body.data.batch.lines[0].entitlementId,
        outcome: "Paid",
        paymentReference: "payout-ref-001"
      }]
    });

    const reconciled = await postJson(`${base}/api/v1/distributions/reconcile`, "demo-token-account-manager", { ...scope, distributionId });
    assert.equal(reconciled.body.data.distribution.status, "Reconciled");
    assert.equal(reconciled.body.data.distribution.reconciledNetTotal, "36000.0000");

    const completed = await postJson(`${base}/api/v1/distributions/complete`, "demo-token-project-admin", { ...scope, distributionId });
    assert.equal(completed.body.data.distribution.status, "Completed");

    const statement = await getJson(
      `${base}/api/v1/distributions/statements/me?organizationId=org_demo&projectId=project_energy_001`,
      "demo-token-investor-approved"
    );
    assert.equal(statement.status, 200);
    assert.equal(statement.body.data.statement.totals.grossAmount, "40000.0000");
    assert.equal(statement.body.data.statement.totals.netAmount, "36000.0000");
    assert.equal(statement.body.data.statement.totals.paidAmount, "36000.0000");

    const settlement = await postJson(`${base}/api/v1/projects/settlement/close`, "demo-token-project-admin", { ...scope });
    assert.equal(settlement.body.data.settlement.status, "Settled");
    assert.equal(settlement.body.data.settlement.lifetimeNetDistributed, "36000.0000");
    assert.equal(settlement.body.data.settlement.settledHoldings, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("distribution endpoints enforce role separation", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    const scope = { organizationId: "org_demo", projectId: "project_energy_001" };

    const investorFormula = await postJson(`${base}/api/v1/distributions/formula-versions`, "demo-token-investor-approved", scope);
    assert.equal(investorFormula.status, 403);

    const investorClose = await postJson(`${base}/api/v1/accounting/periods/start-close`, "demo-token-investor-approved", {
      ...scope,
      periodId: "period_energy_2026_08"
    });
    assert.equal(investorClose.status, 403);

    const accountManagerLock = await postJson(`${base}/api/v1/accounting/periods/lock`, "demo-token-account-manager", {
      ...scope,
      periodId: "period_energy_2026_08"
    });
    assert.equal(accountManagerLock.status, 403);
    assert.equal(accountManagerLock.body.code, "permission_denied");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function createReconciledHolding({ base, scope }) {
  const published = await postJson(`${base}/api/v1/projects/publish`, "demo-token-project-admin", scope);
  const offerVersionId = published.body.data.project.publishedOfferVersionId;
  await postJson(`${base}/api/v1/investments/suitability`, "demo-token-investor-approved", {
    ...scope,
    offerVersionId,
    answers: { horizon: "long" },
    riskAcknowledged: true
  });
  const commitment = await postJson(`${base}/api/v1/investments/commitments`, "demo-token-investor-approved", {
    ...scope,
    offerVersionId,
    amount: "100000.0000"
  });
  const commitmentId = commitment.body.data.commitment.commitmentId;
  await postJson(`${base}/api/v1/investments/agreements/accept`, "demo-token-investor-approved", {
    organizationId: scope.organizationId,
    commitmentId,
    agreementVersion: "agreement_v1"
  });
  const instruction = await postJson(`${base}/api/v1/payments/instructions`, "demo-token-investor-approved", {
    organizationId: scope.organizationId,
    commitmentId
  }, { "idempotency-key": "phase10-instruction-1" });
  await postJson(`${base}/api/v1/payments/proofs`, "demo-token-investor-approved", {
    organizationId: scope.organizationId,
    commitmentId,
    proofDocumentRef: "object://synthetic/payment-proof",
    paidAmount: "100000.0000"
  });
  const bankTransaction = await postJson(`${base}/api/v1/payments/bank-transactions`, "demo-token-account-manager", {
    ...scope,
    transactionRef: "phase10-bank-ref-001",
    paymentReference: instruction.body.data.instruction.paymentReference,
    amount: "100000.0000",
    valueDate: "2026-08-02"
  }, { "idempotency-key": "phase10-bank-1" });
  const reconciliation = await postJson(`${base}/api/v1/payments/reconciliations`, "demo-token-account-manager", {
    organizationId: scope.organizationId,
    commitmentId,
    bankTransactionId: bankTransaction.body.data.bankTransaction.bankTransactionId
  });
  await postJson(`${base}/api/v1/payments/reconciliations/approve`, "demo-token-voucher-authorizer", {
    organizationId: scope.organizationId,
    reconciliationId: reconciliation.body.data.reconciliation.reconciliationId
  });
  const cleared = await postJson(`${base}/api/v1/payments/confirm-cleared`, "demo-token-account-manager", {
    organizationId: scope.organizationId,
    commitmentId
  });

  // Clearing drafts an investor receipt voucher in accounting. Post it so the period has no
  // unposted vouchers left when it is closed.
  const draftVoucherId = cleared.body.data.draftVoucher.voucherId;
  await postJson(`${base}/api/v1/accounting/vouchers/submit`, "demo-token-account-manager", { ...scope, voucherId: draftVoucherId });
  await postJson(`${base}/api/v1/accounting/vouchers/check`, "demo-token-account-manager-two", { ...scope, voucherId: draftVoucherId });
  await postJson(`${base}/api/v1/accounting/vouchers/authorize`, "demo-token-voucher-authorizer", { ...scope, voucherId: draftVoucherId });
  await postJson(`${base}/api/v1/accounting/vouchers/post`, "demo-token-voucher-authorizer", { ...scope, voucherId: draftVoucherId });

  return commitmentId;
}

async function postPeriodVoucher({ base, scope, lines }) {
  const voucher = await postJson(`${base}/api/v1/accounting/vouchers`, "demo-token-super-admin", {
    ...scope,
    voucherType: "Journal",
    narration: "Synthetic period activity",
    lines
  });
  const voucherId = voucher.body.data.voucher.voucherId;
  await postJson(`${base}/api/v1/accounting/vouchers/submit`, "demo-token-super-admin", { ...scope, voucherId });
  await postJson(`${base}/api/v1/accounting/vouchers/check`, "demo-token-account-manager", { ...scope, voucherId });
  await postJson(`${base}/api/v1/accounting/vouchers/authorize`, "demo-token-voucher-authorizer", { ...scope, voucherId });
  await postJson(`${base}/api/v1/accounting/vouchers/post`, "demo-token-voucher-authorizer", { ...scope, voucherId });
  return voucherId;
}

async function getJson(url, token) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  return {
    status: response.status,
    body: await response.json()
  };
}


test("phase 6 escrow accounts, split matching, receipts, and cash control are exposed over the API", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    const scope = { organizationId: "org_demo", projectId: "project_energy_001" };
    const published = await postJson(`${base}/api/v1/projects/publish`, "demo-token-project-admin", scope);
    const offerVersionId = published.body.data.project.publishedOfferVersionId;

    const accounts = await getJson(
      `${base}/api/v1/payments/project-accounts?organizationId=org_demo&projectId=project_energy_001`,
      "demo-token-account-manager"
    );
    assert.equal(accounts.status, 200);
    assert.equal(accounts.body.data.accounts[0].accountType, "Segregated Project");
    assert.match(accounts.body.data.accounts[0].accountFingerprint, /^masked:/);

    const coMingled = await postJson(`${base}/api/v1/payments/bank-transactions`, "demo-token-account-manager", {
      ...scope,
      transactionRef: "api-escrow-mismatch",
      paymentReference: "CF360-X",
      amount: "1000.0000",
      valueDate: "2026-08-19",
      accountCode: "ESCROW-AGRO-001"
    }, { "idempotency-key": "api-escrow-mismatch" });
    assert.equal(coMingled.status, 409);
    assert.equal(coMingled.body.code, "escrow_account_project_mismatch");

    const commitmentIds = [];
    for (const amount of ["50000.0000", "30000.0000"]) {
      await postJson(`${base}/api/v1/investments/suitability`, "demo-token-investor-approved", {
        ...scope,
        offerVersionId,
        answers: { horizon: "long" },
        riskAcknowledged: true
      });
      const commitment = await postJson(`${base}/api/v1/investments/commitments`, "demo-token-investor-approved", {
        ...scope,
        offerVersionId,
        amount
      });
      const commitmentId = commitment.body.data.commitment.commitmentId;
      await postJson(`${base}/api/v1/investments/agreements/accept`, "demo-token-investor-approved", {
        organizationId: "org_demo",
        commitmentId,
        agreementVersion: "agreement_v1"
      });
      await postJson(`${base}/api/v1/payments/instructions`, "demo-token-investor-approved", {
        organizationId: "org_demo",
        commitmentId
      }, { "idempotency-key": `api-instruction-${commitmentId}` });
      commitmentIds.push(commitmentId);
    }

    const settlement = await postJson(`${base}/api/v1/payments/settlements`, "demo-token-account-manager", {
      ...scope,
      settlementRef: "api-settlement-1",
      lines: [{
        transactionRef: "api-settle-1",
        paymentReference: "CF360-PARTNER-AGGREGATED",
        amount: "80000.0000",
        valueDate: "2026-08-19"
      }]
    }, { "idempotency-key": "api-settlement-1" });
    assert.equal(settlement.status, 201);
    assert.equal(settlement.body.data.batch.importedCount, 1);
    const bankTransactionId = settlement.body.data.batch.transactions[0].bankTransactionId;

    const suggestion = await getJson(
      `${base}/api/v1/payments/match-candidates?organizationId=org_demo&projectId=project_energy_001&bankTransactionId=${bankTransactionId}`,
      "demo-token-account-manager"
    );
    assert.equal(suggestion.body.data.suggestion.authoritative, false);
    assert.equal(suggestion.body.data.suggestion.decisionRequiresHuman, true);

    const split = await postJson(`${base}/api/v1/payments/reconciliations/split`, "demo-token-account-manager", {
      ...scope,
      bankTransactionId,
      allocations: [
        { commitmentId: commitmentIds[0], amount: "50000.0000", overrideReason: "aggregated partner settlement line" },
        { commitmentId: commitmentIds[1], amount: "30000.0000", overrideReason: "aggregated partner settlement line" }
      ]
    });
    assert.equal(split.status, 200);
    assert.equal(split.body.data.split.allocatedAmount, "80000.0000");
    assert.equal(split.body.data.split.residualAmount, "0.0000");

    for (const reconciliation of split.body.data.split.reconciliations) {
      await postJson(`${base}/api/v1/payments/reconciliations/approve`, "demo-token-voucher-authorizer", {
        organizationId: "org_demo",
        reconciliationId: reconciliation.reconciliationId
      });
      await postJson(`${base}/api/v1/payments/reconciliations/lock`, "demo-token-voucher-authorizer", {
        organizationId: "org_demo",
        reconciliationId: reconciliation.reconciliationId
      });
    }

    await postJson(`${base}/api/v1/payments/confirm-cleared`, "demo-token-account-manager", {
      organizationId: "org_demo",
      commitmentId: commitmentIds[0]
    });
    const receipt = await postJson(`${base}/api/v1/payments/receipts`, "demo-token-account-manager", {
      organizationId: "org_demo",
      commitmentId: commitmentIds[0]
    }, { "idempotency-key": "api-receipt-1" });
    assert.equal(receipt.status, 201);
    assert.equal(receipt.body.data.receipt.amount, "50000.0000");

    const unbalanced = await postJson(`${base}/api/v1/payments/cash-controls`, "demo-token-account-manager", {
      ...scope,
      controlDate: "2026-08-19",
      openingBalance: "0.0000",
      closingBalance: "10000.0000"
    });
    assert.equal(unbalanced.status, 409);
    assert.equal(unbalanced.body.code, "cash_control_unbalanced");

    const control = await postJson(`${base}/api/v1/payments/cash-controls`, "demo-token-account-manager", {
      ...scope,
      controlDate: "2026-08-19",
      openingBalance: "0.0000",
      closingBalance: "80000.0000"
    });
    assert.equal(control.status, 201);
    assert.equal(control.body.data.control.inflowTotal, "80000.0000");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("phase 6 provider callbacks verify signature, timestamp, nonce, and event deduplication", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    const scope = { organizationId: "org_demo", projectId: "project_energy_001" };
    const providers = await fetch(`${base}/api/v1/payments/providers`);
    const providerBody = await providers.json();
    assert.equal(providers.status, 200);
    const provider = providerBody.data.providers[0];
    assert.equal(provider.liveMoneyMovementEnabled, false);
    assert.equal(provider.syntheticSecret, true);

    const secret = `synthetic-local-secret.${provider.providerId}.not-for-production`;
    const timestamp = Math.floor(Date.now() / 1000);
    const event = {
      providerEventId: "api_evt_001",
      ...scope,
      transactionRef: "api-provider-tx-1",
      paymentReference: "CF360-API-CALLBACK",
      amount: "12345.0000",
      currency: "BDT",
      valueDate: "2026-08-19",
      outcome: "Settled"
    };

    const tampered = await postCallback(base, {
      providerId: provider.providerId,
      timestamp,
      nonce: "api-nonce-bad",
      event,
      signature: signProviderCallback({ secret: "wrong-secret", providerId: provider.providerId, timestamp, nonce: "api-nonce-bad", event })
    });
    assert.equal(tampered.status, 401);
    assert.equal(tampered.body.code, "callback_signature_invalid");

    const stale = timestamp - 4000;
    const expired = await postCallback(base, {
      providerId: provider.providerId,
      timestamp: stale,
      nonce: "api-nonce-stale",
      event,
      signature: signProviderCallback({ secret, providerId: provider.providerId, timestamp: stale, nonce: "api-nonce-stale", event })
    });
    assert.equal(expired.status, 401);
    assert.equal(expired.body.code, "callback_timestamp_expired");

    const accepted = await postCallback(base, {
      providerId: provider.providerId,
      timestamp,
      nonce: "api-nonce-1",
      event,
      signature: signProviderCallback({ secret, providerId: provider.providerId, timestamp, nonce: "api-nonce-1", event })
    });
    assert.equal(accepted.status, 202);
    assert.equal(accepted.body.data.callback.deduplicated, false);

    const replayed = await postCallback(base, {
      providerId: provider.providerId,
      timestamp,
      nonce: "api-nonce-1",
      event: { ...event, providerEventId: "api_evt_002", transactionRef: "api-provider-tx-2" },
      signature: signProviderCallback({
        secret,
        providerId: provider.providerId,
        timestamp,
        nonce: "api-nonce-1",
        event: { ...event, providerEventId: "api_evt_002", transactionRef: "api-provider-tx-2" }
      })
    });
    assert.equal(replayed.status, 409);
    assert.equal(replayed.body.code, "callback_nonce_replayed");

    const deduplicated = await postCallback(base, {
      providerId: provider.providerId,
      timestamp,
      nonce: "api-nonce-2",
      event,
      signature: signProviderCallback({ secret, providerId: provider.providerId, timestamp, nonce: "api-nonce-2", event })
    });
    assert.equal(deduplicated.status, 202);
    assert.equal(deduplicated.body.data.callback.deduplicated, true);
    assert.equal(
      deduplicated.body.data.callback.bankTransactionId,
      accepted.body.data.callback.bankTransactionId
    );

    const transactions = await getJson(
      `${base}/api/v1/payments/bank-transactions?organizationId=org_demo&projectId=project_energy_001`,
      "demo-token-account-manager"
    );
    assert.equal(transactions.body.data.transactions.filter((entry) => entry.source === "Provider Callback").length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function postCallback(base, { providerId, timestamp, nonce, event, signature }) {
  const response = await fetch(`${base}/api/v1/payments/provider-callbacks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-provider-id": providerId,
      "x-provider-signature": signature,
      "x-provider-timestamp": String(timestamp),
      "x-provider-nonce": nonce
    },
    body: JSON.stringify(event)
  });
  return { status: response.status, body: await response.json() };
}


test("phase 7 posting matrix, dimensions, opening balances, and ledger reports are exposed over the API", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    const scope = { organizationId: "org_demo", projectId: "project_agro_001" };
    const query = "organizationId=org_demo&projectId=project_agro_001";

    const matrix = await getJson(`${base}/api/v1/accounting/posting-matrix?${query}`, "demo-token-account-manager");
    assert.equal(matrix.status, 200);
    assert.equal(matrix.body.data.active.version, 1);
    assert.equal(matrix.body.data.active.syntheticApproval, true);

    const drafted = await postJson(`${base}/api/v1/accounting/posting-matrix`, "demo-token-account-manager", {
      ...scope,
      notes: "Tighten sales postings",
      rules: {
        ...matrix.body.data.active.rules,
        Sales: { debitAccountTypes: ["Asset"], creditAccountTypes: ["Revenue"], requiresAttachment: false }
      }
    });
    assert.equal(drafted.status, 201);

    const selfApprove = await postJson(`${base}/api/v1/accounting/posting-matrix/approve`, "demo-token-account-manager", {
      ...scope,
      postingMatrixVersionId: drafted.body.data.postingMatrixVersion.postingMatrixVersionId
    });
    assert.equal(selfApprove.status, 403);

    const approvedMatrix = await postJson(`${base}/api/v1/accounting/posting-matrix/approve`, "demo-token-voucher-authorizer", {
      ...scope,
      postingMatrixVersionId: drafted.body.data.postingMatrixVersion.postingMatrixVersionId
    });
    assert.equal(approvedMatrix.body.data.postingMatrixVersion.status, "Approved");

    const opening = await postJson(`${base}/api/v1/accounting/opening-balances`, "demo-token-account-manager", {
      ...scope,
      narration: "Project opening position",
      attachments: [{ documentRef: "object://synthetic/opening-trial-balance" }],
      lines: [
        { accountCode: "1000", debit: "25000.0000", credit: "0.0000" },
        { accountCode: "3000", debit: "0.0000", credit: "25000.0000" }
      ]
    });
    assert.equal(opening.status, 201);
    assert.equal(opening.body.data.voucher.voucherType, "Opening Balance");
    await runVoucherToPosted({ base, scope, voucherId: opening.body.data.voucher.voucherId, creatorToken: "demo-token-account-manager", checkerToken: "demo-token-account-manager-two" });

    const missingDimension = await postJson(`${base}/api/v1/accounting/vouchers`, "demo-token-project-manager", {
      ...scope,
      voucherType: "Receipt",
      narration: "Investor receipt without a sub-ledger key",
      lines: [
        { accountCode: "1000", debit: "40000.0000", credit: "0.0000" },
        { accountCode: "2000", debit: "0.0000", credit: "40000.0000" }
      ]
    });
    assert.equal(missingDimension.status, 400);
    assert.equal(missingDimension.body.code, "sub_ledger_dimension_required");

    const matrixViolation = await postJson(`${base}/api/v1/accounting/vouchers`, "demo-token-project-manager", {
      ...scope,
      voucherType: "Sales",
      narration: "Sales into a liability",
      lines: [
        { accountCode: "1000", debit: "100.0000", credit: "0.0000" },
        { accountCode: "2300", debit: "0.0000", credit: "100.0000" }
      ]
    });
    assert.equal(matrixViolation.status, 409);
    assert.equal(matrixViolation.body.code, "posting_matrix_violation");

    const receipt = await postJson(`${base}/api/v1/accounting/vouchers`, "demo-token-project-manager", {
      ...scope,
      voucherType: "Receipt",
      narration: "Investor capital receipt",
      references: { investorId: "investor_001" },
      lines: [
        { accountCode: "1000", debit: "40000.0000", credit: "0.0000" },
        { accountCode: "2000", debit: "0.0000", credit: "40000.0000", investorId: "investor_001" }
      ]
    });
    assert.equal(receipt.status, 200);
    await runVoucherToPosted({ base, scope, voucherId: receipt.body.data.voucher.voucherId });

    const subLedger = await getJson(`${base}/api/v1/accounting/reports/sub-ledger?${query}&subLedger=Investor`, "demo-token-account-manager");
    assert.equal(subLedger.body.data.report.rows[0].subLedgerKey, "investor_001");
    assert.equal(subLedger.body.data.report.rows[0].balance, "40000.0000");
    assert.equal(subLedger.body.data.report.meta.checksum.length, 64);

    const reconciliation = await getJson(`${base}/api/v1/accounting/reports/sub-ledger-reconciliation?${query}`, "demo-token-account-manager");
    assert.equal(reconciliation.body.data.report.reconciled, true);

    const balanceSheet = await getJson(`${base}/api/v1/accounting/reports/balance-sheet?${query}`, "demo-token-auditor");
    assert.equal(balanceSheet.status, 200);
    assert.equal(balanceSheet.body.data.report.balanced, true);
    assert.equal(balanceSheet.body.data.report.assetTotal, "65000.0000");

    const bankBook = await getJson(`${base}/api/v1/accounting/reports/bank-book?${query}`, "demo-token-account-manager");
    assert.equal(bankBook.body.data.report.closingBalance, "65000.0000");

    const cashFlow = await getJson(`${base}/api/v1/accounting/reports/cash-flow?${query}`, "demo-token-account-manager");
    assert.equal(cashFlow.body.data.report.balanced, true);
    assert.equal(cashFlow.body.data.report.inflowTotal, "65000.0000");

    const utilization = await getJson(`${base}/api/v1/accounting/reports/fund-utilization?${query}`, "demo-token-account-manager");
    assert.equal(utilization.body.data.report.fundsRaised, "40000.0000");

    const cashBook = await getJson(`${base}/api/v1/accounting/reports/cash-book?${query}`, "demo-token-account-manager");
    assert.equal(cashBook.body.data.report.rows.length, 0);
    assert.equal(cashBook.body.data.report.meta.report, "cash-book");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("phase 7 cleared payments draft a receipt voucher that humans must still post", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    const scope = { organizationId: "org_demo", projectId: "project_energy_001" };
    const commitmentId = await createReconciledHolding({ base, scope });

    const ledger = await getJson(
      `${base}/api/v1/accounting/reports/sub-ledger?organizationId=org_demo&projectId=project_energy_001&subLedger=Investor`,
      "demo-token-account-manager"
    );
    assert.equal(ledger.body.data.report.rows.length, 1);
    assert.equal(ledger.body.data.report.rows[0].subLedgerKey, "investor_approved_001");
    assert.equal(ledger.body.data.report.rows[0].balance, "100000.0000");

    const reconciliation = await getJson(
      `${base}/api/v1/accounting/reports/sub-ledger-reconciliation?organizationId=org_demo&projectId=project_energy_001`,
      "demo-token-account-manager"
    );
    assert.equal(reconciliation.body.data.report.reconciled, true);
    assert.ok(commitmentId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function runVoucherToPosted({ base, scope, voucherId, creatorToken = "demo-token-project-manager", checkerToken = "demo-token-account-manager" }) {
  await postJson(`${base}/api/v1/accounting/vouchers/submit`, creatorToken, { ...scope, voucherId });
  await postJson(`${base}/api/v1/accounting/vouchers/check`, checkerToken, { ...scope, voucherId });
  await postJson(`${base}/api/v1/accounting/vouchers/authorize`, "demo-token-voucher-authorizer", { ...scope, voucherId });
  return postJson(`${base}/api/v1/accounting/vouchers/post`, "demo-token-voucher-authorizer", { ...scope, voucherId });
}


test("phase 11 dashboards reconcile to the ledger and mark restricted tiles", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    const scope = { organizationId: "org_demo", projectId: "project_agro_001" };
    const query = "organizationId=org_demo&projectId=project_agro_001";

    await postLedgerVoucher({ base, scope, voucherType: "Receipt", lines: [
      { accountCode: "1000", debit: "70000.0000", credit: "0.0000" },
      { accountCode: "2000", debit: "0.0000", credit: "70000.0000", investorId: "investor_001" }
    ] });
    await postLedgerVoucher({ base, scope, voucherType: "Payment", attachments: [{ documentRef: "object://synthetic/advice" }], lines: [
      { accountCode: "5000", debit: "20000.0000", credit: "0.0000" },
      { accountCode: "1000", debit: "0.0000", credit: "20000.0000" }
    ] });

    const dashboard = await getJson(`${base}/api/v1/dashboards/project?${query}`, "demo-token-account-manager");
    assert.equal(dashboard.status, 200);
    const bankBook = await getJson(`${base}/api/v1/accounting/reports/bank-book?${query}`, "demo-token-account-manager");
    assert.equal(
      dashboard.body.data.dashboard.controlTotals.bankBookClosing,
      bankBook.body.data.report.closingBalance
    );
    assert.equal(dashboard.body.data.dashboard.controlTotals.investorCapitalControl, "70000.0000");
    assert.equal(dashboard.body.data.dashboard.controlTotals.balanceSheetBalanced, true);
    assert.equal(dashboard.body.data.dashboard.controlTotals.subLedgerReconciled, true);
    assert.ok(dashboard.body.data.dashboard.meta.generatedAt);

    const restricted = await getJson(`${base}/api/v1/dashboards/project?${query}`, "demo-token-project-manager");
    const cashTile = restricted.body.data.dashboard.tiles.find((tile) => tile.label === "Cash at bank");
    assert.equal(cashTile.restricted, true);
    assert.equal(cashTile.value, null);

    const portfolio = await getJson(`${base}/api/v1/dashboards/administrator?organizationId=org_demo`, "demo-token-project-admin");
    assert.equal(portfolio.body.data.dashboard.controlTotals.portfolioCash, "50000.0000");

    const investorDashboard = await getJson(`${base}/api/v1/dashboards/investor?organizationId=org_demo`, "demo-token-investor-approved");
    assert.equal(investorDashboard.body.data.dashboard.investorId, "investor_approved_001");
    assert.equal(investorDashboard.body.data.dashboard.kyc.status, "Approved");

    const narrative = await getJson(`${base}/api/v1/reports/narrative?${query}&reportKey=fund-utilization`, "demo-token-account-manager");
    assert.equal(narrative.body.data.narrative.authoritative, false);
    assert.equal(narrative.body.data.narrative.requiresHumanReview, true);
    assert.ok(narrative.body.data.narrative.sentences.every((sentence) => sentence.citation.includes("@")));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("phase 11 sensitive exports are approved, masked, watermarked, and audited", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    const scope = { organizationId: "org_demo", projectId: "project_agro_001" };

    await postLedgerVoucher({ base, scope, voucherType: "Receipt", lines: [
      { accountCode: "1000", debit: "30000.0000", credit: "0.0000" },
      { accountCode: "2000", debit: "0.0000", credit: "30000.0000", investorId: "investor_001" }
    ] });

    const catalogue = await getJson("http://127.0.0.1:" + port + "/api/v1/reports?organizationId=org_demo&projectId=project_agro_001", "demo-token-account-manager");
    assert.ok(catalogue.body.data.reports.some((report) => report.reportKey === "investor-sub-ledger" && report.sensitive));

    const unmasked = await postJson(`${base}/api/v1/exports`, "demo-token-account-manager", {
      ...scope,
      reportKey: "investor-sub-ledger",
      format: "csv",
      masking: "unmasked",
      purpose: "Regulator information request"
    });
    assert.equal(unmasked.status, 201);
    assert.equal(unmasked.body.data.exportRequest.status, "Pending Approval");

    const early = await postJson(`${base}/api/v1/exports/generate`, "demo-token-account-manager", {
      organizationId: "org_demo",
      exportRequestId: unmasked.body.data.exportRequest.exportRequestId
    });
    assert.equal(early.status, 409);
    assert.equal(early.body.code, "export_not_approved");

    const selfApprove = await postJson(`${base}/api/v1/exports/approve`, "demo-token-account-manager", {
      organizationId: "org_demo",
      exportRequestId: unmasked.body.data.exportRequest.exportRequestId
    });
    assert.equal(selfApprove.status, 403);

    await postJson(`${base}/api/v1/exports/approve`, "demo-token-compliance", {
      organizationId: "org_demo",
      exportRequestId: unmasked.body.data.exportRequest.exportRequestId
    });
    const generated = await postJson(`${base}/api/v1/exports/generate`, "demo-token-account-manager", {
      organizationId: "org_demo",
      exportRequestId: unmasked.body.data.exportRequest.exportRequestId
    });
    assert.equal(generated.status, 200);
    assert.match(generated.body.data.generated.watermark, /Approved by user_compliance_001/);
    assert.ok(generated.body.data.generated.content.includes("investor_001"));

    const masked = await postJson(`${base}/api/v1/exports`, "demo-token-account-manager", {
      ...scope,
      reportKey: "investor-sub-ledger",
      format: "csv",
      masking: "masked",
      purpose: "Routine finance pack"
    });
    assert.equal(masked.body.data.exportRequest.status, "Approved");
    const maskedOutput = await postJson(`${base}/api/v1/exports/generate`, "demo-token-account-manager", {
      organizationId: "org_demo",
      exportRequestId: masked.body.data.exportRequest.exportRequestId
    });
    assert.ok(!maskedOutput.body.data.generated.content.includes("investor_001"));

    const token = maskedOutput.body.data.generated.downloadGrant.token;
    const wrongUser = await postJson(`${base}/api/v1/documents/downloads`, "demo-token-auditor", { token });
    assert.equal(wrongUser.status, 403);

    const download = await postJson(`${base}/api/v1/documents/downloads`, "demo-token-account-manager", { token });
    assert.equal(download.status, 200);
    assert.equal(download.body.data.download.contentHash, maskedOutput.body.data.generated.checksum);

    const replay = await postJson(`${base}/api/v1/documents/downloads`, "demo-token-account-manager", { token });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.code, "download_grant_exhausted");

    const accessLog = await getJson(`${base}/api/v1/documents/access-log?organizationId=org_demo`, "demo-token-auditor");
    assert.deepEqual(accessLog.body.data.accessLog.map((entry) => entry.outcome), ["Downloaded", "Exhausted"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("phase 11 documents version, extract with human verification, and notifications deliver with retry", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;

    const document = await postJson(`${base}/api/v1/documents`, "demo-token-project-admin", {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      documentType: "KYC",
      title: "Synthetic identity evidence",
      documentRef: "object://synthetic/kyc-v1",
      contentHash: "a".repeat(64),
      classification: "Restricted Identity",
      investorId: "investor_001"
    });
    assert.equal(document.status, 201);

    const versioned = await postJson(`${base}/api/v1/documents/versions`, "demo-token-project-admin", {
      organizationId: "org_demo",
      documentId: document.body.data.document.documentId,
      documentRef: "object://synthetic/kyc-v2",
      contentHash: "b".repeat(64),
      reason: "Investor supplied a clearer scan."
    });
    assert.equal(versioned.body.data.document.currentVersion, 2);

    const extraction = await postJson(`${base}/api/v1/documents/extractions`, "demo-token-project-admin", {
      organizationId: "org_demo",
      documentId: document.body.data.document.documentId,
      documentVersionId: versioned.body.data.document.currentVersionId,
      fields: { identityFingerprint: "nid_hash_synthetic_9001" },
      confidence: "0.8800"
    });
    assert.equal(extraction.status, 201);
    assert.equal(extraction.body.data.extraction.authoritative, false);

    const selfVerify = await postJson(`${base}/api/v1/documents/extractions/verify`, "demo-token-project-admin", {
      organizationId: "org_demo",
      extractionId: extraction.body.data.extraction.extractionId
    });
    assert.equal(selfVerify.status, 403);

    const verified = await postJson(`${base}/api/v1/documents/extractions/verify`, "demo-token-compliance", {
      organizationId: "org_demo",
      extractionId: extraction.body.data.extraction.extractionId
    });
    assert.equal(verified.body.data.extraction.authoritative, true);

    const detail = await getJson(
      `${base}/api/v1/documents/detail?organizationId=org_demo&documentId=${document.body.data.document.documentId}`,
      "demo-token-compliance"
    );
    assert.ok(!JSON.stringify(detail.body).includes("nid_hash_synthetic_9001"));

    await postJson(`${base}/api/v1/notifications/preferences`, "demo-token-project-admin", {
      organizationId: "org_demo",
      userId: "user_investor_001",
      locale: "bn"
    }, {}, "PATCH");

    const queued = await postJson(`${base}/api/v1/notifications`, "demo-token-project-admin", {
      organizationId: "org_demo",
      templateKey: "kyc.approved",
      channel: "Email",
      recipientUserId: "user_investor_001",
      recipientAddress: "investor1@example.test",
      data: { investorName: "Synthetic Investor One" }
    });
    assert.equal(queued.status, 201);
    assert.equal(queued.body.data.notification.locale, "bn");
    assert.equal(queued.body.data.notification.recipientAddressMasked, "i***@example.test");
    assert.ok(!JSON.stringify(queued.body).includes("investor1@example.test"));

    const run = await postJson(`${base}/api/v1/notifications/process-queue`, "demo-token-project-admin", {
      organizationId: "org_demo"
    });
    assert.equal(run.body.data.run.delivered, 1);

    const attempts = await getJson(`${base}/api/v1/notifications/delivery-attempts?organizationId=org_demo`, "demo-token-project-admin");
    assert.equal(attempts.body.data.attempts.length, 1);
    assert.equal(attempts.body.data.attempts[0].outcome, "Delivered");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function postLedgerVoucher({ base, scope, voucherType, lines, attachments = [] }) {
  const voucher = await postJson(`${base}/api/v1/accounting/vouchers`, "demo-token-project-manager", {
    ...scope,
    voucherType,
    narration: "Synthetic reporting fixture",
    attachments,
    lines
  });
  const voucherId = voucher.body.data.voucher.voucherId;
  await postJson(`${base}/api/v1/accounting/vouchers/submit`, "demo-token-project-manager", { ...scope, voucherId });
  await postJson(`${base}/api/v1/accounting/vouchers/check`, "demo-token-account-manager", { ...scope, voucherId });
  await postJson(`${base}/api/v1/accounting/vouchers/authorize`, "demo-token-voucher-authorizer", { ...scope, voucherId });
  return postJson(`${base}/api/v1/accounting/vouchers/post`, "demo-token-voucher-authorizer", { ...scope, voucherId });
}


test("phase 12 complaint lifecycle, SLA, and advisory AI classification are controlled over the API", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    const scope = { organizationId: "org_demo", projectId: "project_agro_001" };

    const complaint = await postJson(`${base}/api/v1/complaints`, "demo-token-investor-approved", {
      ...scope,
      category: "Other",
      severity: "Low",
      subject: "Money deducted twice",
      description: "A payment was deducted twice and no refund has arrived."
    });
    assert.equal(complaint.status, 201);
    const complaintId = complaint.body.data.complaint.complaintId;
    assert.equal(complaint.body.data.complaint.status, "Registered");
    assert.ok(complaint.body.data.complaint.acknowledgeDueAt);

    const classification = await getJson(
      `${base}/api/v1/complaints/classification?organizationId=org_demo&complaintId=${complaintId}`,
      "demo-token-compliance"
    );
    assert.equal(classification.body.data.classification.authoritative, false);
    assert.equal(classification.body.data.classification.requiresHumanApproval, true);
    assert.equal(classification.body.data.classification.suggestedCategory, "Payment");

    const stillUnchanged = await getJson(
      `${base}/api/v1/complaints/detail?organizationId=org_demo&complaintId=${complaintId}`,
      "demo-token-compliance"
    );
    assert.equal(stillUnchanged.body.data.complaint.category, "Other");

    const noRationale = await postJson(`${base}/api/v1/complaints/classification`, "demo-token-compliance", {
      organizationId: "org_demo",
      complaintId,
      category: "Payment",
      severity: "High"
    });
    assert.equal(noRationale.status, 400);
    assert.equal(noRationale.body.code, "classification_rationale_required");

    const applied = await postJson(`${base}/api/v1/complaints/classification`, "demo-token-compliance", {
      organizationId: "org_demo",
      complaintId,
      category: "Payment",
      severity: "High",
      rationale: "Investor confirmed a double debit with bank evidence."
    });
    assert.equal(applied.body.data.complaint.severity, "High");
    assert.equal(applied.body.data.complaint.classification.appliedByUserId, "user_compliance_001");

    await postJson(`${base}/api/v1/complaints/triage`, "demo-token-compliance", { organizationId: "org_demo", complaintId });
    await postJson(`${base}/api/v1/complaints/assign`, "demo-token-compliance", { organizationId: "org_demo", complaintId, assignedToUserId: "user_accounts_001" });
    await postJson(`${base}/api/v1/complaints/start`, "demo-token-compliance", { organizationId: "org_demo", complaintId });

    const resolved = await postJson(`${base}/api/v1/complaints/resolve`, "demo-token-compliance", {
      organizationId: "org_demo",
      complaintId,
      resolution: "Duplicate debit refunded and reconciliation corrected."
    });
    assert.equal(resolved.body.data.complaint.status, "Resolved");

    const closed = await postJson(`${base}/api/v1/complaints/close`, "demo-token-project-admin", { organizationId: "org_demo", complaintId });
    assert.equal(closed.body.data.complaint.status, "Closed");

    const appealed = await postJson(`${base}/api/v1/complaints/appeal`, "demo-token-investor-approved", {
      organizationId: "org_demo",
      complaintId,
      reason: "The bank charge was not refunded."
    });
    assert.equal(appealed.body.data.complaint.status, "Under Appeal");

    const investorQueue = await getJson(`${base}/api/v1/complaints?organizationId=org_demo&projectId=project_agro_001`, "demo-token-investor-approved");
    assert.equal(investorQueue.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("phase 12 whistleblowing withholds the reporter and rules drive cases and holds", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    const scope = { organizationId: "org_demo", projectId: "project_agro_001" };

    const report = await postJson(`${base}/api/v1/complaints`, "demo-token-investor-approved", {
      ...scope,
      category: "Suspected Fraud",
      subject: "Suspected forged invoices",
      description: "Invoices appear forged and funds may have been diverted.",
      investorId: "investor_approved_001"
    });
    assert.equal(report.status, 201);
    assert.equal(report.body.data.complaint.whistleblowing, true);
    assert.equal(report.body.data.complaint.reportedByUserId, null);
    assert.ok(!JSON.stringify(report.body).includes("user_investor_approved_001"));

    const cases = await getJson(`${base}/api/v1/compliance-cases?organizationId=org_demo`, "demo-token-compliance");
    assert.equal(cases.body.data.cases.length, 1);
    assert.equal(cases.body.data.cases[0].source, "Whistleblowing");

    const signal = await postJson(`${base}/api/v1/compliance-signals`, "demo-token-compliance", {
      ...scope,
      signalType: "Fraud Signal",
      payload: { confirmed: true, investorId: "investor_001" }
    });
    assert.equal(signal.status, 201);
    assert.equal(signal.body.data.signal.createdHoldIds.length, 1);
    assert.deepEqual(signal.body.data.signal.matchedRuleIds, ["rule_seed_fraud_signal"]);

    const holds = await getJson(`${base}/api/v1/governance/holds?organizationId=org_demo&status=Active`, "demo-token-compliance");
    assert.equal(holds.body.data.holds.length, 1);
    const holdId = holds.body.data.holds[0].holdId;

    const selfRelease = await postJson(`${base}/api/v1/governance/holds/release`, "demo-token-compliance", {
      organizationId: "org_demo",
      holdId,
      reason: "Self release attempt."
    });
    assert.equal(selfRelease.status, 403);

    const released = await postJson(`${base}/api/v1/governance/holds/release`, "demo-token-project-admin", {
      organizationId: "org_demo",
      holdId,
      reason: "Investigation closed with no finding."
    });
    assert.equal(released.body.data.hold.status, "Released");

    const drafted = await postJson(`${base}/api/v1/compliance-rules`, "demo-token-compliance", {
      organizationId: "org_demo",
      name: "Large single payment",
      source: "Payment",
      severity: "High",
      conditions: [{ field: "amount", operator: "greaterThan", value: 1000000 }],
      action: { type: "open-case" }
    });
    assert.equal(drafted.status, 201);

    const selfApprove = await postJson(`${base}/api/v1/compliance-rules/approve`, "demo-token-compliance", {
      organizationId: "org_demo",
      ruleId: drafted.body.data.rule.ruleId
    });
    assert.equal(selfApprove.status, 403);

    const approved = await postJson(`${base}/api/v1/compliance-rules/approve`, "demo-token-project-admin", {
      organizationId: "org_demo",
      ruleId: drafted.body.data.rule.ruleId
    });
    assert.equal(approved.body.data.rule.status, "Approved");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("phase 12 audit portal traces history read-only and seals verifiable evidence packages", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://127.0.0.1:${port}`;
    const scope = { organizationId: "org_demo", projectId: "project_agro_001" };

    const complaint = await postJson(`${base}/api/v1/complaints`, "demo-token-investor-approved", {
      ...scope,
      category: "Disclosure",
      severity: "Medium",
      subject: "Offer wording unclear",
      description: "The published offer wording is unclear about fees."
    });
    const complaintId = complaint.body.data.complaint.complaintId;
    await postJson(`${base}/api/v1/complaints/triage`, "demo-token-compliance", { organizationId: "org_demo", complaintId });

    const before = await getJson(`${base}/api/v1/complaints/detail?organizationId=org_demo&complaintId=${complaintId}`, "demo-token-compliance");
    const history = await getJson(
      `${base}/api/v1/audit-portal/entity-history?organizationId=org_demo&entityType=Complaint&entityId=${complaintId}`,
      "demo-token-auditor"
    );
    const after = await getJson(`${base}/api/v1/complaints/detail?organizationId=org_demo&complaintId=${complaintId}`, "demo-token-compliance");
    // Compare stored state only. The envelope correlation id and the clock-derived SLA countdown
    // legitimately differ between two reads; the record behind them must not.
    const storedState = (payload) => {
      const { sla, ...rest } = payload.body.data.complaint;
      return rest;
    };
    assert.deepEqual(storedState(after), storedState(before), "an audit read must not change the record it traces");
    assert.ok(history.body.data.history.events.length >= 2);
    assert.equal(history.body.data.history.meta.checksum.length, 64);

    const trail = await getJson(`${base}/api/v1/audit-portal/trail?organizationId=org_demo&actionPrefix=cases.complaint.`, "demo-token-auditor");
    assert.ok(trail.body.data.trail.events.every((event) => event.action.startsWith("cases.complaint.")));

    const investorDenied = await getJson(`${base}/api/v1/audit-portal/trail?organizationId=org_demo`, "demo-token-investor-approved");
    assert.equal(investorDenied.status, 403);

    const built = await postJson(`${base}/api/v1/audit-portal/evidence-packages`, "demo-token-auditor", {
      ...scope,
      title: "Disclosure complaint pack",
      purpose: "Independent review of a disclosure complaint",
      entityRefs: [{ entityType: "Complaint", entityId: complaintId }]
    });
    assert.equal(built.status, 201);
    const evidencePackageId = built.body.data.evidencePackage.evidencePackageId;

    const sealed = await postJson(`${base}/api/v1/audit-portal/evidence-packages/seal`, "demo-token-auditor", {
      organizationId: "org_demo",
      evidencePackageId
    });
    assert.equal(sealed.body.data.evidencePackage.status, "Sealed");
    assert.equal(sealed.body.data.evidencePackage.manifestChecksum.length, 64);

    const verified = await getJson(
      `${base}/api/v1/audit-portal/evidence-packages/verify?organizationId=org_demo&evidencePackageId=${evidencePackageId}`,
      "demo-token-auditor"
    );
    assert.equal(verified.body.data.verification.manifestIntact, true);
    assert.equal(verified.body.data.verification.allArtefactsUnchanged, true);

    await postJson(`${base}/api/v1/complaints/assign`, "demo-token-compliance", { organizationId: "org_demo", complaintId, assignedToUserId: "user_accounts_001" });
    const reverified = await getJson(
      `${base}/api/v1/audit-portal/evidence-packages/verify?organizationId=org_demo&evidencePackageId=${evidencePackageId}`,
      "demo-token-auditor"
    );
    assert.equal(reverified.body.data.verification.manifestIntact, true);
    assert.equal(reverified.body.data.verification.allArtefactsUnchanged, false);

    const governance = await getJson(`${base}/api/v1/governance/report?organizationId=org_demo&projectId=project_agro_001`, "demo-token-project-admin");
    assert.equal(governance.body.data.report.complaints.total, 1);
    assert.equal(governance.body.data.report.meta.boardReady, true);

    const templates = await getJson(`${base}/api/v1/governance/regulatory-templates?organizationId=org_demo`, "demo-token-compliance");
    assert.ok(templates.body.data.templates.every((template) => template.approved === false));

    const regulatory = await getJson(
      `${base}/api/v1/governance/regulatory-report?organizationId=org_demo&projectId=project_agro_001&templateKey=complaint-handling-summary`,
      "demo-token-compliance"
    );
    assert.equal(regulatory.body.data.report.approvedForSubmission, false);
    assert.match(regulatory.body.data.report.submissionBlockedReason, /awaits compliance owner approval/);

    const unknown = await getJson(
      `${base}/api/v1/governance/regulatory-report?organizationId=org_demo&templateKey=made-up-return`,
      "demo-token-compliance"
    );
    assert.equal(unknown.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function postJson(url, token, body, extraHeaders = {}, method = "POST") {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    body: await response.json()
  };
}
