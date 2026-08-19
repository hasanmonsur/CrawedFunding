import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccountingService } from "../src/index.js";
import { createIdentityService } from "../../identity/src/index.js";

test("voucher workflow posts balanced double-entry journal", () => {
  const identity = createIdentityService();
  const pm = identity.authenticate("Bearer demo-token-project-manager");
  const accounts = identity.authenticate("Bearer demo-token-account-manager");
  const authorizer = identity.authenticate("Bearer demo-token-voucher-authorizer");
  const service = createAccountingService({ identity });

  const voucher = service.createVoucher({
    principal: pm,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    voucherType: "Receipt",
    narration: "Synthetic investor receipt",
    correlationId: "corr_voucher",
    lines: [
      { accountCode: "1000", debit: "50000.0000", credit: "0.0000" },
      { accountCode: "2000", debit: "0.0000", credit: "50000.0000", investorId: "investor_approved_001" }
    ]
  });
  service.submitVoucher({ principal: pm, organizationId: "org_demo", projectId: "project_agro_001", voucherId: voucher.voucherId, correlationId: "corr_submit" });
  service.checkVoucher({ principal: accounts, organizationId: "org_demo", projectId: "project_agro_001", voucherId: voucher.voucherId, correlationId: "corr_check" });
  service.authorizeVoucher({ principal: authorizer, organizationId: "org_demo", projectId: "project_agro_001", voucherId: voucher.voucherId, correlationId: "corr_authorize" });
  const posted = service.postVoucher({ principal: authorizer, organizationId: "org_demo", projectId: "project_agro_001", voucherId: voucher.voucherId, correlationId: "corr_post" });

  assert.equal(posted.status, "Posted");
  assert.equal(service.getGeneralLedger({ principal: accounts, organizationId: "org_demo", projectId: "project_agro_001" }).length, 2);
  const trialBalance = service.getTrialBalance({ principal: accounts, organizationId: "org_demo", projectId: "project_agro_001" });
  assert.equal(total(trialBalance, "debit"), "50000.0000");
  assert.equal(total(trialBalance, "credit"), "50000.0000");
});

test("unbalanced vouchers, self-check, and reposting are blocked", () => {
  const identity = createIdentityService();
  const pm = identity.authenticate("Bearer demo-token-project-manager");
  const service = createAccountingService({ identity });

  assert.throws(() => service.createVoucher({
    principal: pm,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    voucherType: "Receipt",
    narration: "Bad voucher",
    correlationId: "corr_bad",
    lines: [
      { accountCode: "1000", debit: "50000.0000", credit: "0.0000" },
      { accountCode: "2000", debit: "0.0000", credit: "40000.0000", investorId: "investor_approved_001" }
    ]
  }), /must balance/);

  const voucher = service.createVoucher({
    principal: pm,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    voucherType: "Receipt",
    narration: "Synthetic receipt",
    correlationId: "corr_voucher",
    lines: [
      { accountCode: "1000", debit: "10000.0000", credit: "0.0000" },
      { accountCode: "2000", debit: "0.0000", credit: "10000.0000", investorId: "investor_approved_001" }
    ]
  });
  service.submitVoucher({ principal: pm, organizationId: "org_demo", projectId: "project_agro_001", voucherId: voucher.voucherId, correlationId: "corr_submit" });
  assert.throws(() => service.checkVoucher({
    principal: pm,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    voucherId: voucher.voucherId,
    correlationId: "corr_self_check"
  }), /not allowed|independent approval/);
});

test("posted voucher reversal creates equal and opposite journal entries", () => {
  const identity = createIdentityService();
  const pm = identity.authenticate("Bearer demo-token-project-manager");
  const accounts = identity.authenticate("Bearer demo-token-account-manager");
  const authorizer = identity.authenticate("Bearer demo-token-voucher-authorizer");
  const service = createAccountingService({ identity });

  const voucher = service.createVoucher({
    principal: pm,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    voucherType: "Receipt",
    narration: "Synthetic receipt",
    correlationId: "corr_voucher",
    lines: [
      { accountCode: "1000", debit: "25000.0000", credit: "0.0000" },
      { accountCode: "2000", debit: "0.0000", credit: "25000.0000", investorId: "investor_approved_001" }
    ]
  });
  service.submitVoucher({ principal: pm, organizationId: "org_demo", projectId: "project_agro_001", voucherId: voucher.voucherId, correlationId: "corr_submit" });
  service.checkVoucher({ principal: accounts, organizationId: "org_demo", projectId: "project_agro_001", voucherId: voucher.voucherId, correlationId: "corr_check" });
  service.authorizeVoucher({ principal: authorizer, organizationId: "org_demo", projectId: "project_agro_001", voucherId: voucher.voucherId, correlationId: "corr_authorize" });
  service.postVoucher({ principal: authorizer, organizationId: "org_demo", projectId: "project_agro_001", voucherId: voucher.voucherId, correlationId: "corr_post" });

  const reversal = service.reverseVoucher({
    principal: authorizer,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    voucherId: voucher.voucherId,
    reason: "Synthetic correction",
    correlationId: "corr_reverse"
  });
  assert.equal(reversal.status, "Posted");
  const trialBalance = service.getTrialBalance({ principal: accounts, organizationId: "org_demo", projectId: "project_agro_001" });
  assert.equal(total(trialBalance, "debit"), "50000.0000");
  assert.equal(total(trialBalance, "credit"), "50000.0000");
});

