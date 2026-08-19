import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccountingService } from "../../accounting/src/index.js";
import { createIdentityService } from "../../identity/src/index.js";
import { createOperationsService } from "../src/index.js";

test("budget revision, procurement, expense, and asset registration enforce independent approval", () => {
  const identity = createIdentityService();
  const operations = createOperationsService({ identity });
  const manager = identity.authenticate("Bearer demo-token-project-manager");
  const admin = identity.authenticate("Bearer demo-token-project-admin");
  const accounts = identity.authenticate("Bearer demo-token-account-manager");

  const budget = operations.createBudgetRevision({
    principal: manager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    budgetCode: "CAPEX-EQUIPMENT",
    category: "Equipment",
    amount: "125000.0000",
    reason: "Increase equipment allocation",
    correlationId: "corr_budget"
  });
  assert.equal(budget.status, "Draft");
  assert.throws(() => operations.approveBudgetRevision({
    principal: manager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    budgetId: budget.budgetId,
    correlationId: "corr_self_approve"
  }), /not allowed|requires independent approval/);

  const approvedBudget = operations.approveBudgetRevision({
    principal: admin,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    budgetId: budget.budgetId,
    correlationId: "corr_approve_budget"
  });
  assert.equal(approvedBudget.status, "Approved");

  const procurement = operations.createProcurementRequest({
    principal: manager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    budgetCode: "CAPEX-EQUIPMENT",
    vendorName: "Synthetic Vendor",
    amount: "60000.0000",
    description: "Dryer machinery",
    correlationId: "corr_procurement"
  });
  assert.equal(procurement.status, "Requested");
  assert.equal(operations.approveProcurementRequest({
    principal: admin,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    procurementId: procurement.procurementId,
    correlationId: "corr_procurement_approve"
  }).status, "Approved");

  const expense = operations.createExpenseClaim({
    principal: manager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    budgetCode: "CAPEX-EQUIPMENT",
    procurementId: procurement.procurementId,
    amount: "55000.0000",
    invoiceRef: "INV-001",
    description: "Final equipment invoice",
    correlationId: "corr_expense"
  });
  assert.equal(operations.approveExpenseClaim({
    principal: accounts,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    expenseId: expense.expenseId,
    correlationId: "corr_expense_approve"
  }).status, "Approved");

  const asset = operations.registerAsset({
    principal: manager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    expenseId: expense.expenseId,
    assetTag: "AGRO-DRYER-001",
    assetType: "Equipment",
    custodyUserId: "user_pm_001",
    correlationId: "corr_asset"
  });
  assert.equal(asset.acquisitionCost, "55000.0000");

  const variance = operations.getBudgetVariance({
    principal: manager,
    organizationId: "org_demo",
    projectId: "project_agro_001"
  });
  assert.equal(variance[0].budgetAmount, "125000.0000");
  assert.equal(variance[0].committed, "60000.0000");
  assert.equal(variance[0].actual, "55000.0000");
});

test("operations block spend beyond approved budget", () => {
  const identity = createIdentityService();
  const operations = createOperationsService({ identity });
  const manager = identity.authenticate("Bearer demo-token-project-manager");

  assert.throws(() => operations.createProcurementRequest({
    principal: manager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    budgetCode: "CAPEX-EQUIPMENT",
    vendorName: "Synthetic Vendor",
    amount: "150000.0000",
    description: "Oversized procurement",
    correlationId: "corr_budget_block"
  }), /insufficient/);
});

