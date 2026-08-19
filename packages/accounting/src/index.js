import { createHash } from "node:crypto";
import {
  ACCOUNT_TYPES,
  PERMISSIONS,
  SUB_LEDGERS,
  SUB_LEDGER_DIMENSIONS,
  VOUCHER_TYPES,
  assertFourEyes,
  assertMoney,
  buildAuditEvent,
  canTransition
} from "../../domain-contracts/src/index.js";

const UNIT_SCALE = 10000n;
const VOUCHER_REFERENCE_FIELDS = Object.freeze([
  "costCenter",
  "milestoneId",
  "vendorId",
  "investorId",
  "commitmentId",
  "counterpartyId",
  "assetId",
  "inventoryItemId",
  "reserveCode",
  "taxCode",
  "feeCode"
]);

export const PERIOD_CLOSE_CHECKLIST_ITEMS = Object.freeze([
  Object.freeze({ itemId: "payment-reconciliation-complete", label: "Bank and payment reconciliation complete", automated: false }),
  Object.freeze({ itemId: "accruals-recorded", label: "Period accruals recorded", automated: false }),
  Object.freeze({ itemId: "adjustments-reviewed", label: "Adjusting entries reviewed", automated: false }),
  Object.freeze({ itemId: "depreciation-recorded", label: "Depreciation and amortisation recorded", automated: false }),
  Object.freeze({ itemId: "tax-and-reserve-inputs-recorded", label: "Tax and reserve inputs recorded", automated: false }),
  Object.freeze({ itemId: "unposted-vouchers-cleared", label: "No unposted vouchers remain in the period", automated: true })
]);

