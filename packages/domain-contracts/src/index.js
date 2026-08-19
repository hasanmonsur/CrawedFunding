export const PRODUCT_BOUNDARIES = Object.freeze({
  publicFundraisingEnabled: false,
  securitiesOfferingEnabled: false,
  lendingEnabled: false,
  depositTakingEnabled: false,
  custodyEnabled: false,
  guaranteedReturnEnabled: false,
  secondaryTransferEnabled: false,
  autonomousFinancialAdviceEnabled: false
});

export const ROLES = Object.freeze({
  investor: "Investor",
  projectManager: "Project Manager",
  accountManager: "Account Manager",
  voucherAuthorizer: "Voucher Authorizer",
  complianceOfficer: "Compliance Officer",
  projectAdministrator: "Project Administrator",
  auditor: "Auditor",
  superAdministrator: "Super Administrator"
});

export const PERMISSIONS = Object.freeze({
  projectCreate: "project:create",
  projectApprove: "project:approve",
  projectPublish: "project:publish",
  projectDueDiligenceReview: "project:due-diligence-review",
  projectRiskAssess: "project:risk-assess",
  investorProfileManage: "investor:profile-manage",
  investorKycReview: "investor-kyc:review",
  investorKycSubmit: "investor-kyc:submit",
  investorHoldManage: "investor:hold-manage",
  commitmentCreate: "commitment:create",
  paymentProofSubmit: "payment:proof-submit",
  paymentReconcile: "payment:reconcile",
  paymentAccountManage: "payment-account:manage",
  paymentSettlementImport: "payment-settlement:import",
  paymentReceiptIssue: "payment-receipt:issue",
  reconciliationApprove: "reconciliation:approve",
  reconciliationLock: "reconciliation:lock",
  cashControlRecord: "cash-control:record",
  refundApprove: "refund:approve",
  refundExecute: "refund:execute",
  budgetManage: "budget:manage",
  budgetApprove: "budget:approve",
  procurementCreate: "procurement:create",
  procurementApprove: "procurement:approve",
  expenseCreate: "expense:create",
  expenseApprove: "expense:approve",
  assetManage: "asset:manage",
  milestoneManage: "milestone:manage",
  milestoneVerify: "milestone:verify",
  fundReleaseFinanceApprove: "fund-release:finance-approve",
  fundReleaseComplianceApprove: "fund-release:compliance-approve",
  fundReleasePost: "fund-release:post",
  voucherCreate: "voucher:create",
  voucherCheck: "voucher:check",
  voucherAuthorize: "voucher:authorize",
  voucherPost: "voucher:post",
  postingMatrixManage: "posting-matrix:manage",
  postingMatrixApprove: "posting-matrix:approve",
  openingBalancePost: "opening-balance:post",
  backdatedEntryApprove: "backdated-entry:approve",
  ledgerRead: "ledger:read",
  periodClose: "accounting-period:close",
  periodLock: "accounting-period:lock",
  distributionCreate: "distribution:create",
  distributionReview: "distribution:review",
  distributionApprove: "distribution:approve",
  distributionPay: "distribution:pay",
  distributionHoldManage: "distribution:hold-manage",
  dashboardRead: "dashboard:read",
  reportRun: "report:run",
  exportRequest: "export:request",
  exportApprove: "export:approve",
  documentManage: "document:manage",
  documentRead: "document:read",
  extractionVerify: "document-extraction:verify",
  notificationManage: "notification:manage",
  notificationApprove: "notification:approve",
  complaintRegister: "complaint:register",
  complaintManage: "complaint:manage",
  complaintResolve: "complaint:resolve",
  caseManage: "compliance-case:manage",
  holdPlace: "governance-hold:place",
  holdRelease: "governance-hold:release",
  ruleManage: "compliance-rule:manage",
  ruleApprove: "compliance-rule:approve",
  auditPortalRead: "audit-portal:read",
  evidencePackageBuild: "evidence-package:build",
  governanceReportRead: "governance-report:read",
  auditRead: "audit:read"
});

