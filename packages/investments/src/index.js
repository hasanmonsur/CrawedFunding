import {
  PERMISSIONS,
  assertMoney,
  buildAuditEvent,
  canTransition
} from "../../domain-contracts/src/index.js";

export function createInvestmentService({
  identity,
  investorService,
  projectService,
  commitments = [],
  watchlist = [],
  suitability = [],
  auditEvents = []
}) {
  return {
    listMarketplaceProjects,
    getOfferDisclosure,
    addToWatchlist,
    recordSuitability,
    createCommitment,
    acceptAgreement,
    getCommitmentForPayment,
    markCommitmentPaid,
    markCommitmentReconciled,
    allocateCommitment,
    activateCommitment,
    listProjectHoldings,
    settleProjectHoldings,
    getPortfolio,
    getAuditEvents: () => auditEvents.slice()
  };

  function listMarketplaceProjects({ organizationId }) {
    return projectService.listPublishedProjects({ organizationId }).map((project) => ({
      organizationId: project.organizationId,
      projectId: project.projectId,
      title: project.title,
      status: project.status,
      currency: project.currency,
      fundingTarget: project.fundingTarget,
      minimumInvestment: project.minimumInvestment,
      maximumInvestment: project.maximumInvestment,
      offerVersionId: project.latestOfferVersion.offerVersionId,
      riskBand: project.latestOfferVersion.snapshot.riskBand
    }));
  }

  function getOfferDisclosure({ organizationId, projectId, offerVersionId }) {
    const { offer, project } = projectService.findPublishedOfferVersion({ organizationId, projectId, offerVersionId });
    return {
      project,
      offer,
      disclosures: [
        "Investment returns are not guaranteed.",
        "Investor must review project risks and accepted offer version.",
        "Payment and allocation happen only after reconciliation."
      ]
    };
  }

  function addToWatchlist({ principal, organizationId, projectId, offerVersionId, correlationId }) {
    const investorProfile = requireInvestor(principal);
    projectService.findPublishedOfferVersion({ organizationId, projectId, offerVersionId });
    const item = {
      watchlistId: `watch_${watchlist.length + 1}`,
      organizationId,
      investorId: investorProfile.investorId,
      projectId,
      offerVersionId
    };
    watchlist.push(item);
    audit({ principal, organizationId, projectId, action: "investment.watchlist.add", entityType: "WatchlistItem", entityId: item.watchlistId, correlationId });
    return { ...item };
  }

  function recordSuitability({ principal, organizationId, projectId, offerVersionId, answers, riskAcknowledged, correlationId }) {
    const investorProfile = requireInvestor(principal);
    projectService.findPublishedOfferVersion({ organizationId, projectId, offerVersionId });
    if (riskAcknowledged !== true) {
      throw Object.assign(new Error("Risk acknowledgement is required before commitment."), {
        status: 409,
        code: "risk_acknowledgement_required"
      });
    }
    const record = {
      suitabilityId: `suitability_${suitability.length + 1}`,
      organizationId,
      investorId: investorProfile.investorId,
      projectId,
      offerVersionId,
      answers: { ...answers },
      riskAcknowledged: true
    };
    suitability.push(record);
    audit({ principal, organizationId, projectId, action: "investment.suitability.record", entityType: "Suitability", entityId: record.suitabilityId, correlationId });
    return { ...record, answers: { ...record.answers } };
  }

  function createCommitment({ principal, organizationId, projectId, offerVersionId, amount, currency = "BDT", correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.commitmentCreate,
      organizationId
    });
    const investorProfile = requireEligibleInvestor(principal);
    const { offer, project } = projectService.findPublishedOfferVersion({ organizationId, projectId, offerVersionId });
    const money = assertMoney(amount, currency);
    assertAmountWithinProjectLimits({ money, project });
    assertSuitabilityRecorded({ investorId: investorProfile.investorId, organizationId, projectId, offerVersionId });

    const commitment = {
      commitmentId: `commitment_${commitments.length + 1}`,
      organizationId,
      investorId: investorProfile.investorId,
      projectId,
      offerVersionId: offer.offerVersionId,
      acceptedOfferProjectVersion: offer.projectVersion,
      amount: money.amount,
      currency: money.currency,
      status: "Reserved",
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      agreementVersion: null
    };
    commitments.push(commitment);
    audit({ principal, organizationId, projectId, action: "investment.commitment.reserve", entityType: "Commitment", entityId: commitment.commitmentId, correlationId });
    return { ...commitment };
  }

  function acceptAgreement({ principal, organizationId, commitmentId, agreementVersion, correlationId }) {
    const investorProfile = requireInvestor(principal);
    const commitment = commitments.find((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.commitmentId === commitmentId &&
      candidate.investorId === investorProfile.investorId
    ));
    if (!commitment) {
      throw Object.assign(new Error("Commitment not found."), { status: 404, code: "commitment_not_found" });
    }
    if (!canTransition("investment", commitment.status, "Awaiting Payment")) {
      throw Object.assign(new Error(`Commitment cannot transition from ${commitment.status} to Awaiting Payment.`), {
        status: 409,
        code: "invalid_commitment_transition"
      });
    }
    commitment.status = "Awaiting Payment";
    commitment.agreementVersion = agreementVersion;
    audit({ principal, organizationId, projectId: commitment.projectId, action: "investment.agreement.accept", entityType: "Commitment", entityId: commitmentId, correlationId });
    return { ...commitment };
  }

  function getPortfolio({ principal, organizationId }) {
    const investorProfile = requireInvestor(principal);
    return commitments
      .filter((commitment) => commitment.organizationId === organizationId && commitment.investorId === investorProfile.investorId)
      .map((commitment) => ({ ...commitment }));
  }

  function getCommitmentForPayment({ organizationId, commitmentId }) {
    const commitment = commitments.find((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.commitmentId === commitmentId
    ));
    if (!commitment) {
      throw Object.assign(new Error("Commitment not found."), { status: 404, code: "commitment_not_found" });
    }
    return { ...commitment };
  }

  function markCommitmentPaid({ organizationId, commitmentId, correlationId, actorUserId = "system" }) {
    return transitionCommitment({
      organizationId,
      commitmentId,
      to: "Paid",
      action: "investment.commitment.mark_paid",
      actorUserId,
      correlationId
    });
  }

  function markCommitmentReconciled({ organizationId, commitmentId, correlationId, actorUserId = "system" }) {
    return transitionCommitment({
      organizationId,
      commitmentId,
      to: "Reconciled",
      action: "investment.commitment.mark_reconciled",
      actorUserId,
      correlationId
    });
  }

  function allocateCommitment({ principal, organizationId, projectId, commitmentId, allocatedAt, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId });
    const commitment = findCommitmentOrThrow({ organizationId, commitmentId });
    if (commitment.projectId !== projectId) {
      throw Object.assign(new Error("Commitment does not belong to the requested project."), {
        status: 403,
        code: "commitment_project_mismatch"
      });
    }
    const updated = transitionCommitment({
      organizationId,
      commitmentId,
      to: "Allocated",
      action: "investment.commitment.allocate",
      actorUserId: principal.user.userId,
      correlationId
    });
    commitment.allocatedAt = allocatedAt ?? new Date().toISOString();
    commitment.capitalAmount = commitment.amount;
    commitment.allocatedByUserId = principal.user.userId;
    return { ...updated, allocatedAt: commitment.allocatedAt, capitalAmount: commitment.capitalAmount };
  }

  function activateCommitment({ principal, organizationId, projectId, commitmentId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId });
    const commitment = findCommitmentOrThrow({ organizationId, commitmentId });
    if (commitment.projectId !== projectId) {
      throw Object.assign(new Error("Commitment does not belong to the requested project."), {
        status: 403,
        code: "commitment_project_mismatch"
      });
    }
    const updated = transitionCommitment({
      organizationId,
      commitmentId,
      to: "Active",
      action: "investment.commitment.activate",
      actorUserId: principal.user.userId,
      correlationId
    });
    commitment.activatedAt = new Date().toISOString();
    return { ...updated, activatedAt: commitment.activatedAt };
  }

  function listProjectHoldings({ organizationId, projectId }) {
    return commitments
      .filter((commitment) => (
        commitment.organizationId === organizationId &&
        commitment.projectId === projectId &&
        ["Allocated", "Active"].includes(commitment.status)
      ))
      .map((commitment) => ({
        organizationId,
        projectId,
        commitmentId: commitment.commitmentId,
        investorId: commitment.investorId,
        capitalAmount: commitment.capitalAmount ?? commitment.amount,
        currency: commitment.currency,
        status: commitment.status,
        allocatedAt: commitment.allocatedAt ?? null,
        activatedAt: commitment.activatedAt ?? null
      }));
  }

  function settleProjectHoldings({ organizationId, projectId, actorUserId = "system", correlationId }) {
    const settled = [];
    for (const commitment of commitments) {
      if (
        commitment.organizationId !== organizationId ||
        commitment.projectId !== projectId ||
        commitment.status !== "Active"
      ) {
        continue;
      }
      settled.push(transitionCommitment({
        organizationId,
        commitmentId: commitment.commitmentId,
        to: "Settled",
        action: "investment.commitment.settle",
        actorUserId,
        correlationId
      }));
    }
    return settled;
  }

  function findCommitmentOrThrow({ organizationId, commitmentId }) {
    const commitment = commitments.find((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.commitmentId === commitmentId
    ));
    if (!commitment) {
      throw Object.assign(new Error("Commitment not found."), { status: 404, code: "commitment_not_found" });
    }
    return commitment;
  }

  function requireInvestor(principal) {
    return investorService.getMyInvestorProfile({ principal });
  }

  function requireEligibleInvestor(principal) {
    const profile = requireInvestor(principal);
    if (profile.kycStatus !== "Approved") {
      throw Object.assign(new Error("Investor KYC must be approved before commitment."), {
        status: 403,
        code: "investor_kyc_not_approved"
      });
    }
    if (profile.holdStatus !== "None") {
      throw Object.assign(new Error("Investor account hold blocks commitments."), {
        status: 403,
        code: "investor_hold_blocks_commitment"
      });
    }
    return profile;
  }

  function assertAmountWithinProjectLimits({ money, project }) {
    const amount = Number(money.amount);
    if (money.currency !== project.currency) {
      throw Object.assign(new Error("Commitment currency must match project currency."), {
        status: 409,
        code: "commitment_currency_mismatch"
      });
    }
    if (amount < Number(project.minimumInvestment) || amount > Number(project.maximumInvestment)) {
      throw Object.assign(new Error("Commitment amount is outside project investment limits."), {
        status: 409,
        code: "commitment_amount_out_of_range"
      });
    }
  }

  function assertSuitabilityRecorded({ investorId, organizationId, projectId, offerVersionId }) {
    if (!suitability.some((record) => (
      record.organizationId === organizationId &&
      record.investorId === investorId &&
      record.projectId === projectId &&
      record.offerVersionId === offerVersionId &&
      record.riskAcknowledged
    ))) {
      throw Object.assign(new Error("Suitability and risk acknowledgement must be recorded before commitment."), {
        status: 409,
        code: "suitability_required"
      });
    }
  }

  function audit({ principal, organizationId, projectId, action, entityType, entityId, correlationId }) {
    auditEvents.push(buildAuditEvent({
      organizationId,
      projectId,
      actorUserId: principal.user.userId,
      action,
      entityType,
      entityId,
      correlationId
    }));
  }

  function transitionCommitment({ organizationId, commitmentId, to, action, actorUserId, correlationId }) {
    const commitment = commitments.find((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.commitmentId === commitmentId
    ));
    if (!commitment) {
      throw Object.assign(new Error("Commitment not found."), { status: 404, code: "commitment_not_found" });
    }
    if (!canTransition("investment", commitment.status, to)) {
      throw Object.assign(new Error(`Commitment cannot transition from ${commitment.status} to ${to}.`), {
        status: 409,
        code: "invalid_commitment_transition"
      });
    }
    commitment.status = to;
    auditEvents.push(buildAuditEvent({
      organizationId,
      projectId: commitment.projectId,
      actorUserId,
      action,
      entityType: "Commitment",
      entityId: commitmentId,
      correlationId
    }));
    return { ...commitment };
  }
}