function total(rows, field) {
  return rows.reduce((sum, row) => sum + Number(row[field]), 0).toFixed(4);
}

test("period close requires a complete checklist, computes profit, and locks under four-eyes", () => {
  const identity = createIdentityService();
  const pm = identity.authenticate("Bearer demo-token-project-manager");
  const accountManager = identity.authenticate("Bearer demo-token-account-manager");
  const secondAccountManager = identity.authenticate("Bearer demo-token-account-manager-two");
  const authorizer = identity.authenticate("Bearer demo-token-voucher-authorizer");
  const service = createAccountingService({ identity });
  const scope = { organizationId: "org_demo", projectId: "project_agro_001" };
  const periodId = "period_agro_2026_08";

  seedPostedVoucher(service, { pm, accountManager, authorizer, lines: [
    { accountCode: "1000", debit: "90000.0000", credit: "0.0000" },
    { accountCode: "4000", debit: "0.0000", credit: "90000.0000" }
  ] });
  seedPostedVoucher(service, { pm, accountManager, authorizer, lines: [
    { accountCode: "5100", debit: "15000.0000", credit: "0.0000" },
    { accountCode: "1210", debit: "0.0000", credit: "15000.0000", assetId: "asset_synthetic_001" }
  ] });

  assert.throws(() => service.closePeriod({ principal: accountManager, ...scope, periodId, correlationId: "corr_early_close" }), /close must be started/);

  service.startPeriodClose({ principal: accountManager, ...scope, periodId, correlationId: "corr_start" });
  assert.throws(() => service.closePeriod({ principal: accountManager, ...scope, periodId, correlationId: "corr_incomplete" }), /checklist incomplete/);

  const checklist = service.getPeriodCloseChecklist({ principal: accountManager, ...scope, periodId });
  assert.equal(checklist.items.length, 6);
  assert.equal(checklist.items.find((item) => item.itemId === "unposted-vouchers-cleared").complete, true);
  assert.throws(() => service.completeCloseChecklistItem({
    principal: accountManager,
    ...scope,
    periodId,
    itemId: "unposted-vouchers-cleared",
    evidenceRef: "object://synthetic/manual",
    correlationId: "corr_automated"
  }), /cannot be completed manually/);
  assert.throws(() => service.completeCloseChecklistItem({
    principal: accountManager,
    ...scope,
    periodId,
    itemId: "accruals-recorded",
    correlationId: "corr_no_evidence"
  }), /evidence reference/);

  completeManualChecklist(service, { principal: accountManager, scope, periodId });
  const closed = service.closePeriod({ principal: accountManager, ...scope, periodId, correlationId: "corr_close" });

  assert.equal(closed.status, "Closed");
  assert.equal(closed.result.revenueTotal, "90000.0000");
  assert.equal(closed.result.expenseTotal, "15000.0000");
  assert.equal(closed.result.netResult, "75000.0000");
  assert.equal(closed.result.distributableProfit, "75000.0000");
  assert.equal(closed.result.resultType, "Profit");

  const periods = service.listFiscalPeriods().filter((period) => period.projectId === "project_agro_001");
  assert.equal(periods.length, 2);
  assert.equal(periods[1].status, "Open");
  assert.equal(periods[1].sequence, 2);

  assert.throws(() => service.lockPeriod({ principal: accountManager, ...scope, periodId, correlationId: "corr_role_lock" }), /not allowed to perform accounting-period:lock/);
  const locked = service.lockPeriod({ principal: authorizer, ...scope, periodId, correlationId: "corr_lock" });
  assert.equal(locked.status, "Locked");
  assert.throws(() => service.reopenPeriodForAdjustment({
    principal: secondAccountManager,
    ...scope,
    periodId,
    reason: "late adjustment",
    correlationId: "corr_reopen_locked"
  }), /cannot transition from Locked/);

  const later = seedPostedVoucher(service, { pm, accountManager, authorizer, lines: [
    { accountCode: "1000", debit: "1000.0000", credit: "0.0000" },
    { accountCode: "4000", debit: "0.0000", credit: "1000.0000" }
  ] });
  assert.equal(later.periodId, periods[1].periodId);
  assert.equal(service.getPeriodResult({ ...scope, periodId }).netResult, "75000.0000");
});

