import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccountingService } from "../../accounting/src/index.js";
import { createDistributionService } from "../../distributions/src/index.js";
import { createDocumentService } from "../../documents/src/index.js";
import { createIdentityService } from "../../identity/src/index.js";
import { createInvestmentService } from "../../investments/src/index.js";
import { createInvestorService } from "../../investors/src/index.js";
import { createOperationsService } from "../../operations/src/index.js";
import { createPaymentService } from "../../payments/src/index.js";
import { createMutableSyntheticProjects, createProjectService } from "../../projects/src/index.js";
import { REPORT_CATALOGUE, createReportingService, maskValue, toCsv } from "../src/index.js";

const ORG = "org_demo";
const PROJECT = "project_agro_001";

test("project dashboard ties every financial tile back to the authoritative ledger", () => {
  const world = buildWorld();
  seedLedger(world, [
    { investorId: "investor_001", amount: "60000.0000" },
    { investorId: "investor_approved_001", amount: "40000.0000" }
  ], { expense: "25000.0000" });

  const dashboard = world.reporting.getProjectDashboard({
    principal: world.accountManager,
    organizationId: ORG,
    projectId: PROJECT
  });

  const bankBook = world.accounting.getBankBook({ principal: world.accountManager, organizationId: ORG, projectId: PROJECT });
  const investorLedger = world.accounting.getSubLedger({ principal: world.accountManager, organizationId: ORG, projectId: PROJECT, subLedger: "Investor" });
  const investorControl = investorLedger.rows.reduce((total, row) => total + Number(row.balance), 0);

  assert.equal(dashboard.controlTotals.bankBookClosing, bankBook.closingBalance);
  assert.equal(Number(dashboard.controlTotals.investorCapitalControl).toFixed(4), investorControl.toFixed(4));
  assert.equal(dashboard.controlTotals.balanceSheetBalanced, true);
  assert.equal(dashboard.controlTotals.subLedgerReconciled, true);
  assert.equal(dashboard.controlTotals.ledgerChecksum.length, 64);

  const cashTile = dashboard.tiles.find((tile) => tile.label === "Cash at bank");
  const capitalTile = dashboard.tiles.find((tile) => tile.label === "Investor capital");
  assert.equal(cashTile.value, "75000.0000");
  assert.equal(capitalTile.value, "100000.0000");
  assert.ok(dashboard.tiles.every((tile) => tile.source));
  // An account manager holds every ledger permission, so no financial source may be withheld.
  const restrictedSources = dashboard.restricted.map((entry) => entry.source);
  for (const financialSource of ["balanceSheet", "bankBook", "profitAndLoss", "utilization", "reconciliation", "investorLedger"]) {
    assert.ok(!restrictedSources.includes(financialSource), `${financialSource} must not be restricted for an account manager`);
  }
  assert.ok(dashboard.meta.generatedAt);
  assert.equal(dashboard.meta.source, "authoritative-ledger-read-through");
});

test("dashboards degrade to restricted tiles instead of failing for limited roles", () => {
  const world = buildWorld();
  seedLedger(world, [{ investorId: "investor_001", amount: "10000.0000" }]);

  const dashboard = world.reporting.getProjectDashboard({
    principal: world.projectManager,
    organizationId: ORG,
    projectId: PROJECT
  });

  const cashTile = dashboard.tiles.find((tile) => tile.label === "Cash at bank");
  assert.equal(cashTile.value, null);
  assert.equal(cashTile.restricted, true);
  assert.equal(cashTile.restrictionCode, "permission_denied");
  assert.ok(dashboard.restricted.some((entry) => entry.source === "bankBook"));

  const budgetTile = dashboard.tiles.find((tile) => tile.label === "Active holdings");
  assert.equal(budgetTile.restricted, false);
});

