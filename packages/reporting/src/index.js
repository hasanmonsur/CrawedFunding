import { createHash } from "node:crypto";
import {
  EXPORT_FORMATS,
  PERMISSIONS,
  assertFourEyes,
  buildAuditEvent,
  canTransition
} from "../../domain-contracts/src/index.js";

const UNIT_SCALE = 10000n;

// Scope identifiers are not measures, so a narrative never restates them as findings.
const NARRATIVE_EXCLUDED_KEYS = Object.freeze([
  "organizationId",
  "projectId",
  "periodId",
  "periodCode",
  "sequence",
  "report",
  "rowCount",
  "accountCodes",
  "currency"
]);

/**
 * Report catalogue.
 *
 * `sensitive` reports expose investor-identifying or restricted financial detail. An unmasked
 * export of a sensitive report always needs independent approval before it can be generated.
 */
export const REPORT_CATALOGUE = Object.freeze([
  Object.freeze({ reportKey: "trial-balance", title: "Trial balance", source: "accounting", sensitive: false }),
  Object.freeze({ reportKey: "general-ledger", title: "General ledger", source: "accounting", sensitive: false }),
  Object.freeze({ reportKey: "profit-and-loss", title: "Profit and loss", source: "accounting", sensitive: false }),
  Object.freeze({ reportKey: "balance-sheet", title: "Balance sheet", source: "accounting", sensitive: false }),
  Object.freeze({ reportKey: "cash-flow", title: "Cash flow", source: "accounting", sensitive: false }),
  Object.freeze({ reportKey: "cash-book", title: "Cash book", source: "accounting", sensitive: false }),
  Object.freeze({ reportKey: "bank-book", title: "Bank book", source: "accounting", sensitive: false }),
  Object.freeze({ reportKey: "fund-utilization", title: "Fund utilization", source: "accounting", sensitive: false }),
  Object.freeze({ reportKey: "sub-ledger-reconciliation", title: "Sub-ledger reconciliation", source: "accounting", sensitive: false }),
  Object.freeze({ reportKey: "investor-sub-ledger", title: "Investor sub-ledger", source: "accounting", sensitive: true, maskedFields: ["subLedgerKey"] }),
  Object.freeze({ reportKey: "investor-statement", title: "Investor statement", source: "distributions", sensitive: true, maskedFields: ["investorId"] }),
  Object.freeze({ reportKey: "project-statement", title: "Project statement", source: "reporting", sensitive: false }),
  Object.freeze({ reportKey: "kyc-funnel", title: "KYC and compliance funnel", source: "investors", sensitive: true, maskedFields: ["investorId", "fullName"] }),
  Object.freeze({ reportKey: "reconciliation-exceptions", title: "Reconciliation exceptions", source: "payments", sensitive: false }),
  Object.freeze({ reportKey: "audit-events", title: "Audit event export", source: "reporting", sensitive: true, maskedFields: ["actorUserId"] })
]);