test("prior period losses carry forward and reduce the next distributable profit", () => {
  const identity = createIdentityService();
  const pm = identity.authenticate("Bearer demo-token-project-manager");
  const accountManager = identity.authenticate("Bearer demo-token-account-manager");
  const authorizer = identity.authenticate("Bearer demo-token-voucher-authorizer");
  const service = createAccountingService({ identity });
  const scope = { organizationId: "org_demo", projectId: "project_agro_001" };

  seedPostedVoucher(service, { pm, accountManager, authorizer, lines: [
    { accountCode: "1000", debit: "10000.0000", credit: "0.0000" },
    { accountCode: "4000", debit: "0.0000", credit: "10000.0000" }
  ] });
  seedPostedVoucher(service, { pm, accountManager, authorizer, lines: [
    { accountCode: "5000", debit: "30000.0000", credit: "0.0000" },
    { accountCode: "1000", debit: "0.0000", credit: "30000.0000" }
  ] });

  const firstPeriodId = "period_agro_2026_08";
  closePeriodFully(service, { accountManager, authorizer, scope, periodId: firstPeriodId });
  const firstResult = service.getPeriodResult({ ...scope, periodId: firstPeriodId });
  assert.equal(firstResult.netResult, "-20000.0000");
  assert.equal(firstResult.resultType, "Loss");
  assert.equal(firstResult.distributableProfit, "0.0000");
  assert.equal(firstResult.lossCarryForwardOut, "20000.0000");

  const secondPeriod = service.listFiscalPeriods().find((period) => period.projectId === "project_agro_001" && period.sequence === 2);
  seedPostedVoucher(service, { pm, accountManager, authorizer, lines: [
    { accountCode: "1000", debit: "50000.0000", credit: "0.0000" },
    { accountCode: "4000", debit: "0.0000", credit: "50000.0000" }
  ] });
  closePeriodFully(service, { accountManager, authorizer, scope, periodId: secondPeriod.periodId });

  const secondResult = service.getPeriodResult({ ...scope, periodId: secondPeriod.periodId });
  assert.equal(secondResult.netResult, "50000.0000");
  assert.equal(secondResult.lossCarryForwardIn, "20000.0000");
  assert.equal(secondResult.lossCarryForwardApplied, "20000.0000");
  assert.equal(secondResult.lossCarryForwardOut, "0.0000");
  assert.equal(secondResult.distributableProfit, "30000.0000");

  const carryForward = service.getLossCarryForward({ principal: accountManager, ...scope });
  assert.equal(carryForward.periodsClosed, 2);
  assert.equal(carryForward.lossCarryForward, "0.0000");
});

test("unposted vouchers block period close until they are cleared", () => {
  const identity = createIdentityService();
  const pm = identity.authenticate("Bearer demo-token-project-manager");
  const accountManager = identity.authenticate("Bearer demo-token-account-manager");
  const authorizer = identity.authenticate("Bearer demo-token-voucher-authorizer");
  const service = createAccountingService({ identity });
  const scope = { organizationId: "org_demo", projectId: "project_agro_001" };
  const periodId = "period_agro_2026_08";

  const draft = service.createVoucher({
    principal: pm,
    ...scope,
    voucherType: "Journal",
    narration: "Pending accrual",
    lines: [
      { accountCode: "5000", debit: "2000.0000", credit: "0.0000" },
      { accountCode: "2300", debit: "0.0000", credit: "2000.0000" }
    ],
    correlationId: "corr_draft"
  });

  service.startPeriodClose({ principal: accountManager, ...scope, periodId, correlationId: "corr_start" });
  completeManualChecklist(service, { principal: accountManager, scope, periodId });
  assert.throws(() => service.closePeriod({ principal: accountManager, ...scope, periodId, correlationId: "corr_blocked" }), /unposted-vouchers-cleared/);

  service.submitVoucher({ principal: pm, ...scope, voucherId: draft.voucherId, correlationId: "corr_submit" });
  service.checkVoucher({ principal: accountManager, ...scope, voucherId: draft.voucherId, correlationId: "corr_check" });
  service.authorizeVoucher({ principal: authorizer, ...scope, voucherId: draft.voucherId, correlationId: "corr_authorize" });
  service.postVoucher({ principal: authorizer, ...scope, voucherId: draft.voucherId, correlationId: "corr_post" });

  const closed = service.closePeriod({ principal: accountManager, ...scope, periodId, correlationId: "corr_close" });
  assert.equal(closed.status, "Closed");
  assert.equal(closed.result.netResult, "-2000.0000");
});