export const ROLE_PERMISSION_MATRIX = Object.freeze({
  [ROLES.investor]: Object.freeze([
    PERMISSIONS.investorProfileManage,
    PERMISSIONS.investorKycSubmit,
    PERMISSIONS.paymentProofSubmit,
    PERMISSIONS.commitmentCreate,
    PERMISSIONS.documentRead,
    PERMISSIONS.complaintRegister
  ]),
  [ROLES.projectManager]: Object.freeze([
    PERMISSIONS.projectCreate,
    PERMISSIONS.budgetManage,
    PERMISSIONS.procurementCreate,
    PERMISSIONS.expenseCreate,
    PERMISSIONS.assetManage,
    PERMISSIONS.milestoneManage,
    PERMISSIONS.voucherCreate,
    PERMISSIONS.dashboardRead,
    PERMISSIONS.reportRun,
    PERMISSIONS.documentManage,
    PERMISSIONS.exportRequest,
    PERMISSIONS.complaintRegister
  ]),
  [ROLES.accountManager]: Object.freeze([
    PERMISSIONS.paymentReconcile,
    PERMISSIONS.expenseApprove,
    PERMISSIONS.fundReleaseFinanceApprove,
    PERMISSIONS.voucherCheck,
    PERMISSIONS.periodClose,
    PERMISSIONS.postingMatrixManage,
    PERMISSIONS.openingBalancePost,
    PERMISSIONS.ledgerRead,
    PERMISSIONS.paymentSettlementImport,
    PERMISSIONS.paymentReceiptIssue,
    PERMISSIONS.cashControlRecord,
    PERMISSIONS.distributionCreate,
    PERMISSIONS.distributionReview,
    PERMISSIONS.dashboardRead,
    PERMISSIONS.reportRun,
    PERMISSIONS.exportRequest,
    PERMISSIONS.documentManage,
    PERMISSIONS.complaintRegister
  ]),
  [ROLES.voucherAuthorizer]: Object.freeze([
    PERMISSIONS.refundApprove,
    PERMISSIONS.refundExecute,
    PERMISSIONS.reconciliationApprove,
    PERMISSIONS.reconciliationLock,
    PERMISSIONS.fundReleasePost,
    PERMISSIONS.voucherAuthorize,
    PERMISSIONS.voucherPost,
    PERMISSIONS.postingMatrixApprove,
    PERMISSIONS.backdatedEntryApprove,
    PERMISSIONS.ledgerRead,
    PERMISSIONS.periodLock,
    PERMISSIONS.distributionPay,
    PERMISSIONS.dashboardRead,
    PERMISSIONS.holdRelease
  ]),
  [ROLES.complianceOfficer]: Object.freeze([
    PERMISSIONS.investorKycReview,
    PERMISSIONS.investorHoldManage,
    PERMISSIONS.projectDueDiligenceReview,
    PERMISSIONS.projectRiskAssess,
    PERMISSIONS.fundReleaseComplianceApprove,
    PERMISSIONS.distributionHoldManage,
    PERMISSIONS.dashboardRead,
    PERMISSIONS.reportRun,
    PERMISSIONS.documentRead,
    PERMISSIONS.extractionVerify,
    PERMISSIONS.exportApprove,
    PERMISSIONS.complaintRegister,
    PERMISSIONS.complaintManage,
    PERMISSIONS.complaintResolve,
    PERMISSIONS.caseManage,
    PERMISSIONS.holdPlace,
    PERMISSIONS.ruleManage,
    PERMISSIONS.auditPortalRead,
    PERMISSIONS.evidencePackageBuild,
    PERMISSIONS.governanceReportRead
  ]),
  [ROLES.projectAdministrator]: Object.freeze([
    PERMISSIONS.projectCreate,
    PERMISSIONS.projectApprove,
    PERMISSIONS.projectPublish,
    PERMISSIONS.projectDueDiligenceReview,
    PERMISSIONS.projectRiskAssess,
    PERMISSIONS.budgetApprove,
    PERMISSIONS.procurementApprove,
    PERMISSIONS.paymentAccountManage,
    PERMISSIONS.milestoneVerify,
    PERMISSIONS.distributionCreate,
    PERMISSIONS.distributionApprove,
    PERMISSIONS.dashboardRead,
    PERMISSIONS.reportRun,
    PERMISSIONS.exportRequest,
    PERMISSIONS.documentManage,
    PERMISSIONS.notificationManage,
    PERMISSIONS.notificationApprove,
    PERMISSIONS.ledgerRead,
    PERMISSIONS.complaintRegister,
    PERMISSIONS.complaintManage,
    PERMISSIONS.holdRelease,
    PERMISSIONS.ruleApprove,
    PERMISSIONS.governanceReportRead
  ]),
  [ROLES.auditor]: Object.freeze([
    PERMISSIONS.auditRead,
    PERMISSIONS.ledgerRead,
    PERMISSIONS.dashboardRead,
    PERMISSIONS.reportRun,
    PERMISSIONS.documentRead,
    PERMISSIONS.auditPortalRead,
    PERMISSIONS.evidencePackageBuild,
    PERMISSIONS.governanceReportRead
  ]),
  [ROLES.superAdministrator]: Object.freeze(Object.values(PERMISSIONS))
});