export function createReportingService({
  identity,
  accountingService,
  investmentService,
  investorService,
  paymentService,
  operationsService,
  projectService,
  distributionService,
  documentService = null,
  exportRequests = [],
  clock = () => new Date(),
  auditEvents = []
}) {
  return {
    listReports,
    runReport,
    getInvestorDashboard,
    getProjectDashboard,
    getAdministratorDashboard,
    requestExport,
    approveExport,
    rejectExport,
    generateExport,
    listExportRequests,
    draftReportNarrative,
    getAuditEvents: () => auditEvents.slice()
  };

  // ------------------------------------------------------------------ catalogue

  function listReports({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.reportRun, organizationId, projectId });
    return REPORT_CATALOGUE.map((report) => ({ ...report }));
  }

  function runReport({ principal, organizationId, projectId, reportKey, periodId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.reportRun, organizationId, projectId });
    const definition = findReportOrThrow(reportKey);
    const scope = { principal, organizationId, projectId, periodId };
    const result = dispatchReport({ definition, scope });
    return {
      reportKey,
      title: definition.title,
      sensitive: definition.sensitive,
      ...result
    };
  }

  function dispatchReport({ definition, scope }) {
    const { principal, organizationId, projectId } = scope;
    // Period-scoped accounting reports default to the project's current open or closing period.
    const periodId = scope.periodId ?? currentPeriodId({ organizationId, projectId });
    switch (definition.reportKey) {
      case "trial-balance":
        return asReport({ rows: accountingService.getTrialBalance({ principal, organizationId, projectId }), scope, definition });
      case "general-ledger":
        return asReport({ rows: accountingService.getGeneralLedger({ principal, organizationId, projectId }), scope, definition });
      case "profit-and-loss":
        return fromAccountingReport(accountingService.getProfitAndLoss({ principal, organizationId, projectId, periodId }), definition);
      case "balance-sheet":
        return fromAccountingReport(accountingService.getBalanceSheet({ principal, organizationId, projectId, periodId }), definition);
      case "cash-flow":
        return fromAccountingReport(accountingService.getCashFlowStatement({ principal, organizationId, projectId, periodId }), definition);
      case "cash-book":
        return fromAccountingReport(accountingService.getCashBook({ principal, organizationId, projectId, periodId }), definition);
      case "bank-book":
        return fromAccountingReport(accountingService.getBankBook({ principal, organizationId, projectId, periodId }), definition);
      case "fund-utilization":
        return fromAccountingReport(accountingService.getFundUtilization({ principal, organizationId, projectId, periodId }), definition);
      case "sub-ledger-reconciliation":
        return fromAccountingReport(accountingService.getSubLedgerReconciliation({ principal, organizationId, projectId, periodId }), definition);
      case "investor-sub-ledger":
        return fromAccountingReport(accountingService.getSubLedger({ principal, organizationId, projectId, subLedger: "Investor", periodId }), definition);
      case "investor-statement":
        return asReport({ rows: distributionService.getInvestorStatement({ principal, organizationId, projectId }).lines, scope, definition });
      case "project-statement":
        return asReport({ rows: buildProjectStatement({ principal, organizationId, projectId, periodId }), scope, definition });
      case "kyc-funnel":
        return asReport({ rows: buildKycFunnel({ principal, organizationId }), scope, definition });
      case "reconciliation-exceptions":
        return asReport({ rows: paymentService.listPaymentExceptions({ principal, organizationId, projectId }), scope, definition });
      case "audit-events":
        return asReport({ rows: collectAuditEvents({ principal, organizationId, projectId }), scope, definition });
      default:
        throw problem(400, "report_not_supported", `Report ${definition.reportKey} has no generator.`);
    }
  }

  function fromAccountingReport(report, definition) {
    return {
      rows: report.rows,
      summary: Object.fromEntries(Object.entries(report).filter(([key]) => !["rows", "meta", "report"].includes(key))),
      meta: { ...report.meta, sensitive: definition.sensitive }
    };
  }

  function asReport({ rows, scope, definition }) {
    const normalized = rows ?? [];
    return {
      rows: normalized,
      summary: { rowCount: normalized.length },
      meta: {
        report: definition.reportKey,
        organizationId: scope.organizationId,
        projectId: scope.projectId ?? null,
        periodId: scope.periodId ?? null,
        generatedAt: clock().toISOString(),
        asOf: clock().toISOString(),
        rowCount: normalized.length,
        sensitive: definition.sensitive,
        checksum: checksum({ reportKey: definition.reportKey, rows: normalized })
      }
    };
  }

  // ----------------------------------------------------------------- dashboards

  function getInvestorDashboard({ principal, organizationId }) {
    const profile = investorService.getMyInvestorProfile({ principal });
    const portfolio = investmentService.getPortfolio({ principal, organizationId });
    const statement = distributionService.getInvestorStatement({ principal, organizationId });

    const investedCapital = sumUnits(portfolio
      .filter((commitment) => ["Allocated", "Active", "Settled"].includes(commitment.status))
      .map((commitment) => commitment.capitalAmount ?? commitment.amount));
    const pendingCapital = sumUnits(portfolio
      .filter((commitment) => ["Reserved", "Awaiting Payment", "Paid", "Reconciled"].includes(commitment.status))
      .map((commitment) => commitment.amount));

    const paid = sumUnits(statement.lines
      .filter((line) => ["Paid", "Reconciled", "Completed"].includes(line.status))
      .map((line) => line.netAmount));
    const pendingDistribution = sumUnits(statement.lines
      .filter((line) => ["Eligible", "Payable", "Payment Submitted", "Held"].includes(line.status))
      .map((line) => line.netAmount));

    return {
      organizationId,
      investorId: profile.investorId,
      kyc: {
        status: profile.kycStatus,
        holdStatus: profile.holdStatus,
        actionRequired: profile.kycStatus !== "Approved" || profile.holdStatus !== "None"
      },
      tiles: [
        tile("Invested capital", fromUnits(investedCapital), "investments.portfolio"),
        tile("Pending capital", fromUnits(pendingCapital), "investments.portfolio"),
        tile("Distributions paid", fromUnits(paid), "distributions.statement"),
        tile("Distributions pending", fromUnits(pendingDistribution), "distributions.statement")
      ],
      allocations: portfolio.map((commitment) => ({
        commitmentId: commitment.commitmentId,
        projectId: commitment.projectId,
        amount: commitment.amount,
        currency: commitment.currency,
        status: commitment.status
      })),
      distributions: statement.lines,
      controlTotals: {
        portfolioCommitments: portfolio.length,
        statementGross: statement.totals.grossAmount,
        statementNet: statement.totals.netAmount,
        statementPaid: statement.totals.paidAmount
      },
      meta: freshness({ organizationId, generatedAt: clock() })
    };
  }

  function getProjectDashboard({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.dashboardRead, organizationId, projectId });
    const scope = { principal, organizationId, projectId };

    const balanceSheet = guarded(() => accountingService.getBalanceSheet(scope));
    const bankBook = guarded(() => accountingService.getBankBook(scope));
    const profitAndLoss = guarded(() => accountingService.getProfitAndLoss({ ...scope, periodId: currentPeriodId({ organizationId, projectId, principal }) }));
    const utilization = guarded(() => accountingService.getFundUtilization(scope));
    const reconciliation = guarded(() => accountingService.getSubLedgerReconciliation(scope));
    const investorLedger = guarded(() => accountingService.getSubLedger({ ...scope, subLedger: "Investor" }));
    const budgetVariance = guarded(() => operationsService.getBudgetVariance(scope));
    const health = guarded(() => operationsService.getProjectHealth(scope));
    const timeline = guarded(() => operationsService.getProjectTimeline(scope));
    const exceptions = guarded(() => paymentService.listPaymentExceptions(scope));
    const holdings = investmentService.listProjectHoldings({ organizationId, projectId });
    const distributions = guarded(() => distributionService.listDistributions(scope));

    const investorCapital = investorLedger.value
      ? investorLedger.value.rows.reduce((total, row) => total + toUnits(row.balance), 0n)
      : 0n;

    return {
      organizationId,
      projectId,
      tiles: [
        tile("Cash at bank", bankBook.value?.closingBalance ?? null, "accounting.bank-book", bankBook),
        tile("Investor capital", investorLedger.value ? fromUnits(investorCapital) : null, "accounting.sub-ledger", investorLedger),
        tile("Revenue", profitAndLoss.value?.revenueTotal ?? null, "accounting.profit-and-loss", profitAndLoss),
        tile("Expense", profitAndLoss.value?.expenseTotal ?? null, "accounting.profit-and-loss", profitAndLoss),
        tile("Margin", profitAndLoss.value?.netResult ?? null, "accounting.profit-and-loss", profitAndLoss),
        tile("Funds deployed", utilization.value?.fundsDeployed ?? null, "accounting.fund-utilization", utilization),
        tile("Reconciliation exceptions", exceptions.value ? String(exceptions.value.length) : null, "payments.exceptions", exceptions),
        tile("Active holdings", String(holdings.length), "investments.holdings"),
        tile("Health score", health.value ? String(health.value.score ?? health.value.healthScore ?? "") : null, "operations.health", health)
      ],
      budget: budgetVariance.value ?? null,
      milestones: timeline.value?.milestones ?? null,
      distributions: distributions.value ?? null,
      controlTotals: {
        // The exit gate: dashboard figures must tie back to the authoritative ledger.
        bankBookClosing: bankBook.value?.closingBalance ?? null,
        investorCapitalControl: investorLedger.value ? fromUnits(investorCapital) : null,
        balanceSheetBalanced: balanceSheet.value?.balanced ?? null,
        subLedgerReconciled: reconciliation.value?.reconciled ?? null,
        ledgerChecksum: balanceSheet.value?.meta?.checksum ?? null
      },
      restricted: collectRestricted({
        balanceSheet,
        bankBook,
        profitAndLoss,
        utilization,
        reconciliation,
        investorLedger,
        budgetVariance,
        health,
        timeline,
        exceptions,
        distributions
      }),
      meta: freshness({ organizationId, projectId, generatedAt: clock() })
    };
  }

  function getAdministratorDashboard({ principal, organizationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.dashboardRead, organizationId });
    const projects = projectService.listProjects({ principal, organizationId });
    const kycFunnel = guarded(() => buildKycFunnel({ principal, organizationId }));

    let cash = 0n;
    let revenue = 0n;
    let expense = 0n;
    let exceptionCount = 0;
    const perProject = [];
    const restricted = [];

    for (const project of projects) {
      const scope = { principal, organizationId, projectId: project.projectId };
      const bankBook = guarded(() => accountingService.getBankBook(scope));
      const profitAndLoss = guarded(() => accountingService.getProfitAndLoss({
        ...scope,
        periodId: currentPeriodId({ organizationId, projectId: project.projectId, principal })
      }));
      const exceptions = guarded(() => paymentService.listPaymentExceptions(scope));

      if (bankBook.value) {
        cash += toUnits(bankBook.value.closingBalance);
      }
      if (profitAndLoss.value) {
        revenue += toUnits(profitAndLoss.value.revenueTotal);
        expense += toUnits(profitAndLoss.value.expenseTotal);
      }
      if (exceptions.value) {
        exceptionCount += exceptions.value.length;
      }
      for (const entry of collectRestricted({ bankBook, profitAndLoss, exceptions })) {
        restricted.push({ ...entry, projectId: project.projectId });
      }
      perProject.push({
        projectId: project.projectId,
        title: project.title,
        status: project.status,
        cash: bankBook.value?.closingBalance ?? null,
        revenue: profitAndLoss.value?.revenueTotal ?? null,
        expense: profitAndLoss.value?.expenseTotal ?? null
      });
    }

    return {
      organizationId,
      tiles: [
        tile("Projects", String(projects.length), "projects.list"),
        tile("Portfolio cash", fromUnits(cash), "accounting.bank-book"),
        tile("Portfolio revenue", fromUnits(revenue), "accounting.profit-and-loss"),
        tile("Portfolio expense", fromUnits(expense), "accounting.profit-and-loss"),
        tile("Portfolio result", fromUnits(revenue - expense), "accounting.profit-and-loss"),
        tile("Reconciliation exceptions", String(exceptionCount), "payments.exceptions"),
        tile("Investors in KYC review", kycFunnel.value ? String(kycFunnel.value.filter((row) => row.status === "Under Review").length) : null, "investors.kyc", kycFunnel)
      ],
      projects: perProject,
      kycFunnel: kycFunnel.value ?? null,
      controlTotals: {
        portfolioCash: fromUnits(cash),
        portfolioResult: fromUnits(revenue - expense),
        projectCount: projects.length
      },
      restricted,
      meta: freshness({ organizationId, generatedAt: clock() })
    };
  }

  function buildProjectStatement({ principal, organizationId, projectId, periodId }) {
    const profitAndLoss = accountingService.getProfitAndLoss({ principal, organizationId, projectId, periodId });
    const utilization = accountingService.getFundUtilization({ principal, organizationId, projectId, periodId });
    return [
      { measure: "Revenue", amount: profitAndLoss.revenueTotal },
      { measure: "Expense", amount: profitAndLoss.expenseTotal },
      { measure: "Net result", amount: profitAndLoss.netResult },
      { measure: "Funds raised", amount: utilization.fundsRaised },
      { measure: "Funds deployed", amount: utilization.fundsDeployed },
      { measure: "Undeployed", amount: utilization.undeployed }
    ];
  }

  function buildKycFunnel({ principal, organizationId }) {
    const queue = investorService.listReviewQueue({ principal, organizationId });
    return queue.map((entry) => ({
      investorId: entry.investorId,
      status: entry.status ?? entry.kycStatus,
      submittedAt: entry.submittedAt ?? null
    }));
  }

  function collectAuditEvents({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.auditRead, organizationId, projectId });
    const sources = [accountingService, investmentService, investorService, paymentService, operationsService, projectService, distributionService];
    return sources
      .flatMap((service) => (service?.getAuditEvents ? service.getAuditEvents() : []))
      .filter((event) => event.organizationId === organizationId)
      .filter((event) => !projectId || event.projectId === projectId)
      .map((event) => ({ ...event }))
      .sort((left, right) => String(left.occurredAt).localeCompare(String(right.occurredAt)));
  }

  // -------------------------------------------------------------------- exports

  function requestExport({ principal, organizationId, projectId, reportKey, format = "csv", masking = "masked", periodId, purpose, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.exportRequest, organizationId, projectId });
    const definition = findReportOrThrow(reportKey);
    if (!EXPORT_FORMATS.includes(format)) {
      throw problem(400, "export_format_invalid", `Unsupported export format: ${format}.`);
    }
    if (!["masked", "unmasked"].includes(masking)) {
      throw problem(400, "export_masking_invalid", `Unsupported masking mode: ${masking}.`);
    }
    if (!purpose) {
      throw problem(400, "export_purpose_required", "An export request requires a stated purpose.");
    }
    // Unmasked sensitive data never leaves the platform without a second pair of eyes.
    const requiresApproval = definition.sensitive && masking === "unmasked";
    const request = {
      exportRequestId: `export_${exportRequests.length + 1}`,
      organizationId,
      projectId: projectId ?? null,
      reportKey,
      periodId: periodId ?? null,
      format,
      masking,
      purpose,
      sensitive: definition.sensitive,
      requiresApproval,
      status: "Draft",
      requestedByUserId: principal.user.userId,
      approvedByUserId: null,
      rejectedReason: null,
      generatedAt: null,
      checksum: null,
      rowCount: null,
      downloadGrantId: null,
      requestedAt: clock().toISOString()
    };
    exportRequests.push(request);
    transitionExport({ request, to: requiresApproval ? "Pending Approval" : "Approved" });
    audit({ principal, organizationId, projectId, action: "reporting.export.request", entityType: "ExportRequest", entityId: request.exportRequestId, reason: purpose, correlationId });
    return { ...request };
  }

  function approveExport({ principal, organizationId, exportRequestId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.exportApprove, organizationId });
    const request = findExportOrThrow({ organizationId, exportRequestId });
    assertFourEyes({
      creatorUserId: request.requestedByUserId,
      approverUserId: principal.user.userId,
      action: "Sensitive export approval"
    });
    transitionExport({ request, to: "Approved" });
    request.approvedByUserId = principal.user.userId;
    audit({ principal, organizationId, projectId: request.projectId, action: "reporting.export.approve", entityType: "ExportRequest", entityId: exportRequestId, correlationId });
    return { ...request };
  }

  function rejectExport({ principal, organizationId, exportRequestId, reason, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.exportApprove, organizationId });
    const request = findExportOrThrow({ organizationId, exportRequestId });
    if (!reason) {
      throw problem(400, "export_reject_reason_required", "Rejecting an export requires a documented reason.");
    }
    transitionExport({ request, to: "Rejected" });
    request.rejectedReason = reason;
    audit({ principal, organizationId, projectId: request.projectId, action: "reporting.export.reject", entityType: "ExportRequest", entityId: exportRequestId, reason, correlationId });
    return { ...request };
  }

  function generateExport({ principal, organizationId, exportRequestId, correlationId }) {
    const request = findExportOrThrow({ organizationId, exportRequestId });
    identity.requirePermission({ principal, permission: PERMISSIONS.exportRequest, organizationId, projectId: request.projectId ?? undefined });
    if (request.status !== "Approved") {
      throw problem(409, "export_not_approved", `Export request is ${request.status} and cannot be generated.`);
    }
    const definition = findReportOrThrow(request.reportKey);
    const report = runReport({
      principal,
      organizationId,
      projectId: request.projectId ?? undefined,
      reportKey: request.reportKey,
      periodId: request.periodId ?? undefined
    });
    const rows = request.masking === "masked"
      ? maskRows({ rows: report.rows, maskedFields: definition.maskedFields ?? [] })
      : report.rows;
    const generatedAt = clock();
    const watermark = [
      "CrowdFund360 controlled export",
      `Report ${request.reportKey}`,
      `Requested by ${request.requestedByUserId}`,
      request.approvedByUserId ? `Approved by ${request.approvedByUserId}` : "No approval required",
      `Masking ${request.masking}`,
      `Generated ${generatedAt.toISOString()}`
    ].join(" | ");
    const content = request.format === "csv" ? toCsv(rows) : JSON.stringify(rows, null, 2);
    const body = `${request.format === "csv" ? `# ${watermark}\n` : ""}${content}`;

    transitionExport({ request, to: "Generated" });
    request.generatedAt = generatedAt.toISOString();
    request.rowCount = rows.length;
    request.checksum = checksum({ reportKey: request.reportKey, rows, watermark });
    request.sourceChecksum = report.meta.checksum ?? null;

    let grant = null;
    if (documentService?.createDownloadGrant && documentService?.registerDocument) {
      const document = documentService.registerDocument({
        principal,
        organizationId,
        projectId: request.projectId ?? undefined,
        documentType: "Statement",
        title: `${definition.title} export ${request.exportRequestId}`,
        documentRef: `object://synthetic/exports/${request.exportRequestId}.${request.format}`,
        contentHash: request.checksum,
        classification: definition.sensitive ? "Restricted Financial" : "Internal",
        correlationId
      });
      grant = documentService.createDownloadGrant({
        principal,
        organizationId,
        documentId: document.documentId,
        purpose: request.purpose,
        expiresInSeconds: 300,
        correlationId
      });
      request.downloadGrantId = grant.downloadGrantId;
      request.documentId = document.documentId;
    }

    audit({ principal, organizationId, projectId: request.projectId, action: "reporting.export.generate", entityType: "ExportRequest", entityId: exportRequestId, reason: request.purpose, correlationId });
    return {
      request: { ...request },
      watermark,
      masking: request.masking,
      rowCount: rows.length,
      checksum: request.checksum,
      sourceChecksum: request.sourceChecksum,
      content: body,
      downloadGrant: grant
    };
  }

  function listExportRequests({ principal, organizationId, projectId, status }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.reportRun, organizationId, projectId });
    return exportRequests
      .filter((request) => request.organizationId === organizationId)
      .filter((request) => !projectId || request.projectId === projectId)
      .filter((request) => !status || request.status === status)
      .map((request) => ({ ...request }));
  }

  /**
   * AI narrative support.
   *
   * The narrative is generated only from figures already present in an approved report, and every
   * sentence cites the source report and its checksum. It is explicitly non-authoritative and
   * cannot be published without human review.
   */
  function draftReportNarrative({ principal, organizationId, projectId, reportKey, periodId }) {
    const report = runReport({ principal, organizationId, projectId, reportKey, periodId });
    const summary = report.summary ?? {};
    const citation = `${reportKey}@${report.meta.checksum?.slice(0, 12) ?? "unknown"}`;
    const sentences = Object.entries(summary)
      .filter(([measure]) => !NARRATIVE_EXCLUDED_KEYS.includes(measure))
      .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      .map(([measure, value]) => ({
        text: `${humanise(measure)} is ${value}.`,
        citation
      }));
    return {
      reportKey,
      organizationId,
      projectId: projectId ?? null,
      periodId: periodId ?? null,
      // AI may summarise approved metrics. It may not decide, approve, or advise.
      authoritative: false,
      requiresHumanReview: true,
      generatedFrom: {
        reportKey,
        checksum: report.meta.checksum ?? null,
        asOf: report.meta.asOf ?? null,
        periodStatus: report.meta.periodStatus ?? null
      },
      sentences,
      narrative: sentences.map((sentence) => sentence.text).join(" ")
    };
  }

  // ------------------------------------------------------------------ internals

  function currentPeriodId({ organizationId, projectId }) {
    const periods = accountingService.listFiscalPeriods()
      .filter((period) => period.organizationId === organizationId && period.projectId === projectId)
      .sort((left, right) => left.sequence - right.sequence);
    return periods.find((period) => ["Open", "Closing"].includes(period.status))?.periodId ?? periods.at(-1)?.periodId;
  }

  /**
   * Dashboard tiles degrade rather than fail. A caller who lacks a permission sees the tile marked
   * restricted instead of the whole dashboard erroring, and the reason is reported explicitly.
   */
  function guarded(producer) {
    try {
      return { value: producer(), restricted: false, code: null };
    } catch (error) {
      if (error.status === 403) {
        return { value: null, restricted: true, code: error.code ?? "permission_denied" };
      }
      throw error;
    }
  }

  function collectRestricted(sources) {
    return Object.entries(sources)
      .filter(([, entry]) => entry?.restricted)
      .map(([source, entry]) => ({ source, code: entry.code }));
  }

  function tile(label, value, source, guard) {
    return {
      label,
      value,
      source,
      restricted: Boolean(guard?.restricted),
      restrictionCode: guard?.code ?? null
    };
  }

  function freshness({ organizationId, projectId, generatedAt }) {
    return {
      organizationId,
      projectId: projectId ?? null,
      generatedAt: generatedAt.toISOString(),
      asOf: generatedAt.toISOString(),
      freshnessSeconds: 0,
      source: "authoritative-ledger-read-through"
    };
  }

  function findReportOrThrow(reportKey) {
    const definition = REPORT_CATALOGUE.find((candidate) => candidate.reportKey === reportKey);
    if (!definition) {
      throw problem(404, "report_not_found", `Unknown report: ${reportKey}.`);
    }
    return definition;
  }

  function findExportOrThrow({ organizationId, exportRequestId }) {
    const request = exportRequests.find((candidate) => (
      candidate.organizationId === organizationId && candidate.exportRequestId === exportRequestId
    ));
    if (!request) {
      throw problem(404, "export_request_not_found", "Export request not found.");
    }
    return request;
  }

  function transitionExport({ request, to }) {
    if (!canTransition("exportRequest", request.status, to)) {
      throw problem(409, "invalid_export_transition", `Export request cannot transition from ${request.status} to ${to}.`);
    }
    request.status = to;
  }

  function audit({ principal, organizationId, projectId, action, entityType, entityId, reason, correlationId }) {
    auditEvents.push(buildAuditEvent({
      organizationId,
      projectId: projectId ?? undefined,
      actorUserId: principal.user.userId,
      action,
      entityType,
      entityId,
      reason,
      correlationId
    }));
  }
}

export function maskRows({ rows, maskedFields }) {
  if (maskedFields.length === 0) {
    return rows.map((row) => ({ ...row }));
  }
  return rows.map((row) => {
    const masked = { ...row };
    for (const field of maskedFields) {
      if (masked[field] !== undefined && masked[field] !== null) {
        masked[field] = maskValue(masked[field]);
      }
    }
    return masked;
  });
}

export function maskValue(value) {
  const normalized = String(value);
  if (normalized.length <= 4) {
    return "****";
  }
  return `${"*".repeat(Math.max(normalized.length - 4, 4))}${normalized.slice(-4)}`;
}

export function toCsv(rows) {
  if (rows.length === 0) {
    return "";
  }
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value) => {
    const normalized = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
  };
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(","))
  ].join("\n");
}

export function checksum(payload) {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(",")}}`;
}

function humanise(measure) {
  const spaced = measure.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").toLowerCase();
  return spaced.replace(/^./, (character) => character.toUpperCase());
}

function sumUnits(values) {
  return values.reduce((total, value) => total + toUnits(value), 0n);
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
  return `${negative ? "-" : ""}${absolute / UNIT_SCALE}.${(absolute % UNIT_SCALE).toString().padStart(4, "0")}`;
}

function problem(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