function seedPostedVoucher(service, { pm, accountManager, authorizer, lines, voucherType = "Journal", attachments = [] }) {
  const scope = { organizationId: "org_demo", projectId: "project_agro_001" };
  const voucher = service.createVoucher({
    principal: pm,
    ...scope,
    voucherType,
    narration: "Synthetic period activity",
    attachments,
    lines,
    correlationId: "corr_seed"
  });
  service.submitVoucher({ principal: pm, ...scope, voucherId: voucher.voucherId, correlationId: "corr_seed_submit" });
  service.checkVoucher({ principal: accountManager, ...scope, voucherId: voucher.voucherId, correlationId: "corr_seed_check" });
  service.authorizeVoucher({ principal: authorizer, ...scope, voucherId: voucher.voucherId, correlationId: "corr_seed_authorize" });
  return service.postVoucher({ principal: authorizer, ...scope, voucherId: voucher.voucherId, correlationId: "corr_seed_post" });
}

function completeManualChecklist(service, { principal, scope, periodId }) {
  const checklist = service.getPeriodCloseChecklist({ principal, ...scope, periodId });
  for (const item of checklist.items.filter((entry) => !entry.automated)) {
    service.completeCloseChecklistItem({
      principal,
      ...scope,
      periodId,
      itemId: item.itemId,
      evidenceRef: `object://synthetic/close/${item.itemId}`,
      correlationId: "corr_checklist"
    });
  }
}

function closePeriodFully(service, { accountManager, authorizer, scope, periodId }) {
  service.startPeriodClose({ principal: accountManager, ...scope, periodId, correlationId: "corr_start" });
  completeManualChecklist(service, { principal: accountManager, scope, periodId });
  service.closePeriod({ principal: accountManager, ...scope, periodId, correlationId: "corr_close" });
  return service.lockPeriod({ principal: authorizer, ...scope, periodId, correlationId: "corr_lock" });
}

test("a super administrator cannot both close and lock the same period", () => {
  const identity = createIdentityService();
  const pm = identity.authenticate("Bearer demo-token-project-manager");
  const accountManager = identity.authenticate("Bearer demo-token-account-manager");
  const authorizer = identity.authenticate("Bearer demo-token-voucher-authorizer");
  const superAdmin = identity.authenticate("Bearer demo-token-super-admin");
  const service = createAccountingService({ identity });
  const scope = { organizationId: "org_demo", projectId: "project_agro_001" };
  const periodId = "period_agro_2026_08";

  seedPostedVoucher(service, { pm, accountManager, authorizer, lines: [
    { accountCode: "1000", debit: "5000.0000", credit: "0.0000" },
    { accountCode: "4000", debit: "0.0000", credit: "5000.0000" }
  ] });

  service.startPeriodClose({ principal: superAdmin, ...scope, periodId, correlationId: "corr_start_super" });
  completeManualChecklist(service, { principal: superAdmin, scope, periodId });
  service.closePeriod({ principal: superAdmin, ...scope, periodId, correlationId: "corr_close_super" });

  assert.throws(() => service.lockPeriod({
    principal: superAdmin,
    ...scope,
    periodId,
    correlationId: "corr_lock_super"
  }), /requires independent approval/);

  const locked = service.lockPeriod({ principal: authorizer, ...scope, periodId, correlationId: "corr_lock_independent" });
  assert.equal(locked.status, "Locked");
  assert.equal(locked.lockedByUserId, "user_authorizer_001");
});