export const DATA_CLASSIFICATIONS = Object.freeze({
  public: "Public",
  internal: "Internal",
  confidential: "Confidential",
  restrictedIdentity: "Restricted Identity",
  restrictedFinancial: "Restricted Financial"
});

export const STATE_MACHINES = Object.freeze({
  project: Object.freeze({
    Draft: ["Due Diligence", "Cancelled"],
    "Due Diligence": ["Information Required", "Review", "Rejected"],
    "Information Required": ["Due Diligence", "Cancelled"],
    Review: ["Approved", "Rejected", "Information Required"],
    Approved: ["Published", "Cancelled"],
    Published: ["Funding", "Paused", "Cancelled"],
    Paused: ["Published", "Cancelled"],
    Funding: ["Funded", "Failed Funding", "Paused"],
    Funded: ["Active"],
    Active: ["Distributing", "Defaulted", "Closing"],
    Distributing: ["Active", "Closing"],
    Closing: ["Closed"],
    Rejected: [],
    Cancelled: [],
    "Failed Funding": [],
    Defaulted: ["Closing"],
    Closed: []
  }),
  kyc: Object.freeze({
    Draft: ["Submitted"],
    Submitted: ["Under Review", "Information Required", "Rejected"],
    "Under Review": ["Approved", "Information Required", "Rejected", "Suspended"],
    "Information Required": ["Submitted", "Rejected"],
    Approved: ["Expired", "Suspended"],
    Rejected: [],
    Expired: ["Submitted", "Suspended"],
    Suspended: ["Under Review"]
  }),
  investment: Object.freeze({
    Draft: ["Reserved", "Rejected", "Cancelled"],
    Reserved: ["Awaiting Payment", "Expired", "Cancelled"],
    "Awaiting Payment": ["Paid", "Expired", "Cancelled"],
    Paid: ["Reconciled", "Refunded"],
    Reconciled: ["Allocated", "Refunded"],
    Allocated: ["Active"],
    Active: ["Settled", "Closed", "Written Down"],
    Expired: [],
    Cancelled: [],
    Rejected: [],
    Refunded: [],
    "Written Down": ["Closed"],
    Settled: ["Closed"],
    Closed: []
  }),
  paymentInstruction: Object.freeze({
    Issued: ["Partially Paid", "Matched", "Overpaid", "Unmatched", "Cancelled", "Expired"],
    Unmatched: ["Partially Paid", "Matched", "Overpaid", "Cancelled"],
    "Partially Paid": ["Partially Paid", "Matched", "Overpaid", "Underpaid", "Returned", "Cancelled"],
    Underpaid: ["Partially Paid", "Matched", "Returned", "Cancelled"],
    Overpaid: ["Matched", "Refund Pending", "Returned"],
    "Refund Pending": ["Matched", "Returned"],
    Matched: ["Cleared", "Returned", "Reversed"],
    Cleared: ["Reversed", "Returned"],
    Returned: ["Issued", "Partially Paid", "Cancelled"],
    Reversed: [],
    Cancelled: [],
    Expired: ["Issued"]
  }),
  bankTransaction: Object.freeze({
    Imported: ["Matched", "Split Matched", "Aggregate Matched", "Duplicate", "Unmatched", "Returned", "Failed"],
    Unmatched: ["Matched", "Split Matched", "Aggregate Matched", "Duplicate", "Returned", "Failed"],
    Matched: ["Returned", "Reversed"],
    "Split Matched": ["Matched", "Returned", "Reversed"],
    "Aggregate Matched": ["Matched", "Returned", "Reversed"],
    Failed: ["Imported"],
    Duplicate: [],
    Returned: [],
    Reversed: []
  }),
  reconciliation: Object.freeze({
    Matched: ["Approved", "Rejected", "Reversed"],
    Exception: ["Matched", "Rejected"],
    Approved: ["Locked", "Reversed"],
    Locked: [],
    Rejected: [],
    Reversed: []
  }),
  refund: Object.freeze({
    Proposed: ["Approved", "Rejected"],
    Approved: ["Executed", "Failed", "Rejected"],
    Executed: ["Returned"],
    Failed: ["Approved", "Rejected"],
    Returned: ["Approved"],
    Rejected: []
  }),
  voucher: Object.freeze({
    Draft: ["Submitted"],
    Submitted: ["Checked", "Returned", "Rejected"],
    Checked: ["Authorized", "Returned", "Rejected"],
    Authorized: ["Posted", "Rejected"],
    Posted: ["Reversed"],
    Returned: ["Submitted", "Rejected"],
    Rejected: [],
    Reversed: []
  }),
  distribution: Object.freeze({
    Draft: ["Calculated", "Cancelled"],
    Calculated: ["Reviewed", "Cancelled"],
    Reviewed: ["Approved", "Held", "Cancelled"],
    Approved: ["Payable Posted", "Held"],
    "Payable Posted": ["Payment Submitted"],
    "Payment Submitted": ["Reconciled", "Partially Paid", "Failed", "Returned"],
    Reconciled: ["Completed"],
    Held: ["Reviewed", "Cancelled"],
    "Partially Paid": ["Payment Submitted", "Reconciled", "Failed"],
    Failed: ["Payment Submitted", "Cancelled"],
    Returned: ["Payment Submitted", "Cancelled"],
    Cancelled: [],
    Completed: []
  }),
  fiscalPeriod: Object.freeze({
    Open: ["Closing"],
    Closing: ["Open", "Closed"],
    Closed: ["Locked", "Closing"],
    Locked: []
  }),
  entitlement: Object.freeze({
    Draft: ["Eligible", "Held", "Excluded"],
    Eligible: ["Payable", "Held"],
    Payable: ["Payment Submitted", "Held"],
    "Payment Submitted": ["Paid", "Failed", "Returned", "Held"],
    Paid: ["Reconciled"],
    Failed: ["Payment Submitted", "Cancelled"],
    Returned: ["Payment Submitted", "Cancelled"],
    Held: ["Eligible", "Cancelled"],
    Reconciled: ["Completed"],
    Excluded: [],
    Cancelled: [],
    Completed: []
  }),
  document: Object.freeze({
    Draft: ["Active", "Rejected"],
    Active: ["Superseded", "Withdrawn"],
    Superseded: [],
    Withdrawn: [],
    Rejected: []
  }),
  documentExtraction: Object.freeze({
    Extracted: ["Verified", "Corrected", "Rejected"],
    Corrected: ["Verified", "Rejected"],
    Verified: [],
    Rejected: []
  }),
  exportRequest: Object.freeze({
    Draft: ["Pending Approval", "Approved", "Cancelled"],
    "Pending Approval": ["Approved", "Rejected", "Cancelled"],
    Approved: ["Generated", "Cancelled"],
    Generated: ["Downloaded", "Expired"],
    Downloaded: ["Expired"],
    Expired: [],
    Rejected: [],
    Cancelled: []
  }),
  notificationDelivery: Object.freeze({
    Queued: ["Sending", "Suppressed", "Cancelled"],
    Sending: ["Delivered", "Retrying", "Failed"],
    Retrying: ["Sending", "Failed"],
    Delivered: [],
    Failed: [],
    Suppressed: [],
    Cancelled: []
  }),
  notificationTemplate: Object.freeze({
    Draft: ["Approved", "Withdrawn"],
    Approved: ["Superseded"],
    Superseded: [],
    Withdrawn: []
  }),
  complaint: Object.freeze({
    Registered: ["Triaged", "Rejected", "Withdrawn"],
    Triaged: ["Assigned", "Rejected", "Withdrawn"],
    Assigned: ["In Progress", "Escalated", "Withdrawn"],
    "In Progress": ["Resolved", "Escalated", "Withdrawn"],
    Escalated: ["In Progress", "Resolved", "Withdrawn"],
    Resolved: ["Closed", "Under Appeal"],
    "Under Appeal": ["Resolved", "Closed"],
    Closed: ["Under Appeal"],
    Rejected: [],
    Withdrawn: []
  }),
  complianceCase: Object.freeze({
    Open: ["Under Investigation", "Rejected"],
    "Under Investigation": ["Pending Information", "Escalated", "Resolved", "Rejected"],
    "Pending Information": ["Under Investigation", "Rejected"],
    Escalated: ["Under Investigation", "Resolved"],
    Resolved: ["Closed", "Under Investigation"],
    Closed: [],
    Rejected: []
  }),
  governanceHold: Object.freeze({
    Active: ["Released", "Expired"],
    Released: [],
    Expired: []
  }),
  complianceRule: Object.freeze({
    Draft: ["Approved", "Withdrawn"],
    Approved: ["Superseded", "Suspended"],
    Suspended: ["Approved", "Superseded"],
    Superseded: [],
    Withdrawn: []
  }),
  evidencePackage: Object.freeze({
    Draft: ["Sealed", "Cancelled"],
    Sealed: [],
    Cancelled: []
  }),
  postingMatrix: Object.freeze({
    Draft: ["Approved", "Withdrawn"],
    Approved: ["Superseded"],
    Superseded: [],
    Withdrawn: []
  }),
  projectSettlement: Object.freeze({
    Draft: ["Settled", "Cancelled"],
    Settled: ["Archived"],
    Archived: [],
    Cancelled: []
  })
});

