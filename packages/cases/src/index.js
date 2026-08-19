import {
  CASE_SEVERITIES,
  CASE_SOURCES,
  COMPLAINT_CATEGORIES,
  COMPLAINT_SLA_HOURS,
  HOLD_SUBJECTS,
  LINKABLE_ENTITIES,
  PERMISSIONS,
  assertFourEyes,
  buildAuditEvent,
  canTransition
} from "../../domain-contracts/src/index.js";

const HOUR_MS = 60 * 60 * 1000;

/** Categories that always route to the whistleblowing channel regardless of how they arrive. */
const WHISTLEBLOWING_CATEGORIES = Object.freeze([
  COMPLAINT_CATEGORIES.fraud,
  COMPLAINT_CATEGORIES.misuseOfFunds
]);

export function createCaseService({
  identity,
  investorService = null,
  complaints = [],
  complianceCases = [],
  holds = [],
  rules = createDefaultComplianceRules(),
  caseLinks = [],
  signals = [],
  clock = () => new Date(),
  auditEvents = []
}) {
  return {
    registerComplaint,
    triageComplaint,
    assignComplaint,
    startComplaintWork,
    escalateComplaint,
    resolveComplaint,
    closeComplaint,
    appealComplaint,
    withdrawComplaint,
    listComplaints,
    getComplaint,
    getSlaStatus,
    listSlaBreaches,
    classifyComplaint,
    draftComplaintResponse,
    applyClassification,
    openComplianceCase,
    advanceComplianceCase,
    resolveComplianceCase,
    linkCase,
    listCaseLinks,
    listComplianceCases,
    placeHold,
    releaseHold,
    listHolds,
    isHeld,
    draftRule,
    approveRule,
    suspendRule,
    listRules,
    evaluateSignal,
    listSignals,
    getAuditEvents: () => auditEvents.slice()
  };

  // ----------------------------------------------------------------- complaints

  function registerComplaint({
    principal,
    organizationId,
    projectId,
    category,
    severity = CASE_SEVERITIES.medium,
    subject,
    description,
    investorId,
    evidenceDocumentIds = [],
    channel = "Portal",
    anonymous = false,
    correlationId
  }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.complaintRegister, organizationId, projectId });
    assertCategory(category);
    assertSeverity(severity);
    if (!subject || !description) {
      throw problem(400, "complaint_details_required", "A complaint requires a subject and a description.");
    }
    const whistleblowing = anonymous || WHISTLEBLOWING_CATEGORIES.includes(category);
    const registeredAt = clock();
    const sla = COMPLAINT_SLA_HOURS[severity];
    const complaint = {
      complaintId: `complaint_${complaints.length + 1}`,
      organizationId,
      projectId: projectId ?? null,
      category,
      severity,
      subject,
      description,
      // A whistleblowing report never records who raised it. That is the point of the channel.
      investorId: whistleblowing ? null : (investorId ?? null),
      reportedByUserId: whistleblowing ? null : principal.user.userId,
      anonymous: whistleblowing,
      whistleblowing,
      channel,
      evidenceDocumentIds: [...evidenceDocumentIds],
      status: "Registered",
      assignedToUserId: null,
      registeredAt: registeredAt.toISOString(),
      acknowledgeDueAt: new Date(registeredAt.getTime() + sla.acknowledge * HOUR_MS).toISOString(),
      resolveDueAt: new Date(registeredAt.getTime() + sla.resolve * HOUR_MS).toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
      closedAt: null,
      resolution: null,
      rejectionReason: null,
      escalationCount: 0,
      appealCount: 0,
      classification: null,
      draftResponse: null,
      history: []
    };
    complaints.push(complaint);
    record({ complaint, action: "registered", actorUserId: complaint.reportedByUserId ?? "anonymous", at: registeredAt });
    audit({
      principal,
      organizationId,
      projectId,
      action: whistleblowing ? "cases.whistleblowing.register" : "cases.complaint.register",
      entityType: "Complaint",
      entityId: complaint.complaintId,
      correlationId
    });

    if (whistleblowing) {
      openComplianceCaseInternal({
        principal,
        organizationId,
        projectId,
        source: CASE_SOURCES.whistleblowing,
        severity: CASE_SEVERITIES.high,
        summary: `Whistleblowing report: ${subject}`,
        links: [{ entityType: LINKABLE_ENTITIES.complaint, entityId: complaint.complaintId }],
        correlationId
      });
    }
    return readComplaint({ principal, complaint });
  }

  function triageComplaint({ principal, organizationId, complaintId, severity, category, correlationId }) {
    const complaint = requireComplaintManager({ principal, organizationId, complaintId });
    if (severity) {
      assertSeverity(severity);
      complaint.severity = severity;
      const sla = COMPLAINT_SLA_HOURS[severity];
      const registeredAt = new Date(complaint.registeredAt);
      complaint.acknowledgeDueAt = new Date(registeredAt.getTime() + sla.acknowledge * HOUR_MS).toISOString();
      complaint.resolveDueAt = new Date(registeredAt.getTime() + sla.resolve * HOUR_MS).toISOString();
    }
    if (category) {
      assertCategory(category);
      complaint.category = category;
    }
    transitionComplaint({ complaint, to: "Triaged" });
    complaint.acknowledgedAt = clock().toISOString();
    record({ complaint, action: "triaged", actorUserId: principal.user.userId, at: clock() });
    audit({ principal, organizationId, projectId: complaint.projectId, action: "cases.complaint.triage", entityType: "Complaint", entityId: complaintId, correlationId });
    return readComplaint({ principal, complaint });
  }

  function assignComplaint({ principal, organizationId, complaintId, assignedToUserId, correlationId }) {
    const complaint = requireComplaintManager({ principal, organizationId, complaintId });
    if (!assignedToUserId) {
      throw problem(400, "complaint_assignee_required", "An assignee is required.");
    }
    transitionComplaint({ complaint, to: "Assigned" });
    complaint.assignedToUserId = assignedToUserId;
    record({ complaint, action: "assigned", actorUserId: principal.user.userId, at: clock(), detail: assignedToUserId });
    audit({ principal, organizationId, projectId: complaint.projectId, action: "cases.complaint.assign", entityType: "Complaint", entityId: complaintId, correlationId });
    return readComplaint({ principal, complaint });
  }

  function startComplaintWork({ principal, organizationId, complaintId, correlationId }) {
    const complaint = requireComplaintManager({ principal, organizationId, complaintId });
    transitionComplaint({ complaint, to: "In Progress" });
    record({ complaint, action: "work-started", actorUserId: principal.user.userId, at: clock() });
    audit({ principal, organizationId, projectId: complaint.projectId, action: "cases.complaint.start", entityType: "Complaint", entityId: complaintId, correlationId });
    return readComplaint({ principal, complaint });
  }

  function escalateComplaint({ principal, organizationId, complaintId, reason, correlationId }) {
    const complaint = requireComplaintManager({ principal, organizationId, complaintId });
    if (!reason) {
      throw problem(400, "complaint_escalation_reason_required", "Escalating a complaint requires a documented reason.");
    }
    transitionComplaint({ complaint, to: "Escalated" });
    complaint.escalationCount += 1;
    complaint.escalationReason = reason;
    record({ complaint, action: "escalated", actorUserId: principal.user.userId, at: clock(), detail: reason });
    audit({ principal, organizationId, projectId: complaint.projectId, action: "cases.complaint.escalate", entityType: "Complaint", entityId: complaintId, reason, correlationId });
    return readComplaint({ principal, complaint });
  }

  function resolveComplaint({ principal, organizationId, complaintId, resolution, correlationId }) {
    const complaint = findComplaintOrThrow({ organizationId, complaintId });
    identity.requirePermission({ principal, permission: PERMISSIONS.complaintResolve, organizationId, projectId: complaint.projectId ?? undefined });
    if (!resolution) {
      throw problem(400, "complaint_resolution_required", "A resolution statement is required.");
    }
    // The person who raised a complaint cannot be the person who declares it resolved.
    if (complaint.reportedByUserId) {
      assertFourEyes({
        creatorUserId: complaint.reportedByUserId,
        approverUserId: principal.user.userId,
        action: "Complaint resolution"
      });
    }
    transitionComplaint({ complaint, to: "Resolved" });
    complaint.resolution = resolution;
    complaint.resolvedAt = clock().toISOString();
    complaint.resolvedByUserId = principal.user.userId;
    record({ complaint, action: "resolved", actorUserId: principal.user.userId, at: clock(), detail: resolution });
    audit({ principal, organizationId, projectId: complaint.projectId, action: "cases.complaint.resolve", entityType: "Complaint", entityId: complaintId, correlationId });
    return readComplaint({ principal, complaint });
  }

  function closeComplaint({ principal, organizationId, complaintId, correlationId }) {
    const complaint = requireComplaintManager({ principal, organizationId, complaintId });
    transitionComplaint({ complaint, to: "Closed" });
    complaint.closedAt = clock().toISOString();
    record({ complaint, action: "closed", actorUserId: principal.user.userId, at: clock() });
    audit({ principal, organizationId, projectId: complaint.projectId, action: "cases.complaint.close", entityType: "Complaint", entityId: complaintId, correlationId });
    return readComplaint({ principal, complaint });
  }

  function appealComplaint({ principal, organizationId, complaintId, reason, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.complaintRegister, organizationId });
    const complaint = findComplaintOrThrow({ organizationId, complaintId });
    if (!reason) {
      throw problem(400, "complaint_appeal_reason_required", "An appeal requires a stated reason.");
    }
    transitionComplaint({ complaint, to: "Under Appeal" });
    complaint.appealCount += 1;
    complaint.appealReason = reason;
    complaint.closedAt = null;
    record({ complaint, action: "appealed", actorUserId: principal.user.userId, at: clock(), detail: reason });
    audit({ principal, organizationId, projectId: complaint.projectId, action: "cases.complaint.appeal", entityType: "Complaint", entityId: complaintId, reason, correlationId });
    return readComplaint({ principal, complaint });
  }

  function withdrawComplaint({ principal, organizationId, complaintId, reason, correlationId }) {
    const complaint = findComplaintOrThrow({ organizationId, complaintId });
    identity.requirePermission({ principal, permission: PERMISSIONS.complaintRegister, organizationId });
    if (complaint.reportedByUserId && complaint.reportedByUserId !== principal.user.userId) {
      identity.requirePermission({ principal, permission: PERMISSIONS.complaintManage, organizationId, projectId: complaint.projectId ?? undefined });
    }
    if (!reason) {
      throw problem(400, "complaint_withdraw_reason_required", "Withdrawing a complaint requires a stated reason.");
    }
    transitionComplaint({ complaint, to: "Withdrawn" });
    complaint.rejectionReason = reason;
    record({ complaint, action: "withdrawn", actorUserId: principal.user.userId, at: clock(), detail: reason });
    audit({ principal, organizationId, projectId: complaint.projectId, action: "cases.complaint.withdraw", entityType: "Complaint", entityId: complaintId, reason, correlationId });
    return readComplaint({ principal, complaint });
  }

  function listComplaints({ principal, organizationId, projectId, status, category }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.complaintManage, organizationId, projectId });
    return complaints
      .filter((complaint) => complaint.organizationId === organizationId)
      .filter((complaint) => !projectId || complaint.projectId === projectId)
      .filter((complaint) => !status || complaint.status === status)
      .filter((complaint) => !category || complaint.category === category)
      .map((complaint) => readComplaint({ principal, complaint }));
  }

  function getComplaint({ principal, organizationId, complaintId }) {
    const complaint = findComplaintOrThrow({ organizationId, complaintId });
    if (complaint.reportedByUserId !== principal.user.userId) {
      identity.requirePermission({ principal, permission: PERMISSIONS.complaintManage, organizationId, projectId: complaint.projectId ?? undefined });
    }
    return readComplaint({ principal, complaint });
  }

  function getSlaStatus({ principal, organizationId, complaintId }) {
    const complaint = findComplaintOrThrow({ organizationId, complaintId });
    identity.requirePermission({ principal, permission: PERMISSIONS.complaintManage, organizationId, projectId: complaint.projectId ?? undefined });
    return computeSla(complaint);
  }

  function listSlaBreaches({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.complaintManage, organizationId, projectId });
    return complaints
      .filter((complaint) => complaint.organizationId === organizationId)
      .filter((complaint) => !projectId || complaint.projectId === projectId)
      .map((complaint) => ({ complaintId: complaint.complaintId, severity: complaint.severity, status: complaint.status, ...computeSla(complaint) }))
      .filter((entry) => entry.acknowledgeBreached || entry.resolveBreached);
  }

  /**
   * SLA state is derived, never stored. A stored flag could drift from the clock; a derived one
   * cannot, and it stays correct if a severity change moves the target.
   */
  function computeSla(complaint) {
    const now = clock();
    const acknowledgedAt = complaint.acknowledgedAt ? new Date(complaint.acknowledgedAt) : null;
    const resolvedAt = complaint.resolvedAt ? new Date(complaint.resolvedAt) : null;
    const acknowledgeDueAt = new Date(complaint.acknowledgeDueAt);
    const resolveDueAt = new Date(complaint.resolveDueAt);
    const terminal = ["Withdrawn", "Rejected"].includes(complaint.status);
    return {
      acknowledgeDueAt: complaint.acknowledgeDueAt,
      resolveDueAt: complaint.resolveDueAt,
      acknowledgedAt: complaint.acknowledgedAt,
      resolvedAt: complaint.resolvedAt,
      acknowledgeBreached: !terminal && (acknowledgedAt ? acknowledgedAt > acknowledgeDueAt : now > acknowledgeDueAt),
      resolveBreached: !terminal && (resolvedAt ? resolvedAt > resolveDueAt : now > resolveDueAt),
      acknowledgeRemainingHours: hoursBetween(now, acknowledgeDueAt),
      resolveRemainingHours: hoursBetween(now, resolveDueAt)
    };
  }

  // ------------------------------------------------------- AI complaint support

  /**
   * AI classification is a suggestion only. It records a confidence and an explanation, and it
   * cannot change the complaint until a human applies it through `applyClassification`.
   */
  function classifyComplaint({ principal, organizationId, complaintId }) {
    const complaint = findComplaintOrThrow({ organizationId, complaintId });
    identity.requirePermission({ principal, permission: PERMISSIONS.complaintManage, organizationId, projectId: complaint.projectId ?? undefined });
    const text = `${complaint.subject} ${complaint.description}`.toLowerCase();
    const signalsFound = [];
    let suggestedCategory = COMPLAINT_CATEGORIES.other;
    let suggestedSeverity = CASE_SEVERITIES.medium;

    const keywordMap = [
      { category: COMPLAINT_CATEGORIES.fraud, severity: CASE_SEVERITIES.critical, words: ["fraud", "forged", "stolen", "impersonat"] },
      { category: COMPLAINT_CATEGORIES.misuseOfFunds, severity: CASE_SEVERITIES.critical, words: ["misuse", "diverted", "siphon"] },
      { category: COMPLAINT_CATEGORIES.payment, severity: CASE_SEVERITIES.high, words: ["payment", "refund", "not credited", "deducted"] },
      { category: COMPLAINT_CATEGORIES.distribution, severity: CASE_SEVERITIES.high, words: ["distribution", "payout", "dividend"] },
      { category: COMPLAINT_CATEGORIES.dataPrivacy, severity: CASE_SEVERITIES.high, words: ["privacy", "personal data", "shared my"] },
      { category: COMPLAINT_CATEGORIES.disclosure, severity: CASE_SEVERITIES.medium, words: ["disclosure", "misleading", "prospectus"] },
      { category: COMPLAINT_CATEGORIES.service, severity: CASE_SEVERITIES.low, words: ["support", "response time", "rude", "delay"] }
    ];
    for (const entry of keywordMap) {
      const matched = entry.words.filter((word) => text.includes(word));
      if (matched.length > 0) {
        signalsFound.push({ category: entry.category, matchedTerms: matched });
        if (severityRank(entry.severity) > severityRank(suggestedSeverity) || suggestedCategory === COMPLAINT_CATEGORIES.other) {
          suggestedCategory = entry.category;
          suggestedSeverity = entry.severity;
        }
      }
    }
    const confidence = signalsFound.length === 0 ? "0.0000" : Math.min(0.4 + 0.2 * signalsFound.length, 0.95).toFixed(4);
    return {
      complaintId,
      suggestedCategory,
      suggestedSeverity,
      confidence,
      explanation: signalsFound.length === 0
        ? ["No known category keywords matched; a human must categorise this complaint."]
        : signalsFound.map((signal) => `Matched ${signal.matchedTerms.join(", ")} for category ${signal.category}.`),
      authoritative: false,
      requiresHumanApproval: true
    };
  }

  function draftComplaintResponse({ principal, organizationId, complaintId }) {
    const complaint = findComplaintOrThrow({ organizationId, complaintId });
    identity.requirePermission({ principal, permission: PERMISSIONS.complaintManage, organizationId, projectId: complaint.projectId ?? undefined });
    const sla = computeSla(complaint);
    const lines = [
      `We have recorded your complaint about ${complaint.subject}.`,
      `It is categorised as ${complaint.category} with ${complaint.severity} severity.`,
      `We aim to acknowledge by ${complaint.acknowledgeDueAt} and to resolve by ${complaint.resolveDueAt}.`,
      complaint.resolution
        ? `Outcome recorded by the platform: ${complaint.resolution}`
        : "The case is still under review and no outcome has been decided."
    ];
    return {
      complaintId,
      draft: lines.join(" "),
      // A drafted response is never sent automatically and states no outcome the case does not hold.
      authoritative: false,
      requiresHumanApproval: true,
      basedOn: {
        status: complaint.status,
        category: complaint.category,
        severity: complaint.severity,
        resolutionRecorded: Boolean(complaint.resolution),
        slaBreached: sla.acknowledgeBreached || sla.resolveBreached
      }
    };
  }

  function applyClassification({ principal, organizationId, complaintId, category, severity, rationale, correlationId }) {
    const complaint = requireComplaintManager({ principal, organizationId, complaintId });
    if (!rationale) {
      throw problem(400, "classification_rationale_required", "Applying a classification requires a human rationale.");
    }
    assertCategory(category);
    assertSeverity(severity);
    complaint.category = category;
    complaint.severity = severity;
    complaint.classification = {
      category,
      severity,
      rationale,
      appliedByUserId: principal.user.userId,
      appliedAt: clock().toISOString()
    };
    const sla = COMPLAINT_SLA_HOURS[severity];
    const registeredAt = new Date(complaint.registeredAt);
    complaint.acknowledgeDueAt = new Date(registeredAt.getTime() + sla.acknowledge * HOUR_MS).toISOString();
    complaint.resolveDueAt = new Date(registeredAt.getTime() + sla.resolve * HOUR_MS).toISOString();
    record({ complaint, action: "classified", actorUserId: principal.user.userId, at: clock(), detail: `${category}/${severity}` });
    audit({ principal, organizationId, projectId: complaint.projectId, action: "cases.complaint.classify", entityType: "Complaint", entityId: complaintId, reason: rationale, correlationId });
    return readComplaint({ principal, complaint });
  }

  // ----------------------------------------------------------- compliance cases

  function openComplianceCase({ principal, organizationId, projectId, source, severity = CASE_SEVERITIES.medium, summary, links = [], correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.caseManage, organizationId, projectId });
    return openComplianceCaseInternal({ principal, organizationId, projectId, source, severity, summary, links, correlationId });
  }

  function openComplianceCaseInternal({ principal, organizationId, projectId, source, severity, summary, links, correlationId, ruleId = null }) {
    assertSource(source);
    assertSeverity(severity);
    if (!summary) {
      throw problem(400, "case_summary_required", "A compliance case requires a summary.");
    }
    const complianceCase = {
      caseId: `case_${complianceCases.length + 1}`,
      organizationId,
      projectId: projectId ?? null,
      source,
      severity,
      summary,
      status: "Open",
      openedByUserId: principal.user.userId,
      openedAt: clock().toISOString(),
      assignedToUserId: null,
      resolution: null,
      resolvedByUserId: null,
      resolvedAt: null,
      triggeredByRuleId: ruleId,
      history: []
    };
    complianceCases.push(complianceCase);
    complianceCase.history.push({ action: "opened", actorUserId: principal.user.userId, at: complianceCase.openedAt });
    for (const link of links) {
      linkInternal({ principal, organizationId, caseId: complianceCase.caseId, entityType: link.entityType, entityId: link.entityId, correlationId });
    }
    audit({ principal, organizationId, projectId, action: "cases.compliance_case.open", entityType: "ComplianceCase", entityId: complianceCase.caseId, correlationId });
    return cloneCase(complianceCase);
  }

  function advanceComplianceCase({ principal, organizationId, caseId, to, note, assignedToUserId, correlationId }) {
    const complianceCase = findCaseOrThrow({ organizationId, caseId });
    identity.requirePermission({ principal, permission: PERMISSIONS.caseManage, organizationId, projectId: complianceCase.projectId ?? undefined });
    if (!canTransition("complianceCase", complianceCase.status, to)) {
      throw problem(409, "invalid_case_transition", `Compliance case cannot transition from ${complianceCase.status} to ${to}.`);
    }
    complianceCase.status = to;
    if (assignedToUserId) {
      complianceCase.assignedToUserId = assignedToUserId;
    }
    complianceCase.history.push({ action: `moved-to-${to}`, actorUserId: principal.user.userId, at: clock().toISOString(), detail: note ?? null });
    audit({ principal, organizationId, projectId: complianceCase.projectId, action: "cases.compliance_case.advance", entityType: "ComplianceCase", entityId: caseId, reason: note, correlationId });
    return cloneCase(complianceCase);
  }

  function resolveComplianceCase({ principal, organizationId, caseId, resolution, correlationId }) {
    const complianceCase = findCaseOrThrow({ organizationId, caseId });
    identity.requirePermission({ principal, permission: PERMISSIONS.caseManage, organizationId, projectId: complianceCase.projectId ?? undefined });
    if (!resolution) {
      throw problem(400, "case_resolution_required", "A compliance case resolution is required.");
    }
    const active = holds.filter((hold) => hold.caseId === caseId && hold.status === "Active");
    if (active.length > 0) {
      throw problem(409, "case_holds_active", `Resolve or release ${active.length} active hold(s) before closing this case.`);
    }
    if (!canTransition("complianceCase", complianceCase.status, "Resolved")) {
      throw problem(409, "invalid_case_transition", `Compliance case cannot transition from ${complianceCase.status} to Resolved.`);
    }
    complianceCase.status = "Resolved";
    complianceCase.resolution = resolution;
    complianceCase.resolvedByUserId = principal.user.userId;
    complianceCase.resolvedAt = clock().toISOString();
    complianceCase.history.push({ action: "resolved", actorUserId: principal.user.userId, at: complianceCase.resolvedAt, detail: resolution });
    audit({ principal, organizationId, projectId: complianceCase.projectId, action: "cases.compliance_case.resolve", entityType: "ComplianceCase", entityId: caseId, correlationId });
    return cloneCase(complianceCase);
  }

  function listComplianceCases({ principal, organizationId, projectId, status, source }) {
    requireCaseReadAccess({ principal, organizationId, projectId });
    return complianceCases
      .filter((entry) => entry.organizationId === organizationId)
      .filter((entry) => !projectId || entry.projectId === projectId)
      .filter((entry) => !status || entry.status === status)
      .filter((entry) => !source || entry.source === source)
      .map(cloneCase);
  }

  function linkCase({ principal, organizationId, caseId, entityType, entityId, correlationId }) {
    const complianceCase = findCaseOrThrow({ organizationId, caseId });
    identity.requirePermission({ principal, permission: PERMISSIONS.caseManage, organizationId, projectId: complianceCase.projectId ?? undefined });
    return linkInternal({ principal, organizationId, caseId, entityType, entityId, correlationId });
  }

  function linkInternal({ principal, organizationId, caseId, entityType, entityId, correlationId }) {
    if (!Object.values(LINKABLE_ENTITIES).includes(entityType)) {
      throw problem(400, "case_link_entity_invalid", `Unsupported linked entity type: ${entityType}.`);
    }
    if (!entityId) {
      throw problem(400, "case_link_entity_required", "A linked entity identifier is required.");
    }
    const existing = caseLinks.find((link) => (
      link.organizationId === organizationId && link.caseId === caseId && link.entityType === entityType && link.entityId === entityId
    ));
    if (existing) {
      return { ...existing };
    }
    const link = {
      caseLinkId: `case_link_${caseLinks.length + 1}`,
      organizationId,
      caseId,
      entityType,
      entityId,
      linkedByUserId: principal.user.userId,
      linkedAt: clock().toISOString()
    };
    caseLinks.push(link);
    audit({ principal, organizationId, action: "cases.compliance_case.link", entityType: "CaseLink", entityId: link.caseLinkId, correlationId });
    return { ...link };
  }

  /**
   * Case linking is bidirectional by query: asking for an entity returns every case that touches
   * it, and asking for a case returns every entity. That is what makes a trail traceable.
   */
  function listCaseLinks({ principal, organizationId, caseId, entityType, entityId }) {
    requireCaseReadAccess({ principal, organizationId });
    return caseLinks
      .filter((link) => link.organizationId === organizationId)
      .filter((link) => !caseId || link.caseId === caseId)
      .filter((link) => !entityType || link.entityType === entityType)
      .filter((link) => !entityId || link.entityId === entityId)
      .map((link) => ({ ...link }));
  }

  // ---------------------------------------------------------------------- holds

  function placeHold({ principal, organizationId, projectId, subjectType, subjectId, reason, caseId, expiresAt, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.holdPlace, organizationId, projectId });
    if (!Object.values(HOLD_SUBJECTS).includes(subjectType)) {
      throw problem(400, "hold_subject_invalid", `Unsupported hold subject: ${subjectType}.`);
    }
    if (!subjectId || !reason) {
      throw problem(400, "hold_details_required", "A hold requires a subject identifier and a documented reason.");
    }
    if (isHeld({ organizationId, subjectType, subjectId })) {
      throw problem(409, "hold_already_active", `An active hold already exists on ${subjectType} ${subjectId}.`);
    }
    const hold = {
      holdId: `hold_${holds.length + 1}`,
      organizationId,
      projectId: projectId ?? null,
      subjectType,
      subjectId,
      reason,
      caseId: caseId ?? null,
      status: "Active",
      placedByUserId: principal.user.userId,
      placedAt: clock().toISOString(),
      expiresAt: expiresAt ?? null,
      releasedByUserId: null,
      releasedAt: null,
      releaseReason: null,
      propagated: false
    };
    holds.push(hold);

    // Propagate to the module that owns the subject so the hold bites where the action happens.
    if (subjectType === HOLD_SUBJECTS.investor && investorService?.placeHold) {
      investorService.placeHold({ principal, organizationId, investorId: subjectId, reason, correlationId });
      hold.propagated = true;
    }
    audit({ principal, organizationId, projectId, action: "cases.hold.place", entityType: "GovernanceHold", entityId: hold.holdId, reason, correlationId });
    return { ...hold };
  }

  function releaseHold({ principal, organizationId, holdId, reason, correlationId }) {
    const hold = holds.find((candidate) => candidate.organizationId === organizationId && candidate.holdId === holdId);
    if (!hold) {
      throw problem(404, "hold_not_found", "Governance hold not found.");
    }
    identity.requirePermission({ principal, permission: PERMISSIONS.holdRelease, organizationId, projectId: hold.projectId ?? undefined });
    if (!reason) {
      throw problem(400, "hold_release_reason_required", "Releasing a hold requires a documented reason.");
    }
    // Whoever placed a hold cannot be the one who lifts it.
    assertFourEyes({
      creatorUserId: hold.placedByUserId,
      approverUserId: principal.user.userId,
      action: "Governance hold release"
    });
    if (!canTransition("governanceHold", hold.status, "Released")) {
      throw problem(409, "invalid_hold_transition", `Hold cannot transition from ${hold.status} to Released.`);
    }
    hold.status = "Released";
    hold.releasedByUserId = principal.user.userId;
    hold.releasedAt = clock().toISOString();
    hold.releaseReason = reason;
    audit({ principal, organizationId, projectId: hold.projectId, action: "cases.hold.release", entityType: "GovernanceHold", entityId: holdId, reason, correlationId });
    return { ...hold };
  }

  function listHolds({ principal, organizationId, projectId, subjectType, status }) {
    requireCaseReadAccess({ principal, organizationId, projectId });
    return holds
      .filter((hold) => hold.organizationId === organizationId)
      .filter((hold) => !projectId || hold.projectId === projectId)
      .filter((hold) => !subjectType || hold.subjectType === subjectType)
      .filter((hold) => !status || hold.status === status)
      .map((hold) => ({ ...hold }));
  }

  /** Module-level read so any service can ask whether an action is blocked, without a principal. */
  function isHeld({ organizationId, subjectType, subjectId }) {
    const now = clock();
    return holds.some((hold) => (
      hold.organizationId === organizationId &&
      hold.subjectType === subjectType &&
      hold.subjectId === subjectId &&
      hold.status === "Active" &&
      (!hold.expiresAt || new Date(hold.expiresAt) > now)
    ));
  }

  // -------------------------------------------------------------- rule engine

  function draftRule({ principal, organizationId, name, source, severity, match = "all", conditions, action, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.ruleManage, organizationId });
    assertSource(source);
    assertSeverity(severity);
    if (!name) {
      throw problem(400, "rule_name_required", "A compliance rule requires a name.");
    }
    if (!["all", "any"].includes(match)) {
      throw problem(400, "rule_match_invalid", "Rule match must be all or any.");
    }
    if (!Array.isArray(conditions) || conditions.length === 0) {
      throw problem(400, "rule_conditions_required", "A compliance rule requires at least one condition.");
    }
    for (const condition of conditions) {
      assertCondition(condition);
    }
    if (!["open-case", "raise-hold", "flag"].includes(action?.type)) {
      throw problem(400, "rule_action_invalid", `Unsupported rule action: ${action?.type}.`);
    }
    if (action.type === "raise-hold" && !Object.values(HOLD_SUBJECTS).includes(action.subjectType)) {
      throw problem(400, "rule_action_subject_invalid", "A raise-hold action requires a valid hold subject type.");
    }
    if (rules.some((rule) => rule.organizationId === organizationId && rule.name === name && rule.status === "Draft")) {
      throw problem(409, "rule_draft_exists", "A draft already exists for this rule name.");
    }
    const rule = {
      ruleId: `rule_${rules.length + 1}`,
      organizationId,
      name,
      source,
      severity,
      match,
      conditions: conditions.map((condition) => ({ ...condition })),
      action: { ...action },
      version: rules.filter((candidate) => candidate.organizationId === organizationId && candidate.name === name).length + 1,
      status: "Draft",
      syntheticApproval: false,
      draftedByUserId: principal.user.userId,
      approvedByUserId: null,
      approvedAt: null
    };
    rules.push(rule);
    audit({ principal, organizationId, action: "cases.rule.draft", entityType: "ComplianceRule", entityId: rule.ruleId, correlationId });
    return cloneRule(rule);
  }

  function approveRule({ principal, organizationId, ruleId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.ruleApprove, organizationId });
    const rule = rules.find((candidate) => candidate.organizationId === organizationId && candidate.ruleId === ruleId);
    if (!rule) {
      throw problem(404, "rule_not_found", "Compliance rule not found.");
    }
    assertFourEyes({
      creatorUserId: rule.draftedByUserId,
      approverUserId: principal.user.userId,
      action: "Compliance rule approval"
    });
    if (!canTransition("complianceRule", rule.status, "Approved")) {
      throw problem(409, "invalid_rule_transition", `Rule cannot transition from ${rule.status} to Approved.`);
    }
    for (const candidate of rules) {
      if (candidate !== rule && candidate.organizationId === organizationId && candidate.name === rule.name && candidate.status === "Approved") {
        candidate.status = "Superseded";
      }
    }
    rule.status = "Approved";
    rule.approvedByUserId = principal.user.userId;
    rule.approvedAt = clock().toISOString();
    audit({ principal, organizationId, action: "cases.rule.approve", entityType: "ComplianceRule", entityId: ruleId, correlationId });
    return cloneRule(rule);
  }

  function suspendRule({ principal, organizationId, ruleId, reason, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.ruleApprove, organizationId });
    const rule = rules.find((candidate) => candidate.organizationId === organizationId && candidate.ruleId === ruleId);
    if (!rule) {
      throw problem(404, "rule_not_found", "Compliance rule not found.");
    }
    if (!reason) {
      throw problem(400, "rule_suspend_reason_required", "Suspending a rule requires a documented reason.");
    }
    if (!canTransition("complianceRule", rule.status, "Suspended")) {
      throw problem(409, "invalid_rule_transition", `Rule cannot transition from ${rule.status} to Suspended.`);
    }
    rule.status = "Suspended";
    rule.suspensionReason = reason;
    audit({ principal, organizationId, action: "cases.rule.suspend", entityType: "ComplianceRule", entityId: ruleId, reason, correlationId });
    return cloneRule(rule);
  }

  function listRules({ principal, organizationId, status }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.ruleManage, organizationId });
    return rules
      .filter((rule) => rule.organizationId === organizationId)
      .filter((rule) => !status || rule.status === status)
      .map(cloneRule);
  }

  /**
   * Rules are declarative data, never code. A signal is matched against approved rules only, and
   * every case or hold a rule creates records which rule fired, so an action is always explainable.
   */
  function evaluateSignal({ principal, organizationId, projectId, signalType, payload = {}, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.caseManage, organizationId, projectId });
    assertSource(signalType);
    const applicable = rules.filter((rule) => (
      rule.organizationId === organizationId && rule.source === signalType && rule.status === "Approved"
    ));
    const signal = {
      signalId: `signal_${signals.length + 1}`,
      organizationId,
      projectId: projectId ?? null,
      signalType,
      payload: { ...payload },
      evaluatedAt: clock().toISOString(),
      evaluatedByUserId: principal.user.userId,
      matchedRuleIds: [],
      createdCaseIds: [],
      createdHoldIds: [],
      flags: []
    };

    for (const rule of applicable) {
      const results = rule.conditions.map((condition) => ({ condition, matched: evaluateCondition(condition, payload) }));
      const matched = rule.match === "all" ? results.every((entry) => entry.matched) : results.some((entry) => entry.matched);
      if (!matched) {
        continue;
      }
      signal.matchedRuleIds.push(rule.ruleId);
      const explanation = results
        .filter((entry) => entry.matched)
        .map((entry) => `${entry.condition.field} ${entry.condition.operator} ${entry.condition.value}`);

      if (rule.action.type === "open-case") {
        const created = openComplianceCaseInternal({
          principal,
          organizationId,
          projectId,
          source: signalType,
          severity: rule.severity,
          summary: `${rule.name}: ${explanation.join("; ")}`,
          links: buildSignalLinks(payload),
          correlationId,
          ruleId: rule.ruleId
        });
        signal.createdCaseIds.push(created.caseId);
      } else if (rule.action.type === "raise-hold") {
        const subjectId = payload[rule.action.subjectField ?? "subjectId"];
        if (!subjectId) {
          throw problem(400, "rule_hold_subject_missing", `Rule ${rule.ruleId} needs ${rule.action.subjectField ?? "subjectId"} in the signal payload.`);
        }
        if (!isHeld({ organizationId, subjectType: rule.action.subjectType, subjectId })) {
          const created = placeHold({
            principal,
            organizationId,
            projectId,
            subjectType: rule.action.subjectType,
            subjectId,
            reason: `${rule.name}: ${explanation.join("; ")}`,
            correlationId
          });
          signal.createdHoldIds.push(created.holdId);
        }
      } else {
        signal.flags.push({ ruleId: rule.ruleId, name: rule.name, severity: rule.severity, explanation });
      }
    }

    signals.push(signal);
    audit({ principal, organizationId, projectId, action: "cases.signal.evaluate", entityType: "ComplianceSignal", entityId: signal.signalId, correlationId });
    return { ...signal, payload: { ...signal.payload } };
  }

  function listSignals({ principal, organizationId, projectId, signalType }) {
    requireCaseReadAccess({ principal, organizationId, projectId });
    return signals
      .filter((signal) => signal.organizationId === organizationId)
      .filter((signal) => !projectId || signal.projectId === projectId)
      .filter((signal) => !signalType || signal.signalType === signalType)
      .map((signal) => ({ ...signal, payload: { ...signal.payload } }));
  }

  function buildSignalLinks(payload) {
    const links = [];
    const map = {
      investorId: LINKABLE_ENTITIES.investor,
      projectId: LINKABLE_ENTITIES.project,
      paymentId: LINKABLE_ENTITIES.payment,
      documentId: LINKABLE_ENTITIES.document,
      voucherId: LINKABLE_ENTITIES.voucher,
      complaintId: LINKABLE_ENTITIES.complaint,
      distributionId: LINKABLE_ENTITIES.distribution
    };
    for (const [field, entityType] of Object.entries(map)) {
      if (payload[field]) {
        links.push({ entityType, entityId: payload[field] });
      }
    }
    return links;
  }

  // ------------------------------------------------------------------ internals

  /**
   * Read-only access to the case register.
   *
   * Governance and audit roles must be able to see cases, links, holds, and signals without being
   * able to change any of them, so a report or an audit trace is never blocked by a missing
   * management grant. Any of the three permissions opens the read path; none of them opens a write.
   */
  function requireCaseReadAccess({ principal, organizationId, projectId }) {
    const candidates = [PERMISSIONS.caseManage, PERMISSIONS.governanceReportRead, PERMISSIONS.auditPortalRead];
    let firstError = null;
    for (const permission of candidates) {
      try {
        return identity.requirePermission({ principal, permission, organizationId, projectId });
      } catch (error) {
        if (error.status !== 403) {
          throw error;
        }
        firstError = firstError ?? error;
      }
    }
    throw firstError;
  }

  function requireComplaintManager({ principal, organizationId, complaintId }) {
    const complaint = findComplaintOrThrow({ organizationId, complaintId });
    identity.requirePermission({ principal, permission: PERMISSIONS.complaintManage, organizationId, projectId: complaint.projectId ?? undefined });
    return complaint;
  }

  /**
   * A whistleblowing complaint is readable only by someone who can resolve complaints, and even
   * then it carries no reporter identity because none was stored.
   */
  function readComplaint({ principal, complaint }) {
    const clone = { ...complaint, evidenceDocumentIds: [...complaint.evidenceDocumentIds], history: complaint.history.map((entry) => ({ ...entry })) };
    if (complaint.whistleblowing) {
      clone.reportedByUserId = null;
      clone.investorId = null;
      clone.history = clone.history.map((entry) => ({ ...entry, actorUserId: entry.action === "registered" ? "anonymous" : entry.actorUserId }));
    }
    clone.sla = computeSla(complaint);
    return clone;
  }

  function record({ complaint, action, actorUserId, at, detail }) {
    complaint.history.push({ action, actorUserId, at: at.toISOString(), detail: detail ?? null });
  }

  function transitionComplaint({ complaint, to }) {
    if (!canTransition("complaint", complaint.status, to)) {
      throw problem(409, "invalid_complaint_transition", `Complaint cannot transition from ${complaint.status} to ${to}.`);
    }
    complaint.status = to;
  }

  function findComplaintOrThrow({ organizationId, complaintId }) {
    const complaint = complaints.find((candidate) => (
      candidate.organizationId === organizationId && candidate.complaintId === complaintId
    ));
    if (!complaint) {
      throw problem(404, "complaint_not_found", "Complaint not found.");
    }
    return complaint;
  }

  function findCaseOrThrow({ organizationId, caseId }) {
    const complianceCase = complianceCases.find((candidate) => (
      candidate.organizationId === organizationId && candidate.caseId === caseId
    ));
    if (!complianceCase) {
      throw problem(404, "compliance_case_not_found", "Compliance case not found.");
    }
    return complianceCase;
  }

  function cloneCase(complianceCase) {
    return { ...complianceCase, history: complianceCase.history.map((entry) => ({ ...entry })) };
  }

  function cloneRule(rule) {
    return { ...rule, conditions: rule.conditions.map((condition) => ({ ...condition })), action: { ...rule.action } };
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

export function evaluateCondition(condition, payload) {
  const actual = payload[condition.field];
  const expected = condition.value;
  switch (condition.operator) {
    case "equals":
      return String(actual) === String(expected);
    case "notEquals":
      return String(actual) !== String(expected);
    case "greaterThan":
      return Number(actual) > Number(expected);
    case "lessThan":
      return Number(actual) < Number(expected);
    case "contains":
      return String(actual ?? "").toLowerCase().includes(String(expected).toLowerCase());
    case "in":
      return Array.isArray(expected) && expected.map(String).includes(String(actual));
    case "isTrue":
      return actual === true;
    case "isPresent":
      return actual !== undefined && actual !== null && actual !== "";
    default:
      return false;
  }
}

export const RULE_OPERATORS = Object.freeze([
  "equals",
  "notEquals",
  "greaterThan",
  "lessThan",
  "contains",
  "in",
  "isTrue",
  "isPresent"
]);

/**
 * Seeded compliance rules.
 *
 * These are illustrative operating rules, not legal or regulatory requirements. They are flagged
 * as synthetic approvals and must be reviewed by a compliance owner before release.
 */
export function createDefaultComplianceRules() {
  return [
    {
      ruleId: "rule_seed_duplicate_identity",
      organizationId: "org_demo",
      name: "Duplicate identity fingerprint",
      source: CASE_SOURCES.duplicateDetection,
      severity: CASE_SEVERITIES.high,
      match: "all",
      conditions: [{ field: "duplicateCount", operator: "greaterThan", value: 0 }],
      action: { type: "open-case" },
      version: 1,
      status: "Approved",
      syntheticApproval: true,
      draftedByUserId: "system:seed",
      approvedByUserId: "system:seed",
      approvedAt: null
    },
    {
      ruleId: "rule_seed_unusual_payment",
      organizationId: "org_demo",
      name: "Unusual payment pattern",
      source: CASE_SOURCES.unusualPattern,
      severity: CASE_SEVERITIES.medium,
      match: "any",
      conditions: [
        { field: "structuringSuspected", operator: "isTrue", value: true },
        { field: "sameDayTransactionCount", operator: "greaterThan", value: 5 }
      ],
      action: { type: "flag" },
      version: 1,
      status: "Approved",
      syntheticApproval: true,
      draftedByUserId: "system:seed",
      approvedByUserId: "system:seed",
      approvedAt: null
    },
    {
      ruleId: "rule_seed_fraud_signal",
      organizationId: "org_demo",
      name: "Confirmed fraud signal",
      source: CASE_SOURCES.fraudSignal,
      severity: CASE_SEVERITIES.critical,
      match: "all",
      conditions: [{ field: "confirmed", operator: "isTrue", value: true }],
      action: { type: "raise-hold", subjectType: HOLD_SUBJECTS.investor, subjectField: "investorId" },
      version: 1,
      status: "Approved",
      syntheticApproval: true,
      draftedByUserId: "system:seed",
      approvedByUserId: "system:seed",
      approvedAt: null
    }
  ];
}

function assertCategory(category) {
  if (!Object.values(COMPLAINT_CATEGORIES).includes(category)) {
    throw problem(400, "complaint_category_invalid", `Unsupported complaint category: ${category}.`);
  }
}

function assertSeverity(severity) {
  if (!Object.values(CASE_SEVERITIES).includes(severity)) {
    throw problem(400, "case_severity_invalid", `Unsupported severity: ${severity}.`);
  }
}

function assertSource(source) {
  if (!Object.values(CASE_SOURCES).includes(source)) {
    throw problem(400, "case_source_invalid", `Unsupported case source: ${source}.`);
  }
}

function assertCondition(condition) {
  if (!condition?.field) {
    throw problem(400, "rule_condition_field_required", "Each rule condition requires a field.");
  }
  if (!RULE_OPERATORS.includes(condition.operator)) {
    throw problem(400, "rule_condition_operator_invalid", `Unsupported rule operator: ${condition.operator}.`);
  }
}

function severityRank(severity) {
  return [CASE_SEVERITIES.low, CASE_SEVERITIES.medium, CASE_SEVERITIES.high, CASE_SEVERITIES.critical].indexOf(severity);
}

function hoursBetween(from, to) {
  return Number(((to.getTime() - from.getTime()) / HOUR_MS).toFixed(2));
}

function problem(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