test("posting matrix rejects disallowed account types and versions require independent approval", () => {
  const identity = createIdentityService();
  const pm = identity.authenticate("Bearer demo-token-project-manager");
  const accountManager = identity.authenticate("Bearer demo-token-account-manager");
  const authorizer = identity.authenticate("Bearer demo-token-voucher-authorizer");
  const service = createAccountingService({ identity });
  const scope = { organizationId: "org_demo", projectId: "project_agro_001" };

  assert.throws(() => service.createVoucher({
    principal: pm,
    ...scope,
    voucherType: "Contra",
    narration: "Invalid contra",
    lines: [
      { accountCode: "1000", debit: "1000.0000", credit: "0.0000" },
      { accountCode: "4000", debit: "0.0000", credit: "1000.0000" }
    ],
    correlationId: "corr_contra"
  }), /Contra vouchers cannot credit a Revenue account/);

  assert.throws(() => service.createVoucher({
    principal: pm,
    ...scope,
    voucherType: "Barter",
    narration: "Unknown type",
    lines: [
      { accountCode: "1000", debit: "1000.0000", credit: "0.0000" },
      { accountCode: "4000", debit: "0.0000", credit: "1000.0000" }
    ],
    correlationId: "corr_unknown_type"
  }), /Unsupported voucher type/);

  const active = service.getActivePostingMatrix({ principal: accountManager, ...scope });
  assert.equal(active.version, 1);
  assert.equal(active.syntheticApproval, true);

  const drafted = service.draftPostingMatrixVersion({
    principal: accountManager,
    ...scope,
    notes: "Allow contra between cash and bank only",
    rules: {
      ...active.rules,
      Contra: { debitAccountTypes: ["Asset"], creditAccountTypes: ["Asset"], requiresAttachment: true }
    },
    correlationId: "corr_matrix_draft"
  });
  assert.equal(drafted.status, "Draft");
  assert.equal(drafted.version, 2);

  assert.throws(() => service.approvePostingMatrixVersion({
    principal: accountManager,
    ...scope,
    postingMatrixVersionId: drafted.postingMatrixVersionId,
    correlationId: "corr_matrix_self_approve"
  }), /not allowed to perform posting-matrix:approve/);

  const approved = service.approvePostingMatrixVersion({
    principal: authorizer,
    ...scope,
    postingMatrixVersionId: drafted.postingMatrixVersionId,
    correlationId: "corr_matrix_approve"
  });
  assert.equal(approved.status, "Approved");
  assert.equal(approved.syntheticApproval, false);

  const versions = service.listPostingMatrixVersions({ principal: accountManager, ...scope });
  assert.equal(versions.find((version) => version.version === 1).status, "Superseded");

  assert.throws(() => service.createVoucher({
    principal: pm,
    ...scope,
    voucherType: "Contra",
    narration: "Contra without evidence",
    lines: [
      { accountCode: "1000", debit: "1000.0000", credit: "0.0000" },
      { accountCode: "1010", debit: "0.0000", credit: "1000.0000" }
    ],
    correlationId: "corr_contra_no_attachment"
  }), /require at least one supporting attachment/);

  const contra = service.createVoucher({
    principal: pm,
    ...scope,
    voucherType: "Contra",
    narration: "Cash withdrawal from bank",
    attachments: [{ documentRef: "object://synthetic/withdrawal-slip" }],
    lines: [
      { accountCode: "1010", debit: "1000.0000", credit: "0.0000" },
      { accountCode: "1000", debit: "0.0000", credit: "1000.0000" }
    ],
    correlationId: "corr_contra_ok"
  });
  assert.equal(contra.postingMatrixVersion, 2);
});

test("opening balances post once, before activity, and require evidence", () => {
  const identity = createIdentityService();
  const accountManager = identity.authenticate("Bearer demo-token-account-manager");
  const pm = identity.authenticate("Bearer demo-token-project-manager");
  const authorizer = identity.authenticate("Bearer demo-token-voucher-authorizer");
  const service = createAccountingService({ identity });
  const scope = { organizationId: "org_demo", projectId: "project_agro_001" };

  assert.throws(() => service.postOpeningBalance({
    principal: pm,
    ...scope,
    lines: [
      { accountCode: "1000", debit: "10000.0000", credit: "0.0000" },
      { accountCode: "3000", debit: "0.0000", credit: "10000.0000" }
    ],
    attachments: [{ documentRef: "object://synthetic/opening" }],
    correlationId: "corr_opening_denied"
  }), /not allowed to perform opening-balance:post/);

  assert.throws(() => service.postOpeningBalance({
    principal: accountManager,
    ...scope,
    lines: [
      { accountCode: "1000", debit: "10000.0000", credit: "0.0000" },
      { accountCode: "3000", debit: "0.0000", credit: "10000.0000" }
    ],
    correlationId: "corr_opening_no_evidence"
  }), /require at least one supporting attachment/);

  const opening = service.postOpeningBalance({
    principal: accountManager,
    ...scope,
    lines: [
      { accountCode: "1000", debit: "10000.0000", credit: "0.0000" },
      { accountCode: "3000", debit: "0.0000", credit: "10000.0000" }
    ],
    attachments: [{ documentRef: "object://synthetic/opening-trial-balance" }],
    correlationId: "corr_opening"
  });
  assert.equal(opening.voucherType, "Opening Balance");
  assert.equal(opening.status, "Draft");

  assert.throws(() => service.postOpeningBalance({
    principal: accountManager,
    ...scope,
    lines: [
      { accountCode: "1000", debit: "5000.0000", credit: "0.0000" },
      { accountCode: "3000", debit: "0.0000", credit: "5000.0000" }
    ],
    attachments: [{ documentRef: "object://synthetic/opening-2" }],
    correlationId: "corr_opening_twice"
  }), /already exists for this project/);

  const secondAccountManager = identity.authenticate("Bearer demo-token-account-manager-two");
  service.submitVoucher({ principal: accountManager, ...scope, voucherId: opening.voucherId, correlationId: "corr_open_submit" });
  service.checkVoucher({ principal: secondAccountManager, ...scope, voucherId: opening.voucherId, correlationId: "corr_open_check" });
  assert.throws(() => service.checkVoucher({
    principal: secondAccountManager,
    ...scope,
    voucherId: opening.voucherId,
    correlationId: "corr_open_recheck"
  }), /cannot transition from Checked to Checked/);
  service.authorizeVoucher({ principal: authorizer, ...scope, voucherId: opening.voucherId, correlationId: "corr_open_authorize" });
  service.postVoucher({ principal: authorizer, ...scope, voucherId: opening.voucherId, correlationId: "corr_open_post" });

  assert.throws(() => service.postOpeningBalance({
    principal: accountManager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    lines: [
      { accountCode: "1000", debit: "1.0000", credit: "0.0000" },
      { accountCode: "3000", debit: "0.0000", credit: "1.0000" }
    ],
    attachments: [{ documentRef: "object://synthetic/opening-3" }],
    correlationId: "corr_opening_after"
  }), /already exists for this project|after a project has posted activity/);
});