export const COMPLAINT_CATEGORIES = Object.freeze({
  service: "Service",
  payment: "Payment",
  disclosure: "Disclosure",
  distribution: "Distribution",
  dataPrivacy: "Data Privacy",
  fraud: "Suspected Fraud",
  misuseOfFunds: "Misuse of Funds",
  other: "Other"
});

export const CASE_SEVERITIES = Object.freeze({
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical"
});

/**
 * Service level targets in hours, by severity. These are platform operating targets and are not
 * a legal or regulatory commitment; a compliance owner must confirm them before release.
 */
export const COMPLAINT_SLA_HOURS = Object.freeze({
  [CASE_SEVERITIES.critical]: Object.freeze({ acknowledge: 4, resolve: 24 }),
  [CASE_SEVERITIES.high]: Object.freeze({ acknowledge: 8, resolve: 72 }),
  [CASE_SEVERITIES.medium]: Object.freeze({ acknowledge: 24, resolve: 168 }),
  [CASE_SEVERITIES.low]: Object.freeze({ acknowledge: 48, resolve: 336 })
});

export const CASE_SOURCES = Object.freeze({
  kyc: "KYC",
  project: "Project",
  payment: "Payment",
  fraudSignal: "Fraud Signal",
  duplicateDetection: "Duplicate Detection",
  unusualPattern: "Unusual Pattern",
  complaint: "Complaint",
  whistleblowing: "Whistleblowing"
});