export function createAccountingService({
  identity,
  vouchers = [],
  journalEntries = [],
  chartOfAccounts = createDefaultChartOfAccounts(),
  fiscalPeriods = createDefaultFiscalPeriods(),
  postingMatrixVersions = createDefaultPostingMatrix(),
  clock = () => new Date(),
  auditEvents = []
}) {
  return {
    listChartOfAccounts,
    listFiscalPeriods,
    listPostingMatrixVersions,
    draftPostingMatrixVersion,
    approvePostingMatrixVersion,
    getActivePostingMatrix,
    postOpeningBalance,
    approveBackdatedEntry,
    draftReceiptForClearedPayment,
    getSubLedger,
    getSubLedgerReconciliation,
    getCashBook,
    getBankBook,
    getBalanceSheet,
    getCashFlowStatement,
    getFundUtilization,
    createVoucher,
    submitVoucher,
    checkVoucher,
    authorizeVoucher,
    postVoucher,
    reverseVoucher,
    getGeneralLedger,
    getTrialBalance,
    getPostedVoucherSummary,
    getPeriodCloseChecklist,
    startPeriodClose,
    completeCloseChecklistItem,
    reopenPeriodForAdjustment,
    closePeriod,
    lockPeriod,
    getProfitAndLoss,
    getPeriodResult,
    getLossCarryForward,
    getProjectLossCarryForward,
    getAuditEvents: () => auditEvents.slice()
  };

  function listChartOfAccounts() {
    return chartOfAccounts.map((account) => ({ ...account }));
  }

  function listFiscalPeriods() {
    return fiscalPeriods.map(clonePeriod);
  }

  function createVoucher({ principal, organizationId, projectId, voucherType, narration, lines, attachments = [], postingDate, references = {}, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.voucherCreate, organizationId, projectId });
    return buildVoucher({ principal, organizationId, projectId, voucherType, narration, lines, attachments, postingDate, references, correlationId });
  }

  function buildVoucher({ principal, organizationId, projectId, voucherType, narration, lines, attachments = [], postingDate, references = {}, correlationId, action = "accounting.voucher.create" }) {
    const matrix = requireActivePostingMatrix();
    const rule = requirePostingRule({ matrix, voucherType });
    const period = assertPostablePeriod({ organizationId, projectId });
    const resolvedPostingDate = resolvePostingDate({ organizationId, projectId, postingDate });
    const normalizedLines = normalizeLines({ organizationId, projectId, lines });
    assertBalanced(normalizedLines);
    assertPostingRule({ rule, voucherType, lines: normalizedLines });
    const normalizedAttachments = normalizeAttachments({ attachments, rule, voucherType });
    if (rule.oncePerProject && vouchers.some((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.projectId === projectId &&
      candidate.voucherType === voucherType &&
      !["Rejected", "Returned"].includes(candidate.status)
    ))) {
      throw problem(409, "voucher_type_already_recorded", `A ${voucherType} voucher already exists for this project.`);
    }

    const voucher = {
      voucherId: `voucher_${vouchers.length + 1}`,
      organizationId,
      projectId,
      periodId: period.periodId,
      voucherNo: `V-${projectId}-${vouchers.length + 1}`.toUpperCase(),
      voucherType,
      narration,
      status: "Draft",
      postingDate: resolvedPostingDate.postingDate,
      targetPeriodId: resolvedPostingDate.period.periodId,
      backdated: resolvedPostingDate.backdated,
      backdateReason: null,
      backdateApprovedByUserId: null,
      postingMatrixVersion: matrix.version,
      references: pickReferences(references),
      attachments: normalizedAttachments,
      createdByUserId: principal.user.userId,
      checkedByUserId: null,
      authorizedByUserId: null,
      postedAt: null,
      reversedVoucherId: null,
      lines: normalizedLines
    };
    vouchers.push(voucher);
    audit({ principal, organizationId, projectId, action, entityType: "Voucher", entityId: voucher.voucherId, correlationId });
    return cloneVoucher(voucher);
  }

  function postOpeningBalance({ principal, organizationId, projectId, lines, attachments, narration, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.openingBalancePost, organizationId, projectId });
    if (journalEntries.some((entry) => entry.organizationId === organizationId && entry.projectId === projectId)) {
      throw problem(409, "opening_balance_after_activity", "Opening balances cannot be recorded after a project has posted activity.");
    }
    return buildVoucher({
      principal,
      organizationId,
      projectId,
      voucherType: VOUCHER_TYPES.openingBalance,
      narration: narration ?? "Project opening balance",
      lines,
      attachments,
      references: {},
      correlationId,
      action: "accounting.opening_balance.record"
    });
  }

  function draftReceiptForClearedPayment({ organizationId, projectId, commitmentId, investorId, amount, currency = "BDT", paymentReference, actorUserId = "system:payments", correlationId }) {
    const principal = { user: { userId: actorUserId } };
    const matrix = requireActivePostingMatrix();
    const rule = requirePostingRule({ matrix, voucherType: VOUCHER_TYPES.receipt });
    const period = assertPostablePeriod({ organizationId, projectId });
    const money = assertMoney(amount, currency);
    const lines = normalizeLines({
      organizationId,
      projectId,
      lines: [
        { accountCode: "1000", debit: money.amount, credit: "0.0000", currency: money.currency, narration: `Cleared payment ${paymentReference}` },
        { accountCode: "2000", debit: "0.0000", credit: money.amount, currency: money.currency, investorId, commitmentId, narration: `Investor capital ${investorId}` }
      ]
    });
    assertBalanced(lines);
    assertPostingRule({ rule, voucherType: VOUCHER_TYPES.receipt, lines });
    const voucher = {
      voucherId: `voucher_${vouchers.length + 1}`,
      organizationId,
      projectId,
      periodId: period.periodId,
      voucherNo: `V-${projectId}-${vouchers.length + 1}`.toUpperCase(),
      voucherType: VOUCHER_TYPES.receipt,
      narration: `Cleared investor payment ${paymentReference}`,
      status: "Draft",
      postingDate: clock().toISOString(),
      targetPeriodId: period.periodId,
      backdated: false,
      backdateReason: null,
      backdateApprovedByUserId: null,
      postingMatrixVersion: matrix.version,
      references: pickReferences({ investorId, commitmentId }),
      attachments: [],
      origin: "payments.cleared_payment",
      createdByUserId: actorUserId,
      checkedByUserId: null,
      authorizedByUserId: null,
      postedAt: null,
      reversedVoucherId: null,
      lines
    };
    vouchers.push(voucher);
    audit({ principal, organizationId, projectId, action: "accounting.voucher.draft_from_payment", entityType: "Voucher", entityId: voucher.voucherId, correlationId });
    return cloneVoucher(voucher);
  }

  function approveBackdatedEntry({ principal, organizationId, projectId, voucherId, reason, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.backdatedEntryApprove, organizationId, projectId });
    const voucher = findVoucherOrThrow({ organizationId, projectId, voucherId });
    if (!voucher.backdated) {
      throw problem(409, "voucher_not_backdated", "Voucher does not target an earlier accounting period.");
    }
    if (!reason) {
      throw problem(400, "backdate_reason_required", "A backdated entry requires a documented reason.");
    }
    assertFourEyes({
      creatorUserId: voucher.createdByUserId,
      approverUserId: principal.user.userId,
      action: "Backdated entry approval"
    });
    voucher.backdateApprovedByUserId = principal.user.userId;
    voucher.backdateReason = reason;
    audit({ principal, organizationId, projectId, action: "accounting.voucher.backdate_approve", entityType: "Voucher", entityId: voucherId, reason, correlationId });
    return cloneVoucher(voucher);
  }

  function listPostingMatrixVersions({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.ledgerRead, organizationId, projectId });
    return postingMatrixVersions.map(clonePostingMatrix);
  }

  function getActivePostingMatrix({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.ledgerRead, organizationId, projectId });
    return clonePostingMatrix(requireActivePostingMatrix());
  }

  function draftPostingMatrixVersion({ principal, organizationId, projectId, rules, notes, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.postingMatrixManage, organizationId, projectId });
    if (!rules || typeof rules !== "object" || Object.keys(rules).length === 0) {
      throw problem(400, "posting_matrix_rules_required", "A posting matrix version requires rules.");
    }
    for (const [voucherType, rule] of Object.entries(rules)) {
      if (!Object.values(VOUCHER_TYPES).includes(voucherType)) {
        throw problem(400, "posting_matrix_voucher_type_invalid", `Unknown voucher type in posting matrix: ${voucherType}.`);
      }
      assertAccountTypeList(rule.debitAccountTypes, `${voucherType} debit account types`);
      assertAccountTypeList(rule.creditAccountTypes, `${voucherType} credit account types`);
    }
    if (postingMatrixVersions.some((candidate) => candidate.status === "Draft")) {
      throw problem(409, "posting_matrix_draft_exists", "A draft posting matrix version is already awaiting approval.");
    }
    const version = {
      postingMatrixVersionId: `posting_matrix_${postingMatrixVersions.length + 1}`,
      version: postingMatrixVersions.length + 1,
      status: "Draft",
      notes: notes ?? null,
      syntheticApproval: false,
      draftedByUserId: principal.user.userId,
      approvedByUserId: null,
      approvedAt: null,
      rules: structuredCloneRules(rules)
    };
    postingMatrixVersions.push(version);
    audit({ principal, organizationId, projectId, action: "accounting.posting_matrix.draft", entityType: "PostingMatrixVersion", entityId: version.postingMatrixVersionId, correlationId });
    return clonePostingMatrix(version);
  }

  function approvePostingMatrixVersion({ principal, organizationId, projectId, postingMatrixVersionId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.postingMatrixApprove, organizationId, projectId });
    const version = postingMatrixVersions.find((candidate) => candidate.postingMatrixVersionId === postingMatrixVersionId);
    if (!version) {
      throw problem(404, "posting_matrix_not_found", "Posting matrix version not found.");
    }
    assertFourEyes({
      creatorUserId: version.draftedByUserId,
      approverUserId: principal.user.userId,
      action: "Posting matrix approval"
    });
    if (!canTransition("postingMatrix", version.status, "Approved")) {
      throw problem(409, "invalid_posting_matrix_transition", `Posting matrix cannot transition from ${version.status} to Approved.`);
    }
    for (const candidate of postingMatrixVersions) {
      if (candidate !== version && candidate.status === "Approved") {
        candidate.status = "Superseded";
      }
    }
    version.status = "Approved";
    version.approvedByUserId = principal.user.userId;
    version.approvedAt = clock().toISOString();
    audit({ principal, organizationId, projectId, action: "accounting.posting_matrix.approve", entityType: "PostingMatrixVersion", entityId: postingMatrixVersionId, correlationId });
    return clonePostingMatrix(version);
  }

  function submitVoucher({ principal, organizationId, projectId, voucherId, correlationId }) {
    const voucher = findVoucherOrThrow({ organizationId, projectId, voucherId });
    assertVoucherActor(voucher, principal, "submit");
    transitionVoucher({ principal, voucher, to: "Submitted", action: "accounting.voucher.submit", correlationId });
    return cloneVoucher(voucher);
  }

  function checkVoucher({ principal, organizationId, projectId, voucherId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.voucherCheck, organizationId, projectId });
    const voucher = findVoucherOrThrow({ organizationId, projectId, voucherId });
    assertFourEyes({
      creatorUserId: voucher.createdByUserId,
      approverUserId: principal.user.userId,
      action: "Voucher check"
    });
    transitionVoucher({ principal, voucher, to: "Checked", action: "accounting.voucher.check", correlationId });
    voucher.checkedByUserId = principal.user.userId;
    return cloneVoucher(voucher);
  }

  function authorizeVoucher({ principal, organizationId, projectId, voucherId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.voucherAuthorize, organizationId, projectId });
    const voucher = findVoucherOrThrow({ organizationId, projectId, voucherId });
    assertFourEyes({
      creatorUserId: voucher.createdByUserId,
      approverUserId: principal.user.userId,
      action: "Voucher authorization"
    });
    const amount = totalDebits(voucher.lines).toFixed(4);
    identity.authorizeAmount({
      principal,
      permission: PERMISSIONS.voucherAuthorize,
      organizationId,
      projectId,
      amount,
      currency: voucher.lines[0]?.currency ?? "BDT"
    });
    transitionVoucher({ principal, voucher, to: "Authorized", action: "accounting.voucher.authorize", correlationId });
    voucher.authorizedByUserId = principal.user.userId;
    return cloneVoucher(voucher);
  }

  function postVoucher({ principal, organizationId, projectId, voucherId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.voucherPost, organizationId, projectId });
    const voucher = findVoucherOrThrow({ organizationId, projectId, voucherId });
    const target = resolveTargetPeriod({ organizationId, projectId, voucher });
    assertBalanced(voucher.lines);
    if (voucher.backdated && !voucher.backdateApprovedByUserId) {
      throw problem(409, "backdated_entry_approval_required", "A backdated entry requires independent approval before posting.");
    }

    // Build every journal entry before mutating shared state so a rejected posting leaves nothing behind.
    const pending = voucher.lines.map((line, index) => ({
      journalEntryId: `journal_${journalEntries.length + index + 1}`,
      organizationId,
      projectId,
      periodId: target.periodId,
      voucherId,
      voucherNo: voucher.voucherNo,
      voucherType: voucher.voucherType,
      accountCode: line.accountCode,
      accountType: line.accountType,
      subLedger: line.subLedger ?? null,
      subLedgerKey: line.subLedgerKey ?? null,
      debit: line.debit,
      credit: line.credit,
      currency: line.currency,
      postingDate: voucher.postingDate,
      narration: line.narration ?? voucher.narration,
      ...pickReferences(line)
    }));
    assertBalanced(pending);

    transitionVoucher({ principal, voucher, to: "Posted", action: "accounting.voucher.post", correlationId });
    voucher.postedAt = clock().toISOString();
    voucher.periodId = target.periodId;
    journalEntries.push(...pending);
    return cloneVoucher(voucher);
  }

  function resolveTargetPeriod({ organizationId, projectId, voucher }) {
    if (!voucher.targetPeriodId) {
      return assertPostablePeriod({ organizationId, projectId });
    }
    const target = findPeriodOrThrow({ organizationId, projectId, periodId: voucher.targetPeriodId });
    if (["Closed", "Locked"].includes(target.status)) {
      throw problem(409, "posting_period_closed", `Fiscal period ${target.periodId} is ${target.status} and cannot accept postings.`);
    }
    return target;
  }

  function reverseVoucher({ principal, organizationId, projectId, voucherId, reason, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.voucherAuthorize, organizationId, projectId });
    const original = findVoucherOrThrow({ organizationId, projectId, voucherId });
    if (original.status !== "Posted") {
      throw Object.assign(new Error("Only posted vouchers can be reversed."), {
        status: 409,
        code: "voucher_not_posted"
      });
    }
    const period = assertPostablePeriod({ organizationId, projectId });
    const reversal = {
      voucherId: `voucher_${vouchers.length + 1}`,
      organizationId,
      projectId,
      periodId: period.periodId,
      voucherNo: `REV-${original.voucherNo}`,
      voucherType: VOUCHER_TYPES.reversal,
      narration: reason,
      status: "Posted",
      postingDate: clock().toISOString(),
      targetPeriodId: period.periodId,
      backdated: false,
      backdateReason: null,
      backdateApprovedByUserId: null,
      postingMatrixVersion: original.postingMatrixVersion ?? null,
      references: { ...(original.references ?? {}) },
      attachments: [],
      createdByUserId: principal.user.userId,
      checkedByUserId: principal.user.userId,
      authorizedByUserId: principal.user.userId,
      postedAt: clock().toISOString(),
      reversedVoucherId: original.voucherId,
      lines: original.lines.map((line, index) => ({
        ...line,
        lineId: `line_${vouchers.length + 1}_${index + 1}`,
        organizationId,
        projectId,
        debit: line.credit,
        credit: line.debit,
        narration: `Reversal: ${line.narration ?? original.narration}`
      }))
    };
    vouchers.push(reversal);
    original.status = "Reversed";
    for (const line of reversal.lines) {
      journalEntries.push({
        journalEntryId: `journal_${journalEntries.length + 1}`,
        organizationId,
        projectId,
        periodId: period.periodId,
        voucherId: reversal.voucherId,
        voucherNo: reversal.voucherNo,
        voucherType: reversal.voucherType,
        accountCode: line.accountCode,
        accountType: line.accountType,
        subLedger: line.subLedger ?? null,
        subLedgerKey: line.subLedgerKey ?? null,
        debit: line.debit,
        credit: line.credit,
        currency: line.currency,
        postingDate: reversal.postingDate,
        narration: line.narration,
        ...pickReferences(line)
      });
    }
    audit({ principal, organizationId, projectId, action: "accounting.voucher.reverse", entityType: "Voucher", entityId: voucherId, correlationId });
    return cloneVoucher(reversal);
  }

  function getGeneralLedger({ principal, organizationId, projectId, accountCode }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.ledgerRead, organizationId, projectId });
    return journalEntries
      .filter((entry) => entry.organizationId === organizationId && entry.projectId === projectId)
      .filter((entry) => !accountCode || entry.accountCode === accountCode)
      .map((entry) => ({ ...entry }));
  }

  function getTrialBalance({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.ledgerRead, organizationId, projectId });
    const balances = new Map();
    for (const entry of journalEntries.filter((item) => item.organizationId === organizationId && item.projectId === projectId)) {
      const current = balances.get(entry.accountCode) ?? { accountCode: entry.accountCode, debit: 0, credit: 0, currency: entry.currency };
      current.debit += Number(entry.debit);
      current.credit += Number(entry.credit);
      balances.set(entry.accountCode, current);
    }
    return [...balances.values()].map((balance) => ({
      ...balance,
      debit: balance.debit.toFixed(4),
      credit: balance.credit.toFixed(4)
    }));
  }

  function getSubLedger({ principal, organizationId, projectId, subLedger, dimensionValue, periodId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.ledgerRead, organizationId, projectId });
    if (!Object.values(SUB_LEDGERS).includes(subLedger)) {
      throw problem(400, "sub_ledger_invalid", `Unknown sub-ledger: ${subLedger}.`);
    }
    const entries = scopedEntries({ organizationId, projectId, periodId })
      .filter((entry) => entry.subLedger === subLedger)
      .filter((entry) => !dimensionValue || entry.subLedgerKey === dimensionValue);
    const balances = new Map();
    for (const entry of entries) {
      const key = `${entry.accountCode}|${entry.subLedgerKey}`;
      const current = balances.get(key) ?? {
        accountCode: entry.accountCode,
        subLedger,
        subLedgerKey: entry.subLedgerKey,
        debit: 0n,
        credit: 0n,
        currency: entry.currency
      };
      current.debit += toUnits(entry.debit);
      current.credit += toUnits(entry.credit);
      balances.set(key, current);
    }
    const rows = [...balances.values()]
      .sort((left, right) => `${left.accountCode}${left.subLedgerKey}`.localeCompare(`${right.accountCode}${right.subLedgerKey}`))
      .map((balance) => ({
        accountCode: balance.accountCode,
        subLedger: balance.subLedger,
        subLedgerKey: balance.subLedgerKey,
        debit: fromUnits(balance.debit),
        credit: fromUnits(balance.credit),
        balance: signedBalance({ accountCode: balance.accountCode, debit: balance.debit, credit: balance.credit }),
        currency: balance.currency
      }));
    return withReportMeta({ organizationId, projectId, periodId, report: "sub-ledger", rows, extra: { subLedger, entryCount: entries.length } });
  }

  function getSubLedgerReconciliation({ principal, organizationId, projectId, periodId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.ledgerRead, organizationId, projectId });
    const entries = scopedEntries({ organizationId, projectId, periodId });
    const rows = [];
    for (const account of chartOfAccounts.filter((candidate) => candidate.subLedger)) {
      const accountEntries = entries.filter((entry) => entry.accountCode === account.accountCode);
      const controlDebit = accountEntries.reduce((total, entry) => total + toUnits(entry.debit), 0n);
      const controlCredit = accountEntries.reduce((total, entry) => total + toUnits(entry.credit), 0n);
      const keys = new Set(accountEntries.map((entry) => entry.subLedgerKey));
      let subDebit = 0n;
      let subCredit = 0n;
      for (const key of keys) {
        const keyEntries = accountEntries.filter((entry) => entry.subLedgerKey === key);
        subDebit += keyEntries.reduce((total, entry) => total + toUnits(entry.debit), 0n);
        subCredit += keyEntries.reduce((total, entry) => total + toUnits(entry.credit), 0n);
      }
      const controlBalance = controlDebit - controlCredit;
      const subLedgerBalance = subDebit - subCredit;
      rows.push({
        accountCode: account.accountCode,
        accountName: account.name,
        subLedger: account.subLedger,
        subLedgerAccounts: keys.size,
        controlBalance: fromUnits(controlBalance),
        subLedgerBalance: fromUnits(subLedgerBalance),
        difference: fromUnits(controlBalance - subLedgerBalance),
        reconciled: controlBalance === subLedgerBalance
      });
    }
    return withReportMeta({
      organizationId,
      projectId,
      periodId,
      report: "sub-ledger-reconciliation",
      rows,
      extra: { reconciled: rows.every((row) => row.reconciled) }
    });
  }

  function getCashBook({ principal, organizationId, projectId, periodId }) {
    return getBookOfAccount({ principal, organizationId, projectId, periodId, bookType: "Cash", report: "cash-book" });
  }

  function getBankBook({ principal, organizationId, projectId, periodId }) {
    return getBookOfAccount({ principal, organizationId, projectId, periodId, bookType: "Bank", report: "bank-book" });
  }

  function getBookOfAccount({ principal, organizationId, projectId, periodId, bookType, report }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.ledgerRead, organizationId, projectId });
    const codes = chartOfAccounts.filter((account) => account.bookType === bookType).map((account) => account.accountCode);
    const entries = scopedEntries({ organizationId, projectId, periodId }).filter((entry) => codes.includes(entry.accountCode));
    let running = 0n;
    const rows = entries.map((entry) => {
      running += toUnits(entry.debit) - toUnits(entry.credit);
      return {
        journalEntryId: entry.journalEntryId,
        voucherNo: entry.voucherNo,
        voucherType: entry.voucherType,
        postingDate: entry.postingDate,
        accountCode: entry.accountCode,
        narration: entry.narration,
        receipt: entry.debit,
        payment: entry.credit,
        runningBalance: fromUnits(running),
        currency: entry.currency
      };
    });
    return withReportMeta({
      organizationId,
      projectId,
      periodId,
      report,
      rows,
      extra: {
        accountCodes: codes,
        closingBalance: fromUnits(running)
      }
    });
  }

  function getBalanceSheet({ principal, organizationId, projectId, periodId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.ledgerRead, organizationId, projectId });
    const entries = scopedEntries({ organizationId, projectId, periodId });
    const totals = new Map();
    for (const entry of entries) {
      const account = chartOfAccounts.find((candidate) => candidate.accountCode === entry.accountCode);
      if (!account) {
        continue;
      }
      const current = totals.get(account.accountCode) ?? { account, debit: 0n, credit: 0n };
      current.debit += toUnits(entry.debit);
      current.credit += toUnits(entry.credit);
      totals.set(account.accountCode, current);
    }

    const section = (type) => [...totals.values()]
      .filter((item) => item.account.type === type)
      .map((item) => ({
        accountCode: item.account.accountCode,
        name: item.account.name,
        amount: signedBalance({ accountCode: item.account.accountCode, debit: item.debit, credit: item.credit })
      }))
      .sort((left, right) => left.accountCode.localeCompare(right.accountCode));

    const sum = (rows) => rows.reduce((total, row) => total + toUnits(row.amount), 0n);
    const assets = section(ACCOUNT_TYPES.asset);
    const liabilities = section(ACCOUNT_TYPES.liability);
    const equity = section(ACCOUNT_TYPES.equity);
    const revenue = section(ACCOUNT_TYPES.revenue);
    const expense = section(ACCOUNT_TYPES.expense);

    const assetTotal = sum(assets);
    const liabilityTotal = sum(liabilities);
    const equityTotal = sum(equity);
    const retainedResult = sum(revenue) - sum(expense);
    const equityAndRetained = equityTotal + retainedResult;

    return withReportMeta({
      organizationId,
      projectId,
      periodId,
      report: "balance-sheet",
      rows: [...assets, ...liabilities, ...equity],
      extra: {
        assets,
        liabilities,
        equity,
        assetTotal: fromUnits(assetTotal),
        liabilityTotal: fromUnits(liabilityTotal),
        equityTotal: fromUnits(equityTotal),
        currentPeriodResult: fromUnits(retainedResult),
        liabilitiesAndEquityTotal: fromUnits(liabilityTotal + equityAndRetained),
        balanced: assetTotal === liabilityTotal + equityAndRetained
      }
    });
  }

  function getCashFlowStatement({ principal, organizationId, projectId, periodId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.ledgerRead, organizationId, projectId });
    const cashCodes = chartOfAccounts
      .filter((account) => account.bookType === "Cash" || account.bookType === "Bank")
      .map((account) => account.accountCode);
    const allEntries = scopedEntries({ organizationId, projectId }).filter((entry) => cashCodes.includes(entry.accountCode));
    const periodEntries = periodId ? allEntries.filter((entry) => entry.periodId === periodId) : allEntries;
    const priorEntries = periodId ? allEntries.filter((entry) => entry.periodId !== periodId && isEarlierPeriod({ organizationId, projectId, periodId: entry.periodId, before: periodId })) : [];

    const opening = priorEntries.reduce((total, entry) => total + toUnits(entry.debit) - toUnits(entry.credit), 0n);
    const inflow = periodEntries.reduce((total, entry) => total + toUnits(entry.debit), 0n);
    const outflow = periodEntries.reduce((total, entry) => total + toUnits(entry.credit), 0n);
    const closing = opening + inflow - outflow;

    const byType = new Map();
    for (const entry of periodEntries) {
      const current = byType.get(entry.voucherType) ?? { voucherType: entry.voucherType, inflow: 0n, outflow: 0n };
      current.inflow += toUnits(entry.debit);
      current.outflow += toUnits(entry.credit);
      byType.set(entry.voucherType, current);
    }

    return withReportMeta({
      organizationId,
      projectId,
      periodId,
      report: "cash-flow",
      rows: [...byType.values()]
        .sort((left, right) => String(left.voucherType).localeCompare(String(right.voucherType)))
        .map((row) => ({
          voucherType: row.voucherType,
          inflow: fromUnits(row.inflow),
          outflow: fromUnits(row.outflow),
          net: fromUnits(row.inflow - row.outflow)
        })),
      extra: {
        openingBalance: fromUnits(opening),
        inflowTotal: fromUnits(inflow),
        outflowTotal: fromUnits(outflow),
        closingBalance: fromUnits(closing),
        balanced: closing === opening + inflow - outflow
      }
    });
  }

  function getFundUtilization({ principal, organizationId, projectId, periodId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.ledgerRead, organizationId, projectId });
    const entries = scopedEntries({ organizationId, projectId, periodId });
    let raised = 0n;
    let operatingSpend = 0n;
    let capitalised = 0n;
    let distributed = 0n;
    for (const entry of entries) {
      const account = chartOfAccounts.find((candidate) => candidate.accountCode === entry.accountCode);
      if (!account) {
        continue;
      }
      if (account.subLedger === SUB_LEDGERS.investor) {
        raised += toUnits(entry.credit) - toUnits(entry.debit);
      }
      if (account.type === ACCOUNT_TYPES.expense) {
        operatingSpend += toUnits(entry.debit) - toUnits(entry.credit);
      }
      if (account.subLedger === SUB_LEDGERS.asset && account.normalBalance === "Debit") {
        capitalised += toUnits(entry.debit) - toUnits(entry.credit);
      }
      if (account.accountCode === "2100") {
        distributed += toUnits(entry.credit) - toUnits(entry.debit);
      }
    }
    const deployed = operatingSpend + capitalised;
    return withReportMeta({
      organizationId,
      projectId,
      periodId,
      report: "fund-utilization",
      rows: [
        { measure: "Investor funds raised", amount: fromUnits(raised) },
        { measure: "Operating spend", amount: fromUnits(operatingSpend) },
        { measure: "Capitalised spend", amount: fromUnits(capitalised) },
        { measure: "Distributions declared", amount: fromUnits(distributed) }
      ],
      extra: {
        fundsRaised: fromUnits(raised),
        fundsDeployed: fromUnits(deployed),
        undeployed: fromUnits(raised - deployed),
        utilizationPercent: raised === 0n ? "0.0000" : fromUnits((deployed * 100n * UNIT_SCALE) / raised)
      }
    });
  }

  function scopedEntries({ organizationId, projectId, periodId }) {
    return journalEntries.filter((entry) => (
      entry.organizationId === organizationId &&
      entry.projectId === projectId &&
      (!periodId || entry.periodId === periodId)
    ));
  }

  function isEarlierPeriod({ organizationId, projectId, periodId, before }) {
    const left = fiscalPeriods.find((period) => period.organizationId === organizationId && period.projectId === projectId && period.periodId === periodId);
    const right = fiscalPeriods.find((period) => period.organizationId === organizationId && period.projectId === projectId && period.periodId === before);
    return Boolean(left && right && left.sequence < right.sequence);
  }

  function signedBalance({ accountCode, debit, credit }) {
    const account = chartOfAccounts.find((candidate) => candidate.accountCode === accountCode);
    const normal = account?.normalBalance ?? "Debit";
    return fromUnits(normal === "Debit" ? debit - credit : credit - debit);
  }

  function withReportMeta({ organizationId, projectId, periodId, report, rows, extra = {} }) {
    const period = periodId
      ? fiscalPeriods.find((candidate) => (
        candidate.organizationId === organizationId &&
        candidate.projectId === projectId &&
        candidate.periodId === periodId
      ))
      : null;
    const payload = { report, organizationId, projectId, periodId: periodId ?? null, rows, ...extra };
    return {
      ...payload,
      meta: {
        report,
        organizationId,
        projectId,
        periodId: periodId ?? null,
        periodStatus: period?.status ?? null,
        asOf: period?.periodEnd ?? clock().toISOString(),
        generatedAt: clock().toISOString(),
        rowCount: rows.length,
        checksum: reportChecksum(payload)
      }
    };
  }

  function getPostedVoucherSummary({ organizationId, projectId, voucherId }) {
    const voucher = findVoucherOrThrow({ organizationId, projectId, voucherId });
    if (voucher.status !== "Posted") {
      throw Object.assign(new Error("Fund release voucher must be posted."), {
        status: 409,
        code: "voucher_not_posted"
      });
    }
    return {
      voucherId: voucher.voucherId,
      voucherNo: voucher.voucherNo,
      organizationId,
      projectId,
      amount: totalDebits(voucher.lines).toFixed(4),
      currency: voucher.lines[0]?.currency ?? "BDT",
      status: voucher.status
    };
  }

  function getPeriodCloseChecklist({ principal, organizationId, projectId, periodId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.periodClose, organizationId, projectId });
    const period = findPeriodOrThrow({ organizationId, projectId, periodId });
    return {
      periodId: period.periodId,
      organizationId,
      projectId,
      status: period.status,
      items: period.closeChecklist.map((item) => ({
        ...item,
        complete: item.automated ? evaluateAutomatedItem({ item, period }) : item.complete
      }))
    };
  }

  function startPeriodClose({ principal, organizationId, projectId, periodId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.periodClose, organizationId, projectId });
    const period = findPeriodOrThrow({ organizationId, projectId, periodId });
    transitionPeriod({ principal, period, to: "Closing", action: "accounting.period.start_close", correlationId });
    return clonePeriod(period);
  }

  function completeCloseChecklistItem({ principal, organizationId, projectId, periodId, itemId, evidenceRef, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.periodClose, organizationId, projectId });
    const period = findPeriodOrThrow({ organizationId, projectId, periodId });
    if (period.status !== "Closing") {
      throw Object.assign(new Error("Period close must be started before checklist completion."), {
        status: 409,
        code: "period_close_not_started"
      });
    }
    const item = period.closeChecklist.find((candidate) => candidate.itemId === itemId);
    if (!item) {
      throw Object.assign(new Error(`Unknown close checklist item: ${itemId}.`), {
        status: 404,
        code: "close_checklist_item_not_found"
      });
    }
    if (item.automated) {
      throw Object.assign(new Error("Automated checklist items cannot be completed manually."), {
        status: 409,
        code: "close_checklist_item_automated"
      });
    }
    if (!evidenceRef) {
      throw Object.assign(new Error("Checklist completion requires an evidence reference."), {
        status: 400,
        code: "close_checklist_evidence_required"
      });
    }
    item.complete = true;
    item.evidenceRef = evidenceRef;
    item.completedByUserId = principal.user.userId;
    audit({ principal, organizationId, projectId, action: "accounting.period.checklist_complete", entityType: "FiscalPeriod", entityId: periodId, correlationId });
    return clonePeriod(period);
  }

  function reopenPeriodForAdjustment({ principal, organizationId, projectId, periodId, reason, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.periodClose, organizationId, projectId });
    const period = findPeriodOrThrow({ organizationId, projectId, periodId });
    if (!reason) {
      throw Object.assign(new Error("Reopening a period requires a documented reason."), {
        status: 400,
        code: "period_reopen_reason_required"
      });
    }
    transitionPeriod({ principal, period, to: "Closing", action: "accounting.period.reopen", correlationId, reason });
    period.result = null;
    period.closedByUserId = null;
    return clonePeriod(period);
  }

  function closePeriod({ principal, organizationId, projectId, periodId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.periodClose, organizationId, projectId });
    const period = findPeriodOrThrow({ organizationId, projectId, periodId });
    if (period.status !== "Closing") {
      throw Object.assign(new Error("Period close must be started before closing."), {
        status: 409,
        code: "period_close_not_started"
      });
    }
    const outstanding = period.closeChecklist.filter((item) => (
      item.automated ? !evaluateAutomatedItem({ item, period }) : !item.complete
    ));
    if (outstanding.length > 0) {
      throw Object.assign(new Error(`Period close checklist incomplete: ${outstanding.map((item) => item.itemId).join(", ")}.`), {
        status: 409,
        code: "period_close_checklist_incomplete"
      });
    }
    assertPeriodLedgerBalanced({ organizationId, projectId, periodId });
    period.result = computePeriodResult({ organizationId, projectId, period });
    transitionPeriod({ principal, period, to: "Closed", action: "accounting.period.close", correlationId });
    period.closedByUserId = principal.user.userId;
    period.closedAt = new Date().toISOString();
    openNextPeriod({ period });
    return clonePeriod(period);
  }

  function lockPeriod({ principal, organizationId, projectId, periodId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.periodLock, organizationId, projectId });
    const period = findPeriodOrThrow({ organizationId, projectId, periodId });
    if (period.status !== "Closed") {
      throw Object.assign(new Error("Only a closed period can be locked."), {
        status: 409,
        code: "period_not_closed"
      });
    }
    assertFourEyes({
      creatorUserId: period.closedByUserId,
      approverUserId: principal.user.userId,
      action: "Fiscal period lock"
    });
    transitionPeriod({ principal, period, to: "Locked", action: "accounting.period.lock", correlationId });
    period.lockedByUserId = principal.user.userId;
    period.lockedAt = new Date().toISOString();
    return clonePeriod(period);
  }

  function getProfitAndLoss({ principal, organizationId, projectId, periodId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.ledgerRead, organizationId, projectId });
    const period = findPeriodOrThrow({ organizationId, projectId, periodId });
    return computeProfitAndLoss({ organizationId, projectId, periodId: period.periodId });
  }

  function getPeriodResult({ organizationId, projectId, periodId }) {
    const period = findPeriodOrThrow({ organizationId, projectId, periodId });
    if (!period.result) {
      throw Object.assign(new Error("Period result is only available after the period is closed."), {
        status: 409,
        code: "period_result_unavailable"
      });
    }
    return { ...period.result, periodStatus: period.status };
  }

  function getLossCarryForward({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.ledgerRead, organizationId, projectId });
    return getProjectLossCarryForward({ organizationId, projectId });
  }

  function getProjectLossCarryForward({ organizationId, projectId }) {
    const settled = fiscalPeriods
      .filter((item) => item.organizationId === organizationId && item.projectId === projectId && item.result)
      .sort((left, right) => left.sequence - right.sequence);
    const latest = settled[settled.length - 1];
    return {
      organizationId,
      projectId,
      periodsClosed: settled.length,
      lossCarryForward: latest?.result?.lossCarryForwardOut ?? "0.0000",
      history: settled.map((item) => ({
        periodId: item.periodId,
        netResult: item.result.netResult,
        lossCarryForwardIn: item.result.lossCarryForwardIn,
        lossCarryForwardApplied: item.result.lossCarryForwardApplied,
        lossCarryForwardOut: item.result.lossCarryForwardOut,
        distributableProfit: item.result.distributableProfit
      }))
    };
  }

  function computeProfitAndLoss({ organizationId, projectId, periodId }) {
    const entries = journalEntries.filter((entry) => (
      entry.organizationId === organizationId &&
      entry.projectId === projectId &&
      entry.periodId === periodId
    ));
    const accounts = new Map();
    let revenue = 0n;
    let expense = 0n;
    let currency = null;
    for (const entry of entries) {
      const account = chartOfAccounts.find((candidate) => candidate.accountCode === entry.accountCode);
      if (!account || (account.type !== "Revenue" && account.type !== "Expense")) {
        continue;
      }
      currency = currency ?? entry.currency;
      const debit = toUnits(entry.debit);
      const credit = toUnits(entry.credit);
      const delta = account.type === "Revenue" ? credit - debit : debit - credit;
      if (account.type === "Revenue") {
        revenue += delta;
      } else {
        expense += delta;
      }
      accounts.set(account.accountCode, (accounts.get(account.accountCode) ?? 0n) + delta);
    }
    return {
      organizationId,
      projectId,
      periodId,
      currency: currency ?? "BDT",
      revenueTotal: fromUnits(revenue),
      expenseTotal: fromUnits(expense),
      netResult: fromUnits(revenue - expense),
      accounts: [...accounts.entries()].map(([accountCode, amount]) => ({
        accountCode,
        name: chartOfAccounts.find((candidate) => candidate.accountCode === accountCode)?.name ?? accountCode,
        type: chartOfAccounts.find((candidate) => candidate.accountCode === accountCode)?.type ?? "Unknown",
        amount: fromUnits(amount)
      }))
    };
  }

  function computePeriodResult({ organizationId, projectId, period }) {
    const profitAndLoss = computeProfitAndLoss({ organizationId, projectId, periodId: period.periodId });
    const previous = fiscalPeriods
      .filter((item) => (
        item.organizationId === organizationId &&
        item.projectId === projectId &&
        item.sequence < period.sequence &&
        item.result
      ))
      .sort((left, right) => left.sequence - right.sequence)
      .at(-1);
    const carryIn = toUnits(previous?.result?.lossCarryForwardOut ?? "0.0000");
    const net = toUnits(profitAndLoss.netResult);
    let applied = 0n;
    let carryOut = carryIn;
    let distributable = 0n;
    if (net >= 0n) {
      applied = net < carryIn ? net : carryIn;
      carryOut = carryIn - applied;
      distributable = net - applied;
    } else {
      carryOut = carryIn + (net * -1n);
    }
    return {
      ...profitAndLoss,
      periodCode: period.periodCode,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      sequence: period.sequence,
      lossCarryForwardIn: fromUnits(carryIn),
      lossCarryForwardApplied: fromUnits(applied),
      lossCarryForwardOut: fromUnits(carryOut),
      distributableProfit: fromUnits(distributable),
      resultType: net < 0n ? "Loss" : "Profit"
    };
  }

  function assertPeriodLedgerBalanced({ organizationId, projectId, periodId }) {
    let debit = 0n;
    let credit = 0n;
    for (const entry of journalEntries) {
      if (entry.organizationId !== organizationId || entry.projectId !== projectId || entry.periodId !== periodId) {
        continue;
      }
      debit += toUnits(entry.debit);
      credit += toUnits(entry.credit);
    }
    if (debit !== credit) {
      throw Object.assign(new Error("Period ledger is unbalanced and cannot be closed."), {
        status: 409,
        code: "period_ledger_unbalanced"
      });
    }
  }

  function evaluateAutomatedItem({ item, period }) {
    if (item.itemId !== "unposted-vouchers-cleared") {
      return Boolean(item.complete);
    }
    return !vouchers.some((voucher) => (
      voucher.organizationId === period.organizationId &&
      voucher.projectId === period.projectId &&
      voucher.periodId === period.periodId &&
      !["Posted", "Reversed", "Rejected"].includes(voucher.status)
    ));
  }

  function openNextPeriod({ period }) {
    const existing = fiscalPeriods.find((item) => (
      item.organizationId === period.organizationId &&
      item.projectId === period.projectId &&
      item.sequence === period.sequence + 1
    ));
    if (existing) {
      return existing;
    }
    const start = new Date(period.periodEnd);
    start.setUTCMilliseconds(start.getUTCMilliseconds() + 1);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
    const periodCode = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
    const next = {
      organizationId: period.organizationId,
      projectId: period.projectId,
      periodId: `${period.projectId}_period_${periodCode.replace("-", "_")}`,
      periodCode,
      sequence: period.sequence + 1,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      status: "Open",
      closeChecklist: createCloseChecklist(),
      result: null,
      closedByUserId: null,
      closedAt: null,
      lockedByUserId: null,
      lockedAt: null
    };
    fiscalPeriods.push(next);
    return next;
  }

  function transitionPeriod({ principal, period, to, action, correlationId, reason }) {
    if (!canTransition("fiscalPeriod", period.status, to)) {
      throw Object.assign(new Error(`Fiscal period cannot transition from ${period.status} to ${to}.`), {
        status: 409,
        code: "invalid_period_transition"
      });
    }
    period.status = to;
    audit({
      principal,
      organizationId: period.organizationId,
      projectId: period.projectId,
      action,
      entityType: "FiscalPeriod",
      entityId: period.periodId,
      reason,
      correlationId
    });
  }

  function findPeriodOrThrow({ organizationId, projectId, periodId }) {
    const period = fiscalPeriods.find((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.projectId === projectId &&
      candidate.periodId === periodId
    ));
    if (!period) {
      throw Object.assign(new Error("Fiscal period not found."), { status: 404, code: "fiscal_period_not_found" });
    }
    return period;
  }

  function clonePeriod(period) {
    return {
      ...period,
      closeChecklist: period.closeChecklist.map((item) => ({ ...item })),
      result: period.result ? { ...period.result, accounts: period.result.accounts.map((entry) => ({ ...entry })) } : null
    };
  }

  function normalizeLines({ organizationId, projectId, lines }) {
    if (!Array.isArray(lines) || lines.length < 2) {
      throw Object.assign(new Error("Voucher requires at least two lines."), {
        status: 400,
        code: "voucher_lines_required"
      });
    }
    return lines.map((line, index) => {
      const debit = assertMoney(line.debit ?? "0.0000", line.currency ?? "BDT").amount;
      const credit = assertMoney(line.credit ?? "0.0000", line.currency ?? "BDT").amount;
      if (Number(debit) > 0 && Number(credit) > 0) {
        throw Object.assign(new Error("Voucher line cannot contain both debit and credit."), {
          status: 400,
          code: "voucher_line_invalid"
        });
      }
      if (Number(debit) === 0 && Number(credit) === 0) {
        throw Object.assign(new Error("Voucher line requires debit or credit."), {
          status: 400,
          code: "voucher_line_empty"
        });
      }
      const account = assertKnownAccount(line.accountCode);
      if (line.projectId !== undefined && line.projectId !== projectId) {
        throw problem(403, "cross_project_posting_denied", "A voucher line cannot post to another project. Use an explicit inter-project transfer.");
      }
      const references = pickReferences(line);
      const dimension = account.subLedgerDimension;
      if (dimension && !references[dimension]) {
        throw problem(400, "sub_ledger_dimension_required", `Account ${account.accountCode} posts to the ${account.subLedger} sub-ledger and requires ${dimension}.`);
      }
      return {
        lineId: `line_${vouchers.length + 1}_${index + 1}`,
        organizationId,
        projectId,
        accountCode: line.accountCode,
        accountType: account.type,
        subLedger: account.subLedger,
        subLedgerKey: resolveSubLedgerKey({ account, references }),
        debit,
        credit,
        currency: line.currency ?? "BDT",
        narration: line.narration ?? null,
        ...references
      };
    });
  }

  function resolveSubLedgerKey({ account, references }) {
    if (!account.subLedger) {
      return null;
    }
    return account.subLedgerDimension ? references[account.subLedgerDimension] : account.accountCode;
  }

  function requireActivePostingMatrix() {
    const active = postingMatrixVersions.find((candidate) => candidate.status === "Approved");
    if (!active) {
      throw problem(409, "posting_matrix_unavailable", "No approved posting matrix version is active.");
    }
    return active;
  }

  function requirePostingRule({ matrix, voucherType }) {
    if (!Object.values(VOUCHER_TYPES).includes(voucherType)) {
      throw problem(400, "voucher_type_invalid", `Unsupported voucher type: ${voucherType}.`);
    }
    const rule = matrix.rules[voucherType];
    if (!rule) {
      throw problem(409, "posting_matrix_rule_missing", `Approved posting matrix version ${matrix.version} has no rule for ${voucherType}.`);
    }
    return rule;
  }

  function assertPostingRule({ rule, voucherType, lines }) {
    for (const line of lines) {
      const isDebit = Number(line.debit) > 0;
      const allowed = isDebit ? rule.debitAccountTypes : rule.creditAccountTypes;
      if (!allowed.includes(line.accountType)) {
        throw problem(
          409,
          "posting_matrix_violation",
          `${voucherType} vouchers cannot ${isDebit ? "debit" : "credit"} a ${line.accountType} account (${line.accountCode}).`
        );
      }
    }
  }

  function normalizeAttachments({ attachments, rule, voucherType }) {
    const normalized = (attachments ?? []).map((attachment, index) => {
      if (!attachment?.documentRef) {
        throw problem(400, "voucher_attachment_invalid", "Each voucher attachment requires a document reference.");
      }
      return {
        attachmentId: `attachment_${vouchers.length + 1}_${index + 1}`,
        documentRef: attachment.documentRef,
        description: attachment.description ?? null
      };
    });
    if (rule.requiresAttachment && normalized.length === 0) {
      throw problem(409, "voucher_attachment_required", `${voucherType} vouchers require at least one supporting attachment.`);
    }
    return normalized;
  }

  function resolvePostingDate({ organizationId, projectId, postingDate }) {
    const current = assertPostablePeriod({ organizationId, projectId });
    if (!postingDate) {
      return { postingDate: clock().toISOString(), period: current, backdated: false };
    }
    const parsed = new Date(postingDate);
    if (Number.isNaN(parsed.getTime())) {
      throw problem(400, "posting_date_invalid", "Posting date must be a valid date.");
    }
    const target = fiscalPeriods.find((period) => (
      period.organizationId === organizationId &&
      period.projectId === projectId &&
      new Date(period.periodStart) <= parsed &&
      parsed <= new Date(period.periodEnd)
    ));
    if (!target) {
      throw problem(409, "posting_period_not_found", "No fiscal period covers the requested posting date.");
    }
    if (["Closed", "Locked"].includes(target.status)) {
      throw problem(409, "posting_period_closed", `Fiscal period ${target.periodId} is ${target.status} and cannot accept postings.`);
    }
    return { postingDate: parsed.toISOString(), period: target, backdated: target.sequence < current.sequence };
  }

  function pickReferences(source = {}) {
    const references = {};
    for (const field of VOUCHER_REFERENCE_FIELDS) {
      if (source[field] !== undefined && source[field] !== null) {
        references[field] = source[field];
      }
    }
    return references;
  }

  function clonePostingMatrix(version) {
    return { ...version, rules: structuredCloneRules(version.rules) };
  }

  function transitionVoucher({ principal, voucher, to, action, correlationId }) {
    if (!canTransition("voucher", voucher.status, to)) {
      throw Object.assign(new Error(`Voucher cannot transition from ${voucher.status} to ${to}.`), {
        status: 409,
        code: "invalid_voucher_transition"
      });
    }
    voucher.status = to;
    audit({ principal, organizationId: voucher.organizationId, projectId: voucher.projectId, action, entityType: "Voucher", entityId: voucher.voucherId, correlationId });
  }

  function assertVoucherActor(voucher, principal, action) {
    if (voucher.createdByUserId !== principal.user.userId) {
      throw Object.assign(new Error(`Only voucher creator can ${action} this voucher.`), {
        status: 403,
        code: "voucher_actor_denied"
      });
    }
  }

  function assertKnownAccount(accountCode) {
    const account = chartOfAccounts.find((candidate) => candidate.accountCode === accountCode);
    if (!account) {
      throw problem(400, "unknown_account", `Unknown account code: ${accountCode}.`);
    }
    return account;
  }

  function assertBalanced(lines) {
    const debits = totalDebits(lines);
    const credits = totalCredits(lines);
    if (debits.toFixed(4) !== credits.toFixed(4)) {
      throw Object.assign(new Error("Voucher debits and credits must balance."), {
        status: 409,
        code: "voucher_unbalanced"
      });
    }
  }

  function assertPostablePeriod({ organizationId, projectId }) {
    const candidates = fiscalPeriods.filter((item) => (
      item.organizationId === organizationId && item.projectId === projectId
    ));
    const period = candidates.find((item) => item.status === "Closing") ??
      candidates.find((item) => item.status === "Open");
    if (!period) {
      throw Object.assign(new Error("No open or closing fiscal period for project."), {
        status: 409,
        code: "fiscal_period_closed"
      });
    }
    return period;
  }

  function findVoucherOrThrow({ organizationId, projectId, voucherId }) {
    const voucher = vouchers.find((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.projectId === projectId &&
      candidate.voucherId === voucherId
    ));
    if (!voucher) {
      throw Object.assign(new Error("Voucher not found."), { status: 404, code: "voucher_not_found" });
    }
    return voucher;
  }

  function totalDebits(lines) {
    return lines.reduce((sum, line) => sum + Number(line.debit), 0);
  }

  function totalCredits(lines) {
    return lines.reduce((sum, line) => sum + Number(line.credit), 0);
  }

  function cloneVoucher(voucher) {
    return {
      ...voucher,
      lines: voucher.lines.map((line) => ({ ...line }))
    };
  }

  function audit({ principal, organizationId, projectId, action, entityType, entityId, reason, correlationId }) {
    auditEvents.push(buildAuditEvent({
      organizationId,
      projectId,
      actorUserId: principal.user.userId,
      action,
      entityType,
      entityId,
      reason,
      correlationId
    }));
  }
}