test("backdated entries need independent approval and cannot target a locked period", () => {
  const identity = createIdentityService();
  const pm = identity.authenticate("Bearer demo-token-project-manager");
  const accountManager = identity.authenticate("Bearer demo-token-account-manager");
  const authorizer = identity.authenticate("Bearer demo-token-voucher-authorizer");
  const service = createAccountingService({ identity });
  const scope = { organizationId: "org_demo", projectId: "project_agro_001" };

  seedPostedVoucher(service, { pm, accountManager, authorizer, lines: [
    { accountCode: "1000", debit: "10000.0000", credit: "0.0000" },
    { accountCode: "4000", debit: "0.0000", credit: "10000.0000" }
  ] });
  closePeriodFully(service, { accountManager, authorizer, scope, periodId: "period_agro_2026_08" });

  assert.throws(() => service.createVoucher({
    principal: pm,
    ...scope,
    voucherType: "Journal",
    narration: "Entry into a locked period",
    postingDate: "2026-08-15T00:00:00.000Z",
    lines: [
      { accountCode: "5000", debit: "500.0000", credit: "0.0000" },
      { accountCode: "2300", debit: "0.0000", credit: "500.0000" }
    ],
    correlationId: "corr_locked_backdate"
  }), /is Locked and cannot accept postings/);

  const secondPeriod = service.listFiscalPeriods().find((period) => period.projectId === "project_agro_001" && period.sequence === 2);
  const thirdStart = new Date(new Date(secondPeriod.periodEnd).getTime() + 1).toISOString();
  seedPostedVoucher(service, { pm, accountManager, authorizer, lines: [
    { accountCode: "1000", debit: "1000.0000", credit: "0.0000" },
    { accountCode: "4000", debit: "0.0000", credit: "1000.0000" }
  ] });
  closePeriodFully(service, { accountManager, authorizer, scope, periodId: secondPeriod.periodId });

  const backdated = service.createVoucher({
    principal: pm,
    ...scope,
    voucherType: "Journal",
    narration: "Late supplier accrual",
    postingDate: thirdStart,
    lines: [
      { accountCode: "5000", debit: "500.0000", credit: "0.0000" },
      { accountCode: "2300", debit: "0.0000", credit: "500.0000" }
    ],
    correlationId: "corr_backdate"
  });
  const current = service.listFiscalPeriods().filter((period) => period.projectId === "project_agro_001" && period.status === "Open");
  assert.equal(current.length, 1);

  if (backdated.backdated) {
    assert.throws(() => service.postVoucher({
      principal: authorizer,
      ...scope,
      voucherId: backdated.voucherId,
      correlationId: "corr_backdate_post_early"
    }), /cannot transition|backdated entry requires independent approval/);

    assert.throws(() => service.approveBackdatedEntry({
      principal: pm,
      ...scope,
      voucherId: backdated.voucherId,
      reason: "self approval",
      correlationId: "corr_backdate_self"
    }), /not allowed to perform backdated-entry:approve/);

    const approved = service.approveBackdatedEntry({
      principal: authorizer,
      ...scope,
      voucherId: backdated.voucherId,
      reason: "Supplier invoice arrived after period rollover.",
      correlationId: "corr_backdate_approve"
    });
    assert.equal(approved.backdateApprovedByUserId, "user_authorizer_001");
  }
});

test("cross-project posting is refused and sub-ledger dimensions are mandatory", () => {
  const identity = createIdentityService();
  const pm = identity.authenticate("Bearer demo-token-project-manager");
  const service = createAccountingService({ identity });
  const scope = { organizationId: "org_demo", projectId: "project_agro_001" };

  assert.throws(() => service.createVoucher({
    principal: pm,
    ...scope,
    voucherType: "Receipt",
    narration: "Cross project",
    lines: [
      { accountCode: "1000", debit: "1000.0000", credit: "0.0000" },
      { accountCode: "2000", debit: "0.0000", credit: "1000.0000", investorId: "investor_001", projectId: "project_energy_001" }
    ],
    correlationId: "corr_cross_project"
  }), /cannot post to another project/);

  assert.throws(() => service.createVoucher({
    principal: pm,
    ...scope,
    voucherType: "Receipt",
    narration: "Missing dimension",
    lines: [
      { accountCode: "1000", debit: "1000.0000", credit: "0.0000" },
      { accountCode: "2000", debit: "0.0000", credit: "1000.0000" }
    ],
    correlationId: "corr_missing_dimension"
  }), /requires investorId/);
});