export const HOLD_SUBJECTS = Object.freeze({
  investor: "Investor",
  payment: "Payment",
  project: "Project",
  refund: "Refund",
  distribution: "Distribution"
});

export const LINKABLE_ENTITIES = Object.freeze({
  investor: "Investor",
  project: "Project",
  payment: "Payment",
  document: "Document",
  voucher: "Voucher",
  complaint: "Complaint",
  complianceCase: "Compliance Case",
  distribution: "Distribution"
});

export const DOCUMENT_TYPES = Object.freeze({
  offer: "Offer",
  agreement: "Agreement",
  kyc: "KYC",
  approval: "Approval",
  receipt: "Receipt",
  invoice: "Invoice",
  evidence: "Evidence",
  statement: "Statement"
});

export const NOTIFICATION_CHANNELS = Object.freeze({
  email: "Email",
  sms: "SMS",
  push: "Push",
  inApp: "In-App"
});

export const SUPPORTED_LOCALES = Object.freeze(["en", "bn"]);

export const DEFAULT_LOCALE = "en";

export const EXPORT_FORMATS = Object.freeze(["csv", "json"]);

export const VOUCHER_TYPES = Object.freeze({
  openingBalance: "Opening Balance",
  journal: "Journal",
  receipt: "Receipt",
  payment: "Payment",
  contra: "Contra",
  purchase: "Purchase",
  sales: "Sales",
  accrual: "Accrual",
  adjustment: "Adjustment",
  depreciation: "Depreciation",
  distribution: "Distribution",
  reversal: "Reversal"
});

