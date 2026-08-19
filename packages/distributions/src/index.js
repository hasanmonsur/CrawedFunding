import {
  DISTRIBUTION_BASES,
  PERMISSIONS,
  RESIDUAL_POLICIES,
  assertFourEyes,
  assertImmutablePublication,
  assertMoney,
  assertRatePercent,
  buildAuditEvent,
  canTransition
} from "../../domain-contracts/src/index.js";

const UNIT_SCALE = 10000n;
const MINOR_UNIT = 100n;
const RATE_SCALE = 1000000n;
const DAY_MS = 24 * 60 * 60 * 1000;

export function createDistributionService({
  identity,
  accountingService,
  investmentService,
  investorService,
  formulaVersions = [],
  distributions = [],
  settlements = [],
  auditEvents = []
}) {
  return {
    createFormulaVersion,
    publishFormulaVersion,
    listFormulaVersions,
    createDistributionProposal,
    calculateDistribution,
    reviewDistribution,
    approveDistribution,
    postDistributionPayable,
    createPaymentBatch,
    recordPaymentResults,
    reissueEntitlement,
    holdEntitlement,
    releaseEntitlementHold,
    cancelEntitlement,
    reconcileDistribution,
    completeDistribution,
    listDistributions,
    getDistribution,
    getInvestorStatement,
    closeProjectSettlement,
    archiveProjectSettlement,
    getAuditEvents: () => auditEvents.slice()
  };

  function createFormulaVersion({
    principal,
    organizationId,
    projectId,
    basis = DISTRIBUTION_BASES.capital,
    minimumHoldingDays = 0,
    lossCarryForwardEnabled = true,
    residualPolicy = RESIDUAL_POLICIES.largestRemainder,
    withholdingRatePercent = "0.0000",
    reserveRatePercent = "0.0000",
    notes,
    correlationId
  }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionCreate, organizationId, projectId });
    if (!Object.values(DISTRIBUTION_BASES).includes(basis)) {
      throw problem(400, "distribution_basis_invalid", `Unsupported distribution basis: ${basis}.`);
    }
    if (!Object.values(RESIDUAL_POLICIES).includes(residualPolicy)) {
      throw problem(400, "residual_policy_invalid", `Unsupported residual policy: ${residualPolicy}.`);
    }
    if (!Number.isInteger(minimumHoldingDays) || minimumHoldingDays < 0) {
      throw problem(400, "holding_period_invalid", "Minimum holding days must be a non-negative integer.");
    }
    const withholding = validateRate(withholdingRatePercent, "Withholding rate");
    const reserve = validateRate(reserveRatePercent, "Reserve rate");
    const previous = listProjectFormulaVersions({ organizationId, projectId });
    const formula = {
      formulaVersionId: `formula_${formulaVersions.length + 1}`,
      organizationId,
      projectId,
      version: previous.length + 1,
      status: "Draft",
      basis,
      minimumHoldingDays,
      lossCarryForwardEnabled: Boolean(lossCarryForwardEnabled),
      roundingMode: "floor-to-minor-unit",
      minorUnitScale: 2,
      residualPolicy,
      withholdingRatePercent: withholding,
      reserveRatePercent: reserve,
      notes: notes ?? null,
      createdByUserId: principal.user.userId,
      publishedByUserId: null,
      publishedAt: null
    };
    formulaVersions.push(formula);
    audit({ principal, organizationId, projectId, action: "distribution.formula.create", entityType: "DistributionFormulaVersion", entityId: formula.formulaVersionId, correlationId });
    return { ...formula };
  }

  function publishFormulaVersion({ principal, organizationId, projectId, formulaVersionId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionApprove, organizationId, projectId });
    const formula = findFormulaOrThrow({ organizationId, projectId, formulaVersionId });
    assertImmutablePublicationOrThrow(formula);
    assertFourEyes({
      creatorUserId: formula.createdByUserId,
      approverUserId: principal.user.userId,
      action: "Distribution formula publication"
    });
    for (const candidate of listProjectFormulaVersions({ organizationId, projectId })) {
      if (candidate.status === "Published") {
        candidate.status = "Retired";
      }
    }
    formula.status = "Published";
    formula.publishedByUserId = principal.user.userId;
    formula.publishedAt = new Date().toISOString();
    audit({ principal, organizationId, projectId, action: "distribution.formula.publish", entityType: "DistributionFormulaVersion", entityId: formulaVersionId, correlationId });
    return { ...formula };
  }

  function listFormulaVersions({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionReview, organizationId, projectId });
    return listProjectFormulaVersions({ organizationId, projectId }).map((formula) => ({ ...formula }));
  }

  function createDistributionProposal({ principal, organizationId, projectId, periodId, formulaVersionId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionCreate, organizationId, projectId });
    const periodResult = accountingService.getPeriodResult({ organizationId, projectId, periodId });
    if (periodResult.periodStatus !== "Locked") {
      throw problem(409, "period_not_locked", "Distribution requires a locked accounting period.");
    }
    const formula = findFormulaOrThrow({ organizationId, projectId, formulaVersionId });
    if (formula.status !== "Published") {
      throw problem(409, "formula_not_published", "Distribution requires a published formula version.");
    }
    const existing = distributions.find((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.projectId === projectId &&
      candidate.periodId === periodId &&
      candidate.status !== "Cancelled"
    ));
    if (existing) {
      throw problem(409, "distribution_period_duplicate", "A distribution already exists for this period.");
    }
    const distributableProfit = formula.lossCarryForwardEnabled
      ? periodResult.distributableProfit
      : maxAmount(periodResult.netResult, "0.0000");
    if (toUnits(distributableProfit) <= 0n) {
      throw problem(409, "no_distributable_profit", "Period produced no distributable profit after approved loss treatment.");
    }
    const distribution = {
      distributionId: `distribution_${distributions.length + 1}`,
      organizationId,
      projectId,
      periodId,
      periodCode: periodResult.periodCode,
      periodStart: periodResult.periodStart,
      periodEnd: periodResult.periodEnd,
      formulaVersionId,
      currency: periodResult.currency,
      status: "Draft",
      netResult: periodResult.netResult,
      resultType: periodResult.resultType,
      lossCarryForwardIn: periodResult.lossCarryForwardIn,
      lossCarryForwardApplied: periodResult.lossCarryForwardApplied,
      lossCarryForwardOut: periodResult.lossCarryForwardOut,
      distributableAmount: distributableProfit,
      reserveAmount: "0.0000",
      roundingResidualAmount: "0.0000",
      residualAmount: "0.0000",
      grossTotal: "0.0000",
      withholdingTotal: "0.0000",
      netTotal: "0.0000",
      createdByUserId: principal.user.userId,
      reviewedByUserId: null,
      approvedByUserId: null,
      payableVoucherId: null,
      batchRef: null,
      batchSequence: 0,
      reconciledNetTotal: null,
      entitlements: []
    };
    distributions.push(distribution);
    audit({ principal, organizationId, projectId, action: "distribution.proposal.create", entityType: "Distribution", entityId: distribution.distributionId, correlationId });
    return cloneDistribution(distribution);
  }

  function calculateDistribution({ principal, organizationId, projectId, distributionId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionCreate, organizationId, projectId });
    const distribution = findDistributionOrThrow({ organizationId, projectId, distributionId });
    if (distribution.status !== "Draft") {
      throw problem(409, "distribution_not_draft", "Only a draft distribution can be calculated.");
    }
    const formula = findFormulaOrThrow({ organizationId, projectId, formulaVersionId: distribution.formulaVersionId });
    const period = accountingService.getPeriodResult({ organizationId, projectId, periodId: distribution.periodId });
    const holdings = investmentService.listProjectHoldings({ organizationId, projectId });
    const calculated = calculateEntitlements({ distribution, formula, holdings, period });
    Object.assign(distribution, calculated);
    transitionDistribution({ principal, distribution, to: "Calculated", action: "distribution.calculate", correlationId });
    return cloneDistribution(distribution);
  }

  function reviewDistribution({ principal, organizationId, projectId, distributionId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionReview, organizationId, projectId });
    const distribution = findDistributionOrThrow({ organizationId, projectId, distributionId });
    assertFourEyes({
      creatorUserId: distribution.createdByUserId,
      approverUserId: principal.user.userId,
      action: "Distribution review"
    });
    transitionDistribution({ principal, distribution, to: "Reviewed", action: "distribution.review", correlationId });
    distribution.reviewedByUserId = principal.user.userId;
    return cloneDistribution(distribution);
  }

  function approveDistribution({ principal, organizationId, projectId, distributionId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionApprove, organizationId, projectId });
    const distribution = findDistributionOrThrow({ organizationId, projectId, distributionId });
    if (distribution.status !== "Reviewed") {
      throw problem(409, "distribution_not_reviewed", "Distribution must be independently reviewed before approval.");
    }
    assertFourEyes({
      creatorUserId: distribution.createdByUserId,
      approverUserId: principal.user.userId,
      action: "Distribution approval"
    });
    assertFourEyes({
      creatorUserId: distribution.reviewedByUserId,
      approverUserId: principal.user.userId,
      action: "Distribution approval"
    });
    identity.authorizeAmount({
      principal,
      permission: PERMISSIONS.distributionApprove,
      organizationId,
      projectId,
      amount: distribution.grossTotal,
      currency: distribution.currency
    });
    transitionDistribution({ principal, distribution, to: "Approved", action: "distribution.approve", correlationId });
    distribution.approvedByUserId = principal.user.userId;
    return cloneDistribution(distribution);
  }

  function postDistributionPayable({ principal, organizationId, projectId, distributionId, postedVoucherId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionPay, organizationId, projectId });
    const distribution = findDistributionOrThrow({ organizationId, projectId, distributionId });
    if (distribution.status !== "Approved") {
      throw problem(409, "distribution_not_approved", "Distribution payable requires an approved distribution.");
    }
    const voucher = accountingService.getPostedVoucherSummary({ organizationId, projectId, voucherId: postedVoucherId });
    if (voucher.amount !== distribution.grossTotal || voucher.currency !== distribution.currency) {
      throw problem(409, "payable_voucher_mismatch", "Posted voucher amount does not match the approved distribution total.");
    }
    transitionDistribution({ principal, distribution, to: "Payable Posted", action: "distribution.payable.post", correlationId });
    distribution.payableVoucherId = postedVoucherId;
    for (const entitlement of distribution.entitlements) {
      if (entitlement.status === "Eligible") {
        transitionEntitlement({ entitlement, to: "Payable" });
      }
    }
    return { ...cloneDistribution(distribution), voucher };
  }

  function createPaymentBatch({ principal, organizationId, projectId, distributionId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionPay, organizationId, projectId });
    const distribution = findDistributionOrThrow({ organizationId, projectId, distributionId });
    if (!["Payable Posted", "Payment Submitted", "Partially Paid"].includes(distribution.status)) {
      throw problem(409, "distribution_payable_required", "Payment batch requires a posted distribution payable.");
    }
    const payable = distribution.entitlements.filter((entitlement) => entitlement.status === "Payable");
    if (payable.length === 0) {
      throw problem(409, "distribution_batch_empty", "No payable entitlements are available for a payment batch.");
    }
    const batchRef = `batch_${distribution.distributionId}_${(distribution.batchSequence ?? 0) + 1}`;
    distribution.batchSequence = (distribution.batchSequence ?? 0) + 1;
    distribution.batchRef = batchRef;
    for (const entitlement of payable) {
      transitionEntitlement({ entitlement, to: "Payment Submitted" });
      entitlement.batchRef = batchRef;
    }
    if (distribution.status === "Payment Submitted") {
      audit({ principal, organizationId, projectId, action: "distribution.payment_batch.submit", entityType: "Distribution", entityId: distributionId, correlationId });
    } else {
      transitionDistribution({ principal, distribution, to: "Payment Submitted", action: "distribution.payment_batch.submit", correlationId });
    }
    return {
      batchRef,
      distributionId: distribution.distributionId,
      organizationId,
      projectId,
      currency: distribution.currency,
      lines: payable.map((entitlement) => ({
        entitlementId: entitlement.entitlementId,
        investorId: entitlement.investorId,
        payoutAccountRef: entitlement.payoutAccountRef,
        netAmount: entitlement.netAmount,
        currency: entitlement.currency
      })),
      heldEntitlements: distribution.entitlements
        .filter((entitlement) => entitlement.status === "Held")
        .map((entitlement) => ({ entitlementId: entitlement.entitlementId, holdReason: entitlement.holdReason }))
    };
  }

  function recordPaymentResults({ principal, organizationId, projectId, distributionId, results, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionPay, organizationId, projectId });
    const distribution = findDistributionOrThrow({ organizationId, projectId, distributionId });
    if (!Array.isArray(results) || results.length === 0) {
      throw problem(400, "payment_results_required", "At least one payment result is required.");
    }
    for (const result of results) {
      const entitlement = findEntitlementOrThrow({ distribution, entitlementId: result.entitlementId });
      if (!["Paid", "Failed", "Returned"].includes(result.outcome)) {
        throw problem(400, "payment_outcome_invalid", `Unsupported payment outcome: ${result.outcome}.`);
      }
      if (result.outcome !== "Paid" && !result.reason) {
        throw problem(400, "payment_failure_reason_required", "Failed or returned payments require a reason.");
      }
      transitionEntitlement({ entitlement, to: result.outcome });
      entitlement.paymentReference = result.paymentReference ?? entitlement.paymentReference ?? null;
      entitlement.failureReason = result.outcome === "Paid" ? null : result.reason;
    }
    const submitted = distribution.entitlements.filter((entitlement) => entitlement.status === "Payment Submitted");
    const unsuccessful = distribution.entitlements.filter((entitlement) => ["Failed", "Returned"].includes(entitlement.status));
    if (submitted.length === 0 && unsuccessful.length > 0 && distribution.status === "Payment Submitted") {
      transitionDistribution({ principal, distribution, to: "Partially Paid", action: "distribution.payment.partial", correlationId });
    }
    audit({ principal, organizationId, projectId, action: "distribution.payment.record_results", entityType: "Distribution", entityId: distributionId, correlationId });
    return cloneDistribution(distribution);
  }

  function reissueEntitlement({ principal, organizationId, projectId, distributionId, entitlementId, reason, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionPay, organizationId, projectId });
    const distribution = findDistributionOrThrow({ organizationId, projectId, distributionId });
    const entitlement = findEntitlementOrThrow({ distribution, entitlementId });
    if (!reason) {
      throw problem(400, "reissue_reason_required", "Reissue requires a documented reason.");
    }
    transitionEntitlement({ entitlement, to: "Payment Submitted" });
    entitlement.reissueCount = (entitlement.reissueCount ?? 0) + 1;
    entitlement.failureReason = null;
    entitlement.reissueReason = reason;
    if (distribution.status === "Partially Paid") {
      transitionDistribution({ principal, distribution, to: "Payment Submitted", action: "distribution.payment.reissue", correlationId });
    } else {
      audit({ principal, organizationId, projectId, action: "distribution.payment.reissue", entityType: "DistributionEntitlement", entityId: entitlementId, reason, correlationId });
    }
    return cloneDistribution(distribution);
  }

  function holdEntitlement({ principal, organizationId, projectId, distributionId, entitlementId, reason, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionHoldManage, organizationId, projectId });
    const distribution = findDistributionOrThrow({ organizationId, projectId, distributionId });
    const entitlement = findEntitlementOrThrow({ distribution, entitlementId });
    if (!reason) {
      throw problem(400, "hold_reason_required", "Entitlement hold requires a documented reason.");
    }
    transitionEntitlement({ entitlement, to: "Held" });
    entitlement.holdReason = reason;
    audit({ principal, organizationId, projectId, action: "distribution.entitlement.hold", entityType: "DistributionEntitlement", entityId: entitlementId, reason, correlationId });
    return cloneDistribution(distribution);
  }

  function releaseEntitlementHold({ principal, organizationId, projectId, distributionId, entitlementId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionHoldManage, organizationId, projectId });
    const distribution = findDistributionOrThrow({ organizationId, projectId, distributionId });
    const entitlement = findEntitlementOrThrow({ distribution, entitlementId });
    const settlementProfile = investorService.getInvestorSettlementProfile({ organizationId, investorId: entitlement.investorId });
    const blocking = evaluateHoldReason(settlementProfile);
    if (blocking) {
      throw problem(409, "entitlement_hold_condition_active", `Entitlement hold cannot be released: ${blocking}.`);
    }
    transitionEntitlement({ entitlement, to: "Eligible" });
    entitlement.holdReason = null;
    entitlement.payoutAccountRef = settlementProfile.payoutAccountRef;
    if (["Payable Posted", "Payment Submitted", "Partially Paid"].includes(distribution.status)) {
      transitionEntitlement({ entitlement, to: "Payable" });
    }
    audit({ principal, organizationId, projectId, action: "distribution.entitlement.release_hold", entityType: "DistributionEntitlement", entityId: entitlementId, correlationId });
    return cloneDistribution(distribution);
  }

  function cancelEntitlement({ principal, organizationId, projectId, distributionId, entitlementId, reason, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionApprove, organizationId, projectId });
    const distribution = findDistributionOrThrow({ organizationId, projectId, distributionId });
    const entitlement = findEntitlementOrThrow({ distribution, entitlementId });
    if (!reason) {
      throw problem(400, "cancel_reason_required", "Cancelling an entitlement requires a documented reason.");
    }
    transitionEntitlement({ entitlement, to: "Cancelled" });
    entitlement.cancellationReason = reason;
    audit({ principal, organizationId, projectId, action: "distribution.entitlement.cancel", entityType: "DistributionEntitlement", entityId: entitlementId, reason, correlationId });
    return cloneDistribution(distribution);
  }

  function reconcileDistribution({ principal, organizationId, projectId, distributionId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionReview, organizationId, projectId });
    const distribution = findDistributionOrThrow({ organizationId, projectId, distributionId });
    const outstanding = distribution.entitlements.filter((entitlement) => (
      ["Payable", "Payment Submitted", "Failed", "Returned"].includes(entitlement.status)
    ));
    if (outstanding.length > 0) {
      throw problem(409, "distribution_payments_outstanding", `Distribution has ${outstanding.length} unsettled payment(s).`);
    }
    let paidTotal = 0n;
    for (const entitlement of distribution.entitlements) {
      if (entitlement.status === "Paid") {
        transitionEntitlement({ entitlement, to: "Reconciled" });
        paidTotal += toUnits(entitlement.netAmount);
      }
    }
    distribution.reconciledNetTotal = fromUnits(paidTotal);
    transitionDistribution({ principal, distribution, to: "Reconciled", action: "distribution.reconcile", correlationId });
    return cloneDistribution(distribution);
  }

  function completeDistribution({ principal, organizationId, projectId, distributionId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionApprove, organizationId, projectId });
    const distribution = findDistributionOrThrow({ organizationId, projectId, distributionId });
    const unresolved = distribution.entitlements.filter((entitlement) => (
      !["Reconciled", "Excluded", "Cancelled", "Completed"].includes(entitlement.status)
    ));
    if (unresolved.length > 0) {
      throw problem(409, "distribution_entitlements_unresolved", `Distribution has ${unresolved.length} unresolved entitlement(s).`);
    }
    for (const entitlement of distribution.entitlements) {
      if (entitlement.status === "Reconciled") {
        transitionEntitlement({ entitlement, to: "Completed" });
      }
    }
    transitionDistribution({ principal, distribution, to: "Completed", action: "distribution.complete", correlationId });
    return cloneDistribution(distribution);
  }

  function listDistributions({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionReview, organizationId, projectId });
    return distributions
      .filter((distribution) => distribution.organizationId === organizationId && distribution.projectId === projectId)
      .map(cloneDistribution);
  }

  function getDistribution({ principal, organizationId, projectId, distributionId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionReview, organizationId, projectId });
    return cloneDistribution(findDistributionOrThrow({ organizationId, projectId, distributionId }));
  }

  function getInvestorStatement({ principal, organizationId, projectId }) {
    const profile = investorService.getMyInvestorProfile({ principal });
    const relevant = distributions.filter((distribution) => (
      distribution.organizationId === organizationId &&
      (projectId === undefined || distribution.projectId === projectId) &&
      distribution.status !== "Draft"
    ));
    let gross = 0n;
    let withholding = 0n;
    let net = 0n;
    let paid = 0n;
    const lines = [];
    for (const distribution of relevant) {
      for (const entitlement of distribution.entitlements) {
        if (entitlement.investorId !== profile.investorId) {
          continue;
        }
        gross += toUnits(entitlement.grossAmount);
        withholding += toUnits(entitlement.withholdingAmount);
        net += toUnits(entitlement.netAmount);
        if (["Paid", "Reconciled", "Completed"].includes(entitlement.status)) {
          paid += toUnits(entitlement.netAmount);
        }
        lines.push({
          distributionId: distribution.distributionId,
          projectId: distribution.projectId,
          periodId: distribution.periodId,
          formulaVersionId: distribution.formulaVersionId,
          entitlementId: entitlement.entitlementId,
          basis: entitlement.basis,
          capitalAmount: entitlement.capitalAmount,
          weight: entitlement.weight,
          grossAmount: entitlement.grossAmount,
          withholdingAmount: entitlement.withholdingAmount,
          netAmount: entitlement.netAmount,
          currency: entitlement.currency,
          status: entitlement.status,
          holdReason: entitlement.holdReason ?? null,
          paymentReference: entitlement.paymentReference ?? null
        });
      }
    }
    return {
      organizationId,
      investorId: profile.investorId,
      projectId: projectId ?? null,
      totals: {
        grossAmount: fromUnits(gross),
        withholdingAmount: fromUnits(withholding),
        netAmount: fromUnits(net),
        paidAmount: fromUnits(paid)
      },
      lines
    };
  }

  function closeProjectSettlement({ principal, organizationId, projectId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionApprove, organizationId, projectId });
    const projectDistributions = distributions.filter((distribution) => (
      distribution.organizationId === organizationId && distribution.projectId === projectId
    ));
    const open = projectDistributions.filter((distribution) => !["Completed", "Cancelled"].includes(distribution.status));
    if (open.length > 0) {
      throw problem(409, "project_distributions_open", `Project has ${open.length} distribution(s) that are not completed.`);
    }
    if (settlements.some((settlement) => settlement.organizationId === organizationId && settlement.projectId === projectId)) {
      throw problem(409, "project_settlement_exists", "Project settlement already recorded.");
    }
    const carryForward = accountingService.getProjectLossCarryForward({ organizationId, projectId });
    let gross = 0n;
    let withholding = 0n;
    let net = 0n;
    for (const distribution of projectDistributions) {
      if (distribution.status !== "Completed") {
        continue;
      }
      gross += toUnits(distribution.grossTotal);
      withholding += toUnits(distribution.withholdingTotal);
      net += toUnits(distribution.netTotal);
    }
    const settlement = {
      settlementId: `settlement_${settlements.length + 1}`,
      organizationId,
      projectId,
      status: "Draft",
      distributionsCompleted: projectDistributions.filter((distribution) => distribution.status === "Completed").length,
      lifetimeGrossDistributed: fromUnits(gross),
      lifetimeWithholding: fromUnits(withholding),
      lifetimeNetDistributed: fromUnits(net),
      residualLossCarryForward: carryForward.lossCarryForward,
      settledByUserId: null,
      settledAt: null,
      archivedByUserId: null,
      archivedAt: null
    };
    settlements.push(settlement);
    settlement.settledHoldings = investmentService.settleProjectHoldings({
      organizationId,
      projectId,
      actorUserId: principal.user.userId,
      correlationId
    }).length;
    transitionSettlement({ principal, settlement, to: "Settled", action: "distribution.project.settle", correlationId });
    settlement.settledByUserId = principal.user.userId;
    settlement.settledAt = new Date().toISOString();
    return { ...settlement };
  }

  function archiveProjectSettlement({ principal, organizationId, projectId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.distributionApprove, organizationId, projectId });
    const settlement = settlements.find((candidate) => (
      candidate.organizationId === organizationId && candidate.projectId === projectId
    ));
    if (!settlement) {
      throw problem(404, "project_settlement_not_found", "Project settlement not found.");
    }
    assertFourEyes({
      creatorUserId: settlement.settledByUserId,
      approverUserId: principal.user.userId,
      action: "Project settlement archive"
    });
    transitionSettlement({ principal, settlement, to: "Archived", action: "distribution.project.archive", correlationId });
    settlement.archivedByUserId = principal.user.userId;
    settlement.archivedAt = new Date().toISOString();
    return { ...settlement };
  }

  function calculateEntitlements({ distribution, formula, holdings, period }) {
    const currency = distribution.currency;
    const periodEnd = new Date(period.periodEnd ?? distribution.periodEnd ?? Date.now());
    const periodStart = new Date(period.periodStart ?? 0);
    const poolMinor = toUnits(distribution.distributableAmount) / MINOR_UNIT;
    const reserveMinor = (poolMinor * rateToScaled(formula.reserveRatePercent)) / RATE_SCALE;
    const allocatableMinor = poolMinor - reserveMinor;

    const candidates = holdings
      .slice()
      .sort((left, right) => left.commitmentId.localeCompare(right.commitmentId))
      .map((holding) => {
        const eligibleDays = computeEligibleDays({ holding, periodStart, periodEnd });
        const capitalMinor = toUnits(holding.capitalAmount) / MINOR_UNIT;
        const currencyMismatch = holding.currency !== currency;
        const allocationMissing = !holding.allocatedAt;
        const holdingTooShort = formula.basis === DISTRIBUTION_BASES.capitalHoldingPeriod &&
          eligibleDays < formula.minimumHoldingDays;
        const notAllocatedInPeriod = !allocationMissing && new Date(holding.allocatedAt) > periodEnd;
        const weight = formula.basis === DISTRIBUTION_BASES.capitalHoldingPeriod
          ? capitalMinor * BigInt(Math.max(eligibleDays, 0))
          : capitalMinor;
        const excluded = currencyMismatch || allocationMissing || holdingTooShort || notAllocatedInPeriod || weight <= 0n;
        return {
          holding,
          eligibleDays,
          capitalMinor,
          weight: excluded ? 0n : weight,
          excluded,
          exclusionReason: currencyMismatch
            ? "currency_mismatch"
            : allocationMissing
              ? "allocation_date_missing"
              : notAllocatedInPeriod
                ? "allocated_after_period_end"
                : holdingTooShort
                  ? "minimum_holding_period_not_met"
                  : weight <= 0n
                    ? "zero_capital_weight"
                    : null
        };
      });

    const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0n);
    if (totalWeight <= 0n) {
      throw problem(409, "no_eligible_holdings", "No eligible investor holdings are available for distribution.");
    }

    const shares = candidates.map((candidate) => {
      if (candidate.excluded) {
        return { ...candidate, shareMinor: 0n, remainder: 0n };
      }
      const numerator = allocatableMinor * candidate.weight;
      return {
        ...candidate,
        shareMinor: numerator / totalWeight,
        remainder: numerator % totalWeight
      };
    });

    let allocatedMinor = shares.reduce((sum, share) => sum + share.shareMinor, 0n);
    let roundingResidualMinor = allocatableMinor - allocatedMinor;
    if (formula.residualPolicy === RESIDUAL_POLICIES.largestRemainder && roundingResidualMinor > 0n) {
      const ranked = shares
        .filter((share) => !share.excluded)
        .slice()
        .sort((left, right) => {
          if (left.remainder === right.remainder) {
            return left.holding.commitmentId.localeCompare(right.holding.commitmentId);
          }
          return left.remainder > right.remainder ? -1 : 1;
        });
      for (let index = 0; index < ranked.length && roundingResidualMinor > 0n; index += 1) {
        ranked[index].shareMinor += 1n;
        roundingResidualMinor -= 1n;
      }
      allocatedMinor = shares.reduce((sum, share) => sum + share.shareMinor, 0n);
    }

    const withholdingRate = rateToScaled(formula.withholdingRatePercent);
    const entitlements = [];
    let grossTotal = 0n;
    let withholdingTotal = 0n;
    let netTotal = 0n;

    for (const share of shares) {
      const settlementProfile = investorService.getInvestorSettlementProfile({
        organizationId: distribution.organizationId,
        investorId: share.holding.investorId
      });
      const grossMinor = share.shareMinor;
      const withholdingMinor = (grossMinor * withholdingRate) / RATE_SCALE;
      const netMinor = grossMinor - withholdingMinor;
      const holdReason = share.excluded ? null : evaluateHoldReason(settlementProfile);
      const status = share.excluded ? "Excluded" : holdReason ? "Held" : "Eligible";
      grossTotal += grossMinor;
      withholdingTotal += withholdingMinor;
      netTotal += netMinor;
      entitlements.push({
        entitlementId: `entitlement_${distribution.distributionId}_${entitlements.length + 1}`,
        organizationId: distribution.organizationId,
        projectId: distribution.projectId,
        distributionId: distribution.distributionId,
        investorId: share.holding.investorId,
        commitmentId: share.holding.commitmentId,
        basis: formula.basis,
        capitalAmount: fromUnits(share.capitalMinor * MINOR_UNIT),
        eligibleDays: share.eligibleDays,
        weight: share.weight.toString(),
        grossAmount: fromUnits(grossMinor * MINOR_UNIT),
        withholdingAmount: fromUnits(withholdingMinor * MINOR_UNIT),
        netAmount: fromUnits(netMinor * MINOR_UNIT),
        currency,
        status,
        holdReason,
        exclusionReason: share.exclusionReason,
        payoutAccountRef: settlementProfile.payoutAccountRef,
        paymentReference: null,
        failureReason: null,
        batchRef: null,
        reissueCount: 0
      });
    }

    const residualMinor = toUnits(distribution.distributableAmount) / MINOR_UNIT - grossTotal;
    const subUnitRemainder = toUnits(distribution.distributableAmount) % MINOR_UNIT;

    return {
      entitlements,
      grossTotal: fromUnits(grossTotal * MINOR_UNIT),
      withholdingTotal: fromUnits(withholdingTotal * MINOR_UNIT),
      netTotal: fromUnits(netTotal * MINOR_UNIT),
      reserveAmount: fromUnits(reserveMinor * MINOR_UNIT),
      roundingResidualAmount: fromUnits(roundingResidualMinor * MINOR_UNIT),
      residualAmount: fromUnits(residualMinor * MINOR_UNIT + subUnitRemainder),
      eligibleHoldings: shares.filter((share) => !share.excluded).length,
      excludedHoldings: shares.filter((share) => share.excluded).length,
      totalWeight: totalWeight.toString()
    };
  }

  function computeEligibleDays({ holding, periodStart, periodEnd }) {
    if (!holding.allocatedAt) {
      return 0;
    }
    const allocated = new Date(holding.allocatedAt);
    const from = allocated > periodStart ? allocated : periodStart;
    if (from > periodEnd) {
      return 0;
    }
    return Math.floor((periodEnd.getTime() - from.getTime()) / DAY_MS) + 1;
  }

  function evaluateHoldReason(settlementProfile) {
    if (settlementProfile.kycStatus !== "Approved") {
      return `investor_kyc_${settlementProfile.kycStatus.toLowerCase().replaceAll(" ", "_")}`;
    }
    if (settlementProfile.holdStatus !== "None") {
      return `investor_hold_${settlementProfile.holdStatus.toLowerCase().replaceAll(" ", "_")}`;
    }
    if (!settlementProfile.hasPayoutAccount) {
      return "investor_payout_account_missing";
    }
    return null;
  }

  function transitionDistribution({ principal, distribution, to, action, correlationId }) {
    if (!canTransition("distribution", distribution.status, to)) {
      throw problem(409, "invalid_distribution_transition", `Distribution cannot transition from ${distribution.status} to ${to}.`);
    }
    distribution.status = to;
    audit({
      principal,
      organizationId: distribution.organizationId,
      projectId: distribution.projectId,
      action,
      entityType: "Distribution",
      entityId: distribution.distributionId,
      correlationId
    });
  }

  function transitionSettlement({ principal, settlement, to, action, correlationId }) {
    if (!canTransition("projectSettlement", settlement.status, to)) {
      throw problem(409, "invalid_settlement_transition", `Project settlement cannot transition from ${settlement.status} to ${to}.`);
    }
    settlement.status = to;
    audit({
      principal,
      organizationId: settlement.organizationId,
      projectId: settlement.projectId,
      action,
      entityType: "ProjectSettlement",
      entityId: settlement.settlementId,
      correlationId
    });
  }

  function transitionEntitlement({ entitlement, to }) {
    if (!canTransition("entitlement", entitlement.status, to)) {
      throw problem(409, "invalid_entitlement_transition", `Entitlement cannot transition from ${entitlement.status} to ${to}.`);
    }
    entitlement.status = to;
    return entitlement;
  }

  function listProjectFormulaVersions({ organizationId, projectId }) {
    return formulaVersions.filter((formula) => (
      formula.organizationId === organizationId && formula.projectId === projectId
    ));
  }

  function findFormulaOrThrow({ organizationId, projectId, formulaVersionId }) {
    const formula = formulaVersions.find((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.projectId === projectId &&
      candidate.formulaVersionId === formulaVersionId
    ));
    if (!formula) {
      throw problem(404, "formula_version_not_found", "Distribution formula version not found.");
    }
    return formula;
  }

  function findDistributionOrThrow({ organizationId, projectId, distributionId }) {
    const distribution = distributions.find((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.projectId === projectId &&
      candidate.distributionId === distributionId
    ));
    if (!distribution) {
      throw problem(404, "distribution_not_found", "Distribution not found.");
    }
    return distribution;
  }

  function findEntitlementOrThrow({ distribution, entitlementId }) {
    const entitlement = distribution.entitlements.find((candidate) => candidate.entitlementId === entitlementId);
    if (!entitlement) {
      throw problem(404, "entitlement_not_found", "Distribution entitlement not found.");
    }
    return entitlement;
  }

  function assertImmutablePublicationOrThrow(formula) {
    try {
      assertImmutablePublication(formula, "Distribution formula version");
    } catch (error) {
      throw problem(409, "formula_version_immutable", error.message);
    }
  }

  function validateRate(value, label) {
    try {
      return assertRatePercent(value, label);
    } catch (error) {
      throw problem(400, "rate_invalid", error.message);
    }
  }

  function cloneDistribution(distribution) {
    return {
      ...distribution,
      entitlements: distribution.entitlements.map((entitlement) => ({ ...entitlement }))
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

export function toUnits(value) {
  const normalized = String(value ?? "0");
  const negative = normalized.startsWith("-");
  const [whole, fraction = ""] = (negative ? normalized.slice(1) : normalized).split(".");
  const units = BigInt(whole || "0") * UNIT_SCALE + BigInt((`${fraction}0000`).slice(0, 4));
  return negative ? units * -1n : units;
}

export function fromUnits(units) {
  const negative = units < 0n;
  const absolute = negative ? units * -1n : units;
  const whole = absolute / UNIT_SCALE;
  const fraction = absolute % UNIT_SCALE;
  return `${negative ? "-" : ""}${whole}.${fraction.toString().padStart(4, "0")}`;
}

function rateToScaled(ratePercent) {
  return (toUnits(ratePercent) * RATE_SCALE) / (100n * UNIT_SCALE);
}

function maxAmount(left, right) {
  return toUnits(left) >= toUnits(right) ? assertAmountString(left) : assertAmountString(right);
}

function assertAmountString(value) {
  const normalized = String(value);
  if (normalized.startsWith("-")) {
    return normalized;
  }
  return assertMoney(normalized).amount;
}

function problem(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