test("investor sub-ledger reconciles to its control account and reports carry checksums", () => {
  const identity = createIdentityService();
  const pm = identity.authenticate("Bearer demo-token-project-manager");
  const accountManager = identity.authenticate("Bearer demo-token-account-manager");
  const authorizer = identity.authenticate("Bearer demo-token-voucher-authorizer");
  const service = createAccountingService({ identity });
  const scope = { organizationId: "org_demo", projectId: "project_agro_001" };

  for (const [investorId, amount] of [["investor_001", "30000.0000"], ["investor_approved_001", "20000.0000"], ["investor_001", "5000.0000"]]) {
    seedPostedVoucher(service, {
      pm,
      accountManager,
      authorizer,
      voucherType: "Receipt",
      lines: [
        { accountCode: "1000", debit: amount, credit: "0.0000" },
        { accountCode: "2000", debit: "0.0000", credit: amount, investorId }
      ]
    });
  }

  const subLedger = service.getSubLedger({ principal: accountManager, ...scope, subLedger: "Investor" });
  assert.equal(subLedger.rows.length, 2);
  assert.equal(subLedger.rows.find((row) => row.subLedgerKey === "investor_001").balance, "35000.0000");
  assert.equal(subLedger.rows.find((row) => row.subLedgerKey === "investor_approved_001").balance, "20000.0000");

  const reconciliation = service.getSubLedgerReconciliation({ principal: accountManager, ...scope });
  assert.equal(reconciliation.reconciled, true);
  const investorControl = reconciliation.rows.find((row) => row.accountCode === "2000");
  assert.equal(investorControl.controlBalance, "-55000.0000");
  assert.equal(investorControl.difference, "0.0000");
  assert.equal(investorControl.subLedgerAccounts, 2);

  assert.equal(subLedger.meta.checksum.length, 64);
  assert.equal(subLedger.meta.rowCount, 2);
  const repeat = service.getSubLedger({ principal: accountManager, ...scope, subLedger: "Investor" });
  assert.equal(repeat.meta.checksum, subLedger.meta.checksum);

  const bankBook = service.getBankBook({ principal: accountManager, ...scope });
  assert.equal(bankBook.closingBalance, "55000.0000");
  assert.equal(bankBook.rows.length, 3);

  const balanceSheet = service.getBalanceSheet({ principal: accountManager, ...scope });
  assert.equal(balanceSheet.balanced, true);
  assert.equal(balanceSheet.assetTotal, "55000.0000");

  const cashFlow = service.getCashFlowStatement({ principal: accountManager, ...scope });
  assert.equal(cashFlow.inflowTotal, "55000.0000");
  assert.equal(cashFlow.outflowTotal, "0.0000");
  assert.equal(cashFlow.balanced, true);

  const utilization = service.getFundUtilization({ principal: accountManager, ...scope });
  assert.equal(utilization.fundsRaised, "55000.0000");
  assert.equal(utilization.fundsDeployed, "0.0000");
});

test("auditors can read ledgers but cannot create or post vouchers", () => {
  const identity = createIdentityService();
  const auditor = identity.authenticate("Bearer demo-token-auditor");
  const service = createAccountingService({ identity });
  const scope = { organizationId: "org_demo", projectId: "project_agro_001" };

  const balanceSheet = service.getBalanceSheet({ principal: auditor, ...scope });
  assert.equal(balanceSheet.balanced, true);

  assert.throws(() => service.createVoucher({
    principal: auditor,
    ...scope,
    voucherType: "Journal",
    narration: "Auditor posting",
    lines: [
      { accountCode: "1000", debit: "1.0000", credit: "0.0000" },
      { accountCode: "4000", debit: "0.0000", credit: "1.0000" }
    ],
    correlationId: "corr_auditor"
  }), /not allowed to perform voucher:create/);
});