function problem(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function assertAccountTypeList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw problem(400, "posting_matrix_account_types_required", `${label} must list at least one account type.`);
  }
  for (const accountType of value) {
    if (!Object.values(ACCOUNT_TYPES).includes(accountType)) {
      throw problem(400, "posting_matrix_account_type_invalid", `${label} contains an unknown account type: ${accountType}.`);
    }
  }
}

function structuredCloneRules(rules) {
  return Object.fromEntries(Object.entries(rules).map(([voucherType, rule]) => [voucherType, {
    ...rule,
    debitAccountTypes: [...rule.debitAccountTypes],
    creditAccountTypes: [...rule.creditAccountTypes]
  }]));
}

/**
 * Deterministic report checksum so a stored or exported report can be proven unaltered.
 * Keys are sorted before hashing, making the digest independent of property order.
 */
export function reportChecksum(payload) {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(",")}}`;
}

function toUnits(value) {
  const normalized = String(value ?? "0");
  const negative = normalized.startsWith("-");
  const [whole, fraction = ""] = (negative ? normalized.slice(1) : normalized).split(".");
  const units = BigInt(whole || "0") * UNIT_SCALE + BigInt((`${fraction}0000`).slice(0, 4));
  return negative ? units * -1n : units;
}

function fromUnits(units) {
  const negative = units < 0n;
  const absolute = negative ? units * -1n : units;
  const whole = absolute / UNIT_SCALE;
  const fraction = absolute % UNIT_SCALE;
  return `${negative ? "-" : ""}${whole}.${fraction.toString().padStart(4, "0")}`;
}

export function createCloseChecklist() {
  return PERIOD_CLOSE_CHECKLIST_ITEMS.map((item) => ({
    ...item,
    complete: false,
    evidenceRef: null,
    completedByUserId: null
  }));
}

/**
 * Chart of accounts.
 *
 * `subLedger` marks a control account. When `subLedgerDimension` is set every posting to that
 * account must carry the named dimension, and the sub-ledger is keyed by it. When it is null the
 * sub-ledger is keyed by the account code itself, which is how bank and cash books work: a second
 * bank account is a second general-ledger account rather than a dimension value.
 */
export function createDefaultChartOfAccounts() {
  return [
    { accountCode: "1000", name: "Project Bank", type: "Asset", normalBalance: "Debit", bookType: "Bank", subLedger: SUB_LEDGERS.bank, subLedgerDimension: null },
    { accountCode: "1010", name: "Project Cash", type: "Asset", normalBalance: "Debit", bookType: "Cash", subLedger: null, subLedgerDimension: null },
    { accountCode: "1100", name: "Investor Receivable", type: "Asset", normalBalance: "Debit", bookType: null, subLedger: SUB_LEDGERS.receivable, subLedgerDimension: SUB_LEDGER_DIMENSIONS[SUB_LEDGERS.receivable] },
    { accountCode: "1150", name: "Vendor Advance", type: "Asset", normalBalance: "Debit", bookType: null, subLedger: SUB_LEDGERS.vendor, subLedgerDimension: SUB_LEDGER_DIMENSIONS[SUB_LEDGERS.vendor] },
    { accountCode: "1200", name: "Project Fixed Assets", type: "Asset", normalBalance: "Debit", bookType: null, subLedger: SUB_LEDGERS.asset, subLedgerDimension: SUB_LEDGER_DIMENSIONS[SUB_LEDGERS.asset] },
    { accountCode: "1210", name: "Accumulated Depreciation", type: "Asset", normalBalance: "Credit", bookType: null, subLedger: SUB_LEDGERS.asset, subLedgerDimension: SUB_LEDGER_DIMENSIONS[SUB_LEDGERS.asset] },
    { accountCode: "1300", name: "Project Inventory", type: "Asset", normalBalance: "Debit", bookType: null, subLedger: SUB_LEDGERS.inventory, subLedgerDimension: SUB_LEDGER_DIMENSIONS[SUB_LEDGERS.inventory] },
    { accountCode: "2000", name: "Investor Liability", type: "Liability", normalBalance: "Credit", bookType: null, subLedger: SUB_LEDGERS.investor, subLedgerDimension: SUB_LEDGER_DIMENSIONS[SUB_LEDGERS.investor] },
    { accountCode: "2050", name: "Vendor Payable", type: "Liability", normalBalance: "Credit", bookType: null, subLedger: SUB_LEDGERS.payable, subLedgerDimension: SUB_LEDGER_DIMENSIONS[SUB_LEDGERS.payable] },
    { accountCode: "2100", name: "Distribution Payable", type: "Liability", normalBalance: "Credit", bookType: null, subLedger: null, subLedgerDimension: null },
    { accountCode: "2200", name: "Withholding Tax Payable", type: "Liability", normalBalance: "Credit", bookType: null, subLedger: SUB_LEDGERS.tax, subLedgerDimension: SUB_LEDGER_DIMENSIONS[SUB_LEDGERS.tax] },
    { accountCode: "2300", name: "Accrued Liabilities", type: "Liability", normalBalance: "Credit", bookType: null, subLedger: null, subLedgerDimension: null },
    { accountCode: "3000", name: "Retained Earnings", type: "Equity", normalBalance: "Credit", bookType: null, subLedger: null, subLedgerDimension: null },
    { accountCode: "3100", name: "Distribution Reserve", type: "Equity", normalBalance: "Credit", bookType: null, subLedger: SUB_LEDGERS.reserve, subLedgerDimension: SUB_LEDGER_DIMENSIONS[SUB_LEDGERS.reserve] },
    { accountCode: "4000", name: "Project Revenue", type: "Revenue", normalBalance: "Credit", bookType: null, subLedger: null, subLedgerDimension: null },
    { accountCode: "4100", name: "Platform Fee Income", type: "Revenue", normalBalance: "Credit", bookType: null, subLedger: SUB_LEDGERS.platformFee, subLedgerDimension: SUB_LEDGER_DIMENSIONS[SUB_LEDGERS.platformFee] },
    { accountCode: "5000", name: "Project Expense", type: "Expense", normalBalance: "Debit", bookType: null, subLedger: null, subLedgerDimension: null },
    { accountCode: "5100", name: "Depreciation Expense", type: "Expense", normalBalance: "Debit", bookType: null, subLedger: null, subLedgerDimension: null },
    { accountCode: "5200", name: "Tax and Reserve Charge", type: "Expense", normalBalance: "Debit", bookType: null, subLedger: null, subLedgerDimension: null }
  ];
}

/**
 * Posting matrix version 1.
 *
 * The seeded version is marked as a synthetic approval so it is obvious that a finance or
 * accounting SME has not yet signed it off. Later versions must be drafted and approved by two
 * different people through `draftPostingMatrixVersion` and `approvePostingMatrixVersion`.
 */
export function createDefaultPostingMatrix() {
  const allTypes = Object.values(ACCOUNT_TYPES);
  return [{
    postingMatrixVersionId: "posting_matrix_1",
    version: 1,
    status: "Approved",
    notes: "Seeded synthetic posting matrix. Requires finance SME approval before release.",
    syntheticApproval: true,
    draftedByUserId: "system:seed",
    approvedByUserId: "system:seed",
    approvedAt: null,
    rules: {
      [VOUCHER_TYPES.openingBalance]: { debitAccountTypes: [ACCOUNT_TYPES.asset, ACCOUNT_TYPES.expense], creditAccountTypes: [ACCOUNT_TYPES.liability, ACCOUNT_TYPES.equity, ACCOUNT_TYPES.revenue], requiresAttachment: true, oncePerProject: true },
      [VOUCHER_TYPES.journal]: { debitAccountTypes: allTypes, creditAccountTypes: allTypes, requiresAttachment: false },
      [VOUCHER_TYPES.receipt]: { debitAccountTypes: [ACCOUNT_TYPES.asset], creditAccountTypes: [ACCOUNT_TYPES.liability, ACCOUNT_TYPES.revenue, ACCOUNT_TYPES.asset], requiresAttachment: false },
      [VOUCHER_TYPES.payment]: { debitAccountTypes: [ACCOUNT_TYPES.expense, ACCOUNT_TYPES.liability, ACCOUNT_TYPES.asset], creditAccountTypes: [ACCOUNT_TYPES.asset], requiresAttachment: true },
      [VOUCHER_TYPES.contra]: { debitAccountTypes: [ACCOUNT_TYPES.asset], creditAccountTypes: [ACCOUNT_TYPES.asset], requiresAttachment: false },
      [VOUCHER_TYPES.purchase]: { debitAccountTypes: [ACCOUNT_TYPES.asset, ACCOUNT_TYPES.expense], creditAccountTypes: [ACCOUNT_TYPES.liability], requiresAttachment: true },
      [VOUCHER_TYPES.sales]: { debitAccountTypes: [ACCOUNT_TYPES.asset], creditAccountTypes: [ACCOUNT_TYPES.revenue], requiresAttachment: false },
      [VOUCHER_TYPES.accrual]: { debitAccountTypes: [ACCOUNT_TYPES.expense, ACCOUNT_TYPES.asset], creditAccountTypes: [ACCOUNT_TYPES.liability], requiresAttachment: false },
      [VOUCHER_TYPES.adjustment]: { debitAccountTypes: allTypes, creditAccountTypes: allTypes, requiresAttachment: true },
      [VOUCHER_TYPES.depreciation]: { debitAccountTypes: [ACCOUNT_TYPES.expense], creditAccountTypes: [ACCOUNT_TYPES.asset], requiresAttachment: false },
      [VOUCHER_TYPES.distribution]: { debitAccountTypes: [ACCOUNT_TYPES.equity, ACCOUNT_TYPES.expense], creditAccountTypes: [ACCOUNT_TYPES.liability], requiresAttachment: false },
      [VOUCHER_TYPES.reversal]: { debitAccountTypes: allTypes, creditAccountTypes: allTypes, requiresAttachment: false }
    }
  }];
}

export function createDefaultFiscalPeriods() {
  return [
    createFiscalPeriod({
      organizationId: "org_demo",
      projectId: "project_agro_001",
      periodId: "period_agro_2026_08",
      periodCode: "2026-08"
    }),
    createFiscalPeriod({
      organizationId: "org_demo",
      projectId: "project_energy_001",
      periodId: "period_energy_2026_08",
      periodCode: "2026-08"
    })
  ];
}

export function createFiscalPeriod({ organizationId, projectId, periodId, periodCode, sequence = 1, status = "Open" }) {
  const [year, month] = periodCode.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return {
    organizationId,
    projectId,
    periodId,
    periodCode,
    sequence,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    status,
    closeChecklist: createCloseChecklist(),
    result: null,
    closedByUserId: null,
    closedAt: null,
    lockedByUserId: null,
    lockedAt: null
  };
}