test("administrator dashboard aggregates portfolio cash and result across projects", () => {
  const world = buildWorld();
  seedLedger(world, [{ investorId: "investor_001", amount: "80000.0000" }], { expense: "30000.0000" });

  const dashboard = world.reporting.getAdministratorDashboard({
    principal: world.administrator,
    organizationId: ORG
  });

  assert.equal(dashboard.controlTotals.projectCount, dashboard.projects.length);
  assert.equal(dashboard.controlTotals.portfolioCash, "50000.0000");
  assert.equal(dashboard.controlTotals.portfolioResult, "-30000.0000");
  const agro = dashboard.projects.find((project) => project.projectId === PROJECT);
  assert.equal(agro.cash, "50000.0000");
  assert.equal(agro.expense, "30000.0000");
});

test("investor dashboard reports capital, distributions, and KYC actions", () => {
  const world = buildWorld();
  const dashboard = world.reporting.getInvestorDashboard({
    principal: world.investor,
    organizationId: ORG
  });

  assert.equal(dashboard.investorId, "investor_approved_001");
  assert.equal(dashboard.kyc.status, "Approved");
  assert.equal(dashboard.kyc.actionRequired, false);
  assert.deepEqual(dashboard.tiles.map((tile) => tile.label), [
    "Invested capital",
    "Pending capital",
    "Distributions paid",
    "Distributions pending"
  ]);
  assert.equal(dashboard.controlTotals.statementGross, "0.0000");
});

test("report catalogue runs against authoritative sources and carries as-of metadata", () => {
  const world = buildWorld();
  seedLedger(world, [{ investorId: "investor_001", amount: "20000.0000" }]);

  const catalogue = world.reporting.listReports({ principal: world.accountManager, organizationId: ORG, projectId: PROJECT });
  assert.equal(catalogue.length, REPORT_CATALOGUE.length);
  assert.ok(catalogue.some((report) => report.reportKey === "investor-statement" && report.sensitive));

  const balanceSheet = world.reporting.runReport({
    principal: world.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    reportKey: "balance-sheet"
  });
  assert.equal(balanceSheet.summary.balanced, true);
  assert.equal(balanceSheet.meta.checksum.length, 64);
  assert.ok(balanceSheet.meta.asOf);

  const statement = world.reporting.runReport({
    principal: world.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    reportKey: "project-statement"
  });
  assert.equal(statement.rows.find((row) => row.measure === "Funds raised").amount, "20000.0000");

  assert.throws(() => world.reporting.runReport({
    principal: world.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    reportKey: "not-a-report"
  }), /Unknown report/);
});