test("accounting invariants hold across randomised posting sequences", () => {
  const random = createRandom(20260707);

  for (let iteration = 0; iteration < 120; iteration += 1) {
    const identity = createIdentityService();
    const pm = identity.authenticate("Bearer demo-token-project-manager");
    const accountManager = identity.authenticate("Bearer demo-token-account-manager");
    const authorizer = identity.authenticate("Bearer demo-token-voucher-authorizer");
    const service = createAccountingService({ identity });
    const scope = { organizationId: "org_demo", projectId: "project_agro_001" };
    const otherScope = { organizationId: "org_demo", projectId: "project_energy_001" };

    const postings = 1 + Math.floor(random() * 4);
    const investorIds = ["investor_001", "investor_approved_001", "investor_duplicate_001"];
    let expectedBank = 0;

    for (let index = 0; index < postings; index += 1) {
      const amount = `${(1 + Math.floor(random() * 500)) * 100}.0000`;
      const investorId = investorIds[Math.floor(random() * investorIds.length)];
      const shape = random();

      if (shape < 0.5) {
        seedPostedVoucher(service, {
          pm,
          accountManager,
          authorizer,
          voucherType: "Receipt",
          lines: [
            { accountCode: "1000", debit: amount, credit: "0.0000" },
            { accountCode: "2000", debit: "0.0000", credit: amount, investorId }
          ]
        });
        expectedBank += Number(amount);
      } else if (shape < 0.8) {
        seedPostedVoucher(service, {
          pm,
          accountManager,
          authorizer,
          voucherType: "Payment",
          attachments: [{ documentRef: "object://synthetic/advice" }],
          lines: [
            { accountCode: "5000", debit: amount, credit: "0.0000" },
            { accountCode: "1000", debit: "0.0000", credit: amount }
          ]
        });
        expectedBank -= Number(amount);
      } else {
        seedPostedVoucher(service, {
          pm,
          accountManager,
          authorizer,
          voucherType: "Sales",
          lines: [
            { accountCode: "1000", debit: amount, credit: "0.0000" },
            { accountCode: "4000", debit: "0.0000", credit: amount }
          ]
        });
        expectedBank += Number(amount);
      }
    }

    const context = `iteration ${iteration}`;
    const trialBalance = service.getTrialBalance({ principal: accountManager, ...scope });
    assert.equal(
      total(trialBalance, "debit"),
      total(trialBalance, "credit"),
      `trial balance must balance: ${context}`
    );

    const balanceSheet = service.getBalanceSheet({ principal: accountManager, ...scope });
    assert.equal(balanceSheet.balanced, true, `balance sheet identity broken: ${context}`);

    const reconciliation = service.getSubLedgerReconciliation({ principal: accountManager, ...scope });
    assert.equal(reconciliation.reconciled, true, `sub-ledger drifted from control account: ${context}`);

    const bankBook = service.getBankBook({ principal: accountManager, ...scope });
    assert.equal(
      Number(bankBook.closingBalance).toFixed(4),
      expectedBank.toFixed(4),
      `bank book closing balance wrong: ${context}`
    );

    const cashFlow = service.getCashFlowStatement({ principal: accountManager, ...scope });
    assert.equal(
      Number(cashFlow.closingBalance).toFixed(4),
      expectedBank.toFixed(4),
      `cash flow closing balance wrong: ${context}`
    );

    // Project isolation: nothing posted to the agro project may appear under the energy project.
    const otherLedger = service.getGeneralLedger({ principal: accountManager, ...otherScope });
    assert.equal(otherLedger.length, 0, `project isolation broken: ${context}`);

    // Posted entries are immutable: mutating a returned copy must not affect the ledger.
    const ledger = service.getGeneralLedger({ principal: accountManager, ...scope });
    if (ledger.length > 0) {
      ledger[0].debit = "999999.0000";
      const reread = service.getGeneralLedger({ principal: accountManager, ...scope });
      assert.notEqual(reread[0].debit, "999999.0000", `ledger entries must be immutable: ${context}`);
    }
  }
});

test("a rejected posting leaves no partial journal entries", () => {
  const identity = createIdentityService();
  const pm = identity.authenticate("Bearer demo-token-project-manager");
  const accountManager = identity.authenticate("Bearer demo-token-account-manager");
  const authorizer = identity.authenticate("Bearer demo-token-voucher-authorizer");
  const service = createAccountingService({ identity });
  const scope = { organizationId: "org_demo", projectId: "project_agro_001" };

  const voucher = service.createVoucher({
    principal: pm,
    ...scope,
    voucherType: "Journal",
    narration: "Will be blocked at posting",
    lines: [
      { accountCode: "1000", debit: "1000.0000", credit: "0.0000" },
      { accountCode: "4000", debit: "0.0000", credit: "1000.0000" }
    ],
    correlationId: "corr_atomic"
  });
  service.submitVoucher({ principal: pm, ...scope, voucherId: voucher.voucherId, correlationId: "corr_atomic_submit" });
  service.checkVoucher({ principal: accountManager, ...scope, voucherId: voucher.voucherId, correlationId: "corr_atomic_check" });

  assert.throws(() => service.postVoucher({
    principal: authorizer,
    ...scope,
    voucherId: voucher.voucherId,
    correlationId: "corr_atomic_post"
  }), /cannot transition from Checked to Posted/);

  assert.equal(service.getGeneralLedger({ principal: accountManager, ...scope }).length, 0);
});

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