test("milestone evidence and fund release require approvals and posted voucher", () => {
  const identity = createIdentityService();
  const accountingService = createAccountingService({ identity });
  const operations = createOperationsService({ identity, accountingService });
  const manager = identity.authenticate("Bearer demo-token-project-manager");
  const admin = identity.authenticate("Bearer demo-token-project-admin");
  const accounts = identity.authenticate("Bearer demo-token-account-manager");
  const compliance = identity.authenticate("Bearer demo-token-compliance");
  const authorizer = identity.authenticate("Bearer demo-token-voucher-authorizer");

  const milestone = operations.createMilestonePlan({
    principal: manager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    title: "Equipment installed",
    dueDate: "2026-08-20",
    targetAmount: "40000.0000",
    deliverables: [{ title: "Installation evidence" }],
    correlationId: "corr_milestone"
  });
  assert.equal(milestone.status, "Planned");
  assert.throws(() => operations.requestFundRelease({
    principal: manager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    milestoneId: milestone.milestoneId,
    amount: "40000.0000",
    purpose: "Premature release",
    correlationId: "corr_blocked_release"
  }), /verified/);

  const submitted = operations.submitMilestoneEvidence({
    principal: manager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    milestoneId: milestone.milestoneId,
    evidenceRef: "object://synthetic/milestone-installation",
    progressPercent: 100,
    comment: "Installation completed",
    correlationId: "corr_evidence"
  });
  assert.equal(submitted.status, "Evidence Submitted");
  assert.equal(operations.verifyMilestone({
    principal: admin,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    milestoneId: milestone.milestoneId,
    comment: "Evidence accepted",
    correlationId: "corr_verify"
  }).status, "Verified");

  const release = operations.requestFundRelease({
    principal: manager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    milestoneId: milestone.milestoneId,
    amount: "40000.0000",
    purpose: "Release equipment installment",
    correlationId: "corr_release_request"
  });
  assert.equal(release.status, "Requested");
  assert.throws(() => operations.releaseFunds({
    principal: authorizer,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    releaseId: release.releaseId,
    postedVoucherId: "missing",
    correlationId: "corr_release_early"
  }), /approval/);

  assert.equal(operations.approveFundReleaseFinance({
    principal: accounts,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    releaseId: release.releaseId,
    correlationId: "corr_finance"
  }).status, "Finance Approved");
  assert.equal(operations.approveFundReleaseCompliance({
    principal: compliance,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    releaseId: release.releaseId,
    correlationId: "corr_compliance"
  }).status, "Compliance Approved");

  const postedVoucher = createPostedVoucher({ accountingService, manager, accounts, authorizer });
  const released = operations.releaseFunds({
    principal: authorizer,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    releaseId: release.releaseId,
    postedVoucherId: postedVoucher.voucherId,
    correlationId: "corr_release"
  });
  assert.equal(released.status, "Released");
  assert.equal(released.voucher.amount, "40000.0000");
});

test("milestone delay alerts and health score explain project risk", () => {
  const identity = createIdentityService();
  const operations = createOperationsService({ identity });
  const manager = identity.authenticate("Bearer demo-token-project-manager");

  operations.createMilestonePlan({
    principal: manager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    title: "Delayed construction",
    dueDate: "2026-08-01",
    targetAmount: "10000.0000",
    deliverables: [{ title: "Photo evidence" }],
    correlationId: "corr_delayed"
  });
  const alerts = operations.listMilestoneAlerts({
    principal: manager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    asOfDate: "2026-08-17"
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, "High");

  const health = operations.getProjectHealth({
    principal: manager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    asOfDate: "2026-08-17"
  });
  assert.equal(health.rating, "Healthy");
  assert.ok(health.explanations[0].includes("Delayed construction"));
});

function createPostedVoucher({ accountingService, manager, accounts, authorizer }) {
  const voucher = accountingService.createVoucher({
    principal: manager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    voucherType: "Payment",
    narration: "Milestone fund release",
    attachments: [{ documentRef: "object://synthetic/payment-advice", description: "Bank payment advice" }],
    lines: [
      { accountCode: "5000", debit: "40000.0000", credit: "0.0000" },
      { accountCode: "1000", debit: "0.0000", credit: "40000.0000" }
    ],
    correlationId: "corr_release_voucher"
  });
  accountingService.submitVoucher({
    principal: manager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    voucherId: voucher.voucherId,
    correlationId: "corr_submit_voucher"
  });
  accountingService.checkVoucher({
    principal: accounts,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    voucherId: voucher.voucherId,
    correlationId: "corr_check_voucher"
  });
  accountingService.authorizeVoucher({
    principal: authorizer,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    voucherId: voucher.voucherId,
    correlationId: "corr_authorize_voucher"
  });
  return accountingService.postVoucher({
    principal: authorizer,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    voucherId: voucher.voucherId,
    correlationId: "corr_post_voucher"
  });
}