test("masked exports need no approval while unmasked sensitive exports need an independent approver", () => {
  const world = buildWorld();
  seedLedger(world, [{ investorId: "investor_001", amount: "35000.0000" }]);

  const masked = world.reporting.requestExport({
    principal: world.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    reportKey: "investor-sub-ledger",
    format: "csv",
    masking: "masked",
    purpose: "Monthly finance pack",
    correlationId: "corr_masked"
  });
  assert.equal(masked.requiresApproval, false);
  assert.equal(masked.status, "Approved");

  const maskedOutput = world.reporting.generateExport({
    principal: world.accountManager,
    organizationId: ORG,
    exportRequestId: masked.exportRequestId,
    correlationId: "corr_masked_generate"
  });
  assert.match(maskedOutput.watermark, /Masking masked/);
  assert.match(maskedOutput.content, /^# CrowdFund360 controlled export/);
  assert.ok(!maskedOutput.content.includes("investor_001"));
  assert.ok(maskedOutput.content.includes(maskValue("investor_001")));
  assert.equal(maskedOutput.request.status, "Generated");
  assert.equal(maskedOutput.checksum.length, 64);
  assert.ok(maskedOutput.downloadGrant.token);

  const unmasked = world.reporting.requestExport({
    principal: world.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    reportKey: "investor-sub-ledger",
    format: "json",
    masking: "unmasked",
    purpose: "Regulator request",
    correlationId: "corr_unmasked"
  });
  assert.equal(unmasked.requiresApproval, true);
  assert.equal(unmasked.status, "Pending Approval");

  assert.throws(() => world.reporting.generateExport({
    principal: world.accountManager,
    organizationId: ORG,
    exportRequestId: unmasked.exportRequestId,
    correlationId: "corr_unmasked_early"
  }), /Pending Approval and cannot be generated/);

  assert.throws(() => world.reporting.approveExport({
    principal: world.accountManager,
    organizationId: ORG,
    exportRequestId: unmasked.exportRequestId,
    correlationId: "corr_unmasked_self"
  }), /not allowed to perform export:approve/);

  world.reporting.approveExport({
    principal: world.compliance,
    organizationId: ORG,
    exportRequestId: unmasked.exportRequestId,
    correlationId: "corr_unmasked_approve"
  });
  const unmaskedOutput = world.reporting.generateExport({
    principal: world.accountManager,
    organizationId: ORG,
    exportRequestId: unmasked.exportRequestId,
    correlationId: "corr_unmasked_generate"
  });
  assert.ok(unmaskedOutput.content.includes("investor_001"));
  assert.match(unmaskedOutput.watermark, /Approved by user_compliance_001/);
});

test("export generation records an auditable trail and an expiring download grant", () => {
  const world = buildWorld();
  seedLedger(world, [{ investorId: "investor_001", amount: "15000.0000" }]);

  const request = world.reporting.requestExport({
    principal: world.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    reportKey: "trial-balance",
    format: "csv",
    masking: "masked",
    purpose: "Audit sample",
    correlationId: "corr_audit_export"
  });
  const output = world.reporting.generateExport({
    principal: world.accountManager,
    organizationId: ORG,
    exportRequestId: request.exportRequestId,
    correlationId: "corr_audit_generate"
  });

  const download = world.documents.redeemDownloadGrant({
    token: output.downloadGrant.token,
    actorUserId: "user_accounts_001",
    correlationId: "corr_audit_download"
  });
  assert.equal(download.contentHash, output.checksum);
  assert.match(download.watermark, /Issued to user_accounts_001/);

  const accessLog = world.documents.listAccessLog({ principal: world.auditor, organizationId: ORG });
  assert.equal(accessLog.at(-1).outcome, "Downloaded");

  const events = world.reporting.getAuditEvents();
  assert.ok(events.some((event) => event.action === "reporting.export.request"));
  assert.ok(events.some((event) => event.action === "reporting.export.generate"));

  const rejected = world.reporting.requestExport({
    principal: world.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    reportKey: "investor-statement",
    format: "csv",
    masking: "unmasked",
    purpose: "Ad hoc",
    correlationId: "corr_reject"
  });
  world.reporting.rejectExport({
    principal: world.compliance,
    organizationId: ORG,
    exportRequestId: rejected.exportRequestId,
    reason: "Purpose is not specific enough for an unmasked investor export.",
    correlationId: "corr_reject_do"
  });
  const listed = world.reporting.listExportRequests({ principal: world.accountManager, organizationId: ORG, projectId: PROJECT });
  assert.equal(listed.find((entry) => entry.exportRequestId === rejected.exportRequestId).status, "Rejected");
});

test("export requests validate format, masking mode, and purpose", () => {
  const world = buildWorld();
  for (const [payload, expected] of [
    [{ format: "xlsx" }, /Unsupported export format/],
    [{ masking: "raw" }, /Unsupported masking mode/],
    [{ purpose: undefined }, /requires a stated purpose/]
  ]) {
    assert.throws(() => world.reporting.requestExport({
      principal: world.accountManager,
      organizationId: ORG,
      projectId: PROJECT,
      reportKey: "trial-balance",
      format: "csv",
      masking: "masked",
      purpose: "Valid purpose",
      correlationId: "corr_validate",
      ...payload
    }), expected);
  }
});

test("AI narratives cite an approved report and never claim authority", () => {
  const world = buildWorld();
  seedLedger(world, [{ investorId: "investor_001", amount: "45000.0000" }], { expense: "5000.0000" });

  const narrative = world.reporting.draftReportNarrative({
    principal: world.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    reportKey: "fund-utilization"
  });

  assert.equal(narrative.authoritative, false);
  assert.equal(narrative.requiresHumanReview, true);
  assert.equal(narrative.generatedFrom.reportKey, "fund-utilization");
  assert.equal(narrative.generatedFrom.checksum.length, 64);
  assert.ok(narrative.sentences.length > 0);
  assert.ok(narrative.sentences.every((sentence) => sentence.citation.startsWith("fund-utilization@")));
  assert.match(narrative.narrative, /Funds raised is 45000.0000/);
});

test("csv rendering escapes separators and quotes", () => {
  const csv = toCsv([
    { measure: "Revenue, net", amount: "10.0000" },
    { measure: 'Quoted "value"', amount: "20.0000", note: "extra" }
  ]);
  const lines = csv.split("\n");
  assert.equal(lines[0], "measure,amount,note");
  assert.equal(lines[1], '"Revenue, net",10.0000,');
  assert.equal(lines[2], '"Quoted ""value""",20.0000,extra');
  assert.equal(toCsv([]), "");
});

function buildWorld() {
  const identity = createIdentityService();
  const projectService = createProjectService({ identity, projects: createMutableSyntheticProjects() });
  const investorService = createInvestorService({ identity });
  const investmentService = createInvestmentService({ identity, investorService, projectService });
  const accounting = createAccountingService({ identity });
  const paymentService = createPaymentService({ identity, investmentService, accountingService: accounting });
  const operationsService = createOperationsService({ identity, accountingService: accounting });
  const distributionService = createDistributionService({
    identity,
    accountingService: accounting,
    investmentService,
    investorService
  });
  const documents = createDocumentService({ identity, investorService });
  const reporting = createReportingService({
    identity,
    accountingService: accounting,
    investmentService,
    investorService,
    paymentService,
    operationsService,
    projectService,
    distributionService,
    documentService: documents
  });

  return {
    identity,
    accounting,
    documents,
    reporting,
    projectManager: identity.authenticate("Bearer demo-token-project-manager"),
    accountManager: identity.authenticate("Bearer demo-token-account-manager"),
    secondAccountManager: identity.authenticate("Bearer demo-token-account-manager-two"),
    authorizer: identity.authenticate("Bearer demo-token-voucher-authorizer"),
    administrator: identity.authenticate("Bearer demo-token-project-admin"),
    compliance: identity.authenticate("Bearer demo-token-compliance"),
    auditor: identity.authenticate("Bearer demo-token-auditor"),
    investor: identity.authenticate("Bearer demo-token-investor-approved")
  };
}

function seedLedger(world, receipts, { expense } = {}) {
  for (const receipt of receipts) {
    postVoucher(world, {
      voucherType: "Receipt",
      lines: [
        { accountCode: "1000", debit: receipt.amount, credit: "0.0000" },
        { accountCode: "2000", debit: "0.0000", credit: receipt.amount, investorId: receipt.investorId }
      ]
    });
  }
  if (expense) {
    postVoucher(world, {
      voucherType: "Payment",
      attachments: [{ documentRef: "object://synthetic/advice" }],
      lines: [
        { accountCode: "5000", debit: expense, credit: "0.0000" },
        { accountCode: "1000", debit: "0.0000", credit: expense }
      ]
    });
  }
}

function postVoucher(world, { voucherType, lines, attachments = [] }) {
  const scope = { organizationId: ORG, projectId: PROJECT };
  const voucher = world.accounting.createVoucher({
    principal: world.projectManager,
    ...scope,
    voucherType,
    narration: "Synthetic reporting fixture",
    attachments,
    lines,
    correlationId: "corr_seed"
  });
  world.accounting.submitVoucher({ principal: world.projectManager, ...scope, voucherId: voucher.voucherId, correlationId: "corr_seed_submit" });
  world.accounting.checkVoucher({ principal: world.accountManager, ...scope, voucherId: voucher.voucherId, correlationId: "corr_seed_check" });
  world.accounting.authorizeVoucher({ principal: world.authorizer, ...scope, voucherId: voucher.voucherId, correlationId: "corr_seed_authorize" });
  return world.accounting.postVoucher({ principal: world.authorizer, ...scope, voucherId: voucher.voucherId, correlationId: "corr_seed_post" });
}