export const ACCOUNT_TYPES = Object.freeze({
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  revenue: "Revenue",
  expense: "Expense"
});

export const SUB_LEDGERS = Object.freeze({
  investor: "Investor",
  vendor: "Vendor",
  bank: "Bank",
  receivable: "Receivable",
  payable: "Payable",
  asset: "Asset",
  inventory: "Inventory",
  reserve: "Reserve",
  tax: "Tax",
  platformFee: "Platform Fee"
});

export const SUB_LEDGER_DIMENSIONS = Object.freeze({
  [SUB_LEDGERS.investor]: "investorId",
  [SUB_LEDGERS.vendor]: "vendorId",
  [SUB_LEDGERS.bank]: "bankAccountCode",
  [SUB_LEDGERS.receivable]: "counterpartyId",
  [SUB_LEDGERS.payable]: "counterpartyId",
  [SUB_LEDGERS.asset]: "assetId",
  [SUB_LEDGERS.inventory]: "inventoryItemId",
  [SUB_LEDGERS.reserve]: "reserveCode",
  [SUB_LEDGERS.tax]: "taxCode",
  [SUB_LEDGERS.platformFee]: "feeCode"
});

export const RECONCILIATION_MATCH_TYPES = Object.freeze({
  exact: "Exact",
  probable: "Probable",
  split: "Split",
  aggregate: "Aggregate",
  manual: "Manual"
});

export const SETTLEMENT_KINDS = Object.freeze({
  full: "Full",
  partial: "Partial",
  overpayment: "Overpayment"
});

export const PROJECT_ACCOUNT_TYPES = Object.freeze({
  escrow: "Escrow",
  segregatedProject: "Segregated Project",
  operating: "Operating"
});

export const DISTRIBUTION_BASES = Object.freeze({
  capital: "capital",
  capitalHoldingPeriod: "capital-holding-period"
});

export const RESIDUAL_POLICIES = Object.freeze({
  largestRemainder: "largest-remainder",
  retainReserve: "retain-reserve"
});

export function canTransition(machineName, from, to) {
  const machine = STATE_MACHINES[machineName];
  if (!machine) {
    throw new Error(`Unknown state machine: ${machineName}`);
  }
  return Boolean(machine[from]?.includes(to));
}

export function assertTenantProjectScope(record, expectedScope) {
  if (!record || !expectedScope) {
    throw new Error("Record and expected scope are required.");
  }
  if (record.organizationId !== expectedScope.organizationId) {
    throw new Error("Cross-organization access denied.");
  }
  if (
    expectedScope.projectId !== undefined &&
    record.projectId !== undefined &&
    record.projectId !== expectedScope.projectId
  ) {
    throw new Error("Cross-project access denied.");
  }
  return true;
}

export function assertFourEyes({ creatorUserId, approverUserId, action }) {
  if (!creatorUserId || !approverUserId) {
    throw Object.assign(new Error("Creator and approver are required."), {
      status: 409,
      code: "four_eyes_participants_missing"
    });
  }
  if (creatorUserId === approverUserId) {
    throw Object.assign(new Error(`${action ?? "Controlled action"} requires independent approval.`), {
      status: 403,
      code: "four_eyes_required"
    });
  }
  return true;
}

export function hasPermission(role, permission) {
  return Boolean(ROLE_PERMISSION_MATRIX[role]?.includes(permission));
}

export function assertPermission({ role, permission, organizationId, projectId, assignment }) {
  if (!hasPermission(role, permission)) {
    throw new Error(`Role ${role} is not allowed to perform ${permission}.`);
  }
  if (assignment) {
    assertTenantProjectScope(assignment, { organizationId, projectId });
    if (assignment.role !== role) {
      throw new Error("Role assignment does not match requested role.");
    }
  }
  return true;
}

export function assertApprovalLimit({ amount, currency = "BDT", approvalLimit }) {
  const money = assertMoney(amount, currency);
  if (!approvalLimit) {
    throw new Error("Approval limit is required.");
  }
  if (approvalLimit.currency !== money.currency) {
    throw new Error("Approval limit currency mismatch.");
  }
  if (Number(money.amount) > Number(approvalLimit.maxAmount)) {
    throw new Error("Amount exceeds approval limit.");
  }
  return true;
}

export function assertMoney(value, currency = "BDT") {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Currency must be an ISO 4217 code.");
  }
  const normalized = String(value);
  if (!/^\d+(\.\d{1,4})?$/.test(normalized)) {
    throw new Error("Money must be a positive fixed-precision decimal with up to 4 places.");
  }
  return { amount: normalized, currency };
}

export function assertRatePercent(value, label = "Rate") {
  const normalized = String(value);
  if (!/^\d+(\.\d{1,4})?$/.test(normalized)) {
    throw new Error(`${label} must be a non-negative decimal with up to 4 places.`);
  }
  if (Number(normalized) > 100) {
    throw new Error(`${label} cannot exceed 100 percent.`);
  }
  return normalized;
}

export function assertImmutablePublication(record, label = "Published record") {
  if (record?.status === "Published" || record?.status === "Retired") {
    throw new Error(`${label} is immutable once published.`);
  }
  return true;
}

export function buildAuditEvent({
  organizationId,
  projectId,
  actorUserId,
  action,
  entityType,
  entityId,
  reason,
  correlationId,
  occurredAt = new Date().toISOString()
}) {
  const required = { organizationId, actorUserId, action, entityType, entityId, correlationId };
  for (const [key, value] of Object.entries(required)) {
    if (!value) {
      throw new Error(`Audit event missing ${key}.`);
    }
  }
  return Object.freeze({
    organizationId,
    projectId,
    actorUserId,
    action,
    entityType,
    entityId,
    reason: reason ?? null,
    correlationId,
    occurredAt
  });
}

export function createProblem({ status, code, title, detail, correlationId }) {
  return {
    type: `https://docs.crowdfund360.local/problems/${code}`,
    status,
    code,
    title,
    detail,
    correlationId
  };
}

export function createApiEnvelope({ data, correlationId, meta = {} }) {
  if (!correlationId) {
    throw new Error("Correlation ID is required.");
  }
  return {
    data,
    meta: {
      correlationId,
      ...meta
    }
  };
}
