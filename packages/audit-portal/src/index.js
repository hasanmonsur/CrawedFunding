import { createHash } from "node:crypto";
import {
  CASE_SEVERITIES,
  PERMISSIONS,
  buildAuditEvent,
  canTransition
} from "../../domain-contracts/src/index.js";

/**
 * Regulatory report templates.
 *
 * Only templates listed here can be produced. An unknown template is refused rather than
 * improvised, because a regulatory return is not something to guess at. Every template is marked
 * as awaiting approval until a compliance owner signs it off.
 */
export const REGULATORY_TEMPLATES = Object.freeze([
  Object.freeze({
    templateKey: "investor-onboarding-summary",
    title: "Investor onboarding and verification summary",
    approved: false,
    measures: ["investorsTotal", "kycApproved", "kycPending", "kycRejected", "duplicatesDetected"]
  }),
  Object.freeze({
    templateKey: "complaint-handling-summary",
    title: "Complaint handling and service level summary",
    approved: false,
    measures: ["complaintsRegistered", "complaintsResolved", "complaintsOpen", "slaBreaches", "averageResolutionHours"]
  }),
  Object.freeze({
    templateKey: "fund-flow-summary",
    title: "Project fund flow summary",
    approved: false,
    measures: ["fundsRaised", "fundsDeployed", "undeployed", "cashAtBank"]
  })
]);

export function createAuditPortalService({
  identity,
  auditSources = {},
  documentService = null,
  reportingService = null,
  caseService = null,
  accountingService = null,
  paymentService = null,
  investorService = null,
  projectService = null,
  evidencePackages = [],
  clock = () => new Date(),
  auditEvents = []
}) {
  return {
    searchAuditTrail,
    getEntityHistory,
    listSecurityEvents,
    buildEvidencePackage,
    sealEvidencePackage,
    getEvidencePackage,
    listEvidencePackages,
    verifyEvidencePackage,
    getGovernanceReport,
    listRegulatoryTemplates,
    getRegulatoryReport,
    getAuditEvents: () => auditEvents.slice()
  };

  // -------------------------------------------------------------- audit search

  /**
   * The audit portal is strictly read-only over other modules. It never holds a copy of their
   * records and it exposes no command that could change one.
   */
  function searchAuditTrail({ principal, organizationId, projectId, entityType, entityId, actorUserId, actionPrefix, from, to, correlationIdFilter, limit = 200 }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.auditPortalRead, organizationId, projectId });
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    const events = collectEvents()
      .filter((event) => event.organizationId === organizationId)
      .filter((event) => !projectId || event.projectId === projectId)
      .filter((event) => !entityType || event.entityType === entityType)
      .filter((event) => !entityId || event.entityId === entityId)
      .filter((event) => !actorUserId || event.actorUserId === actorUserId)
      .filter((event) => !actionPrefix || String(event.action).startsWith(actionPrefix))
      .filter((event) => !correlationIdFilter || event.correlationId === correlationIdFilter)
      .filter((event) => !fromDate || new Date(event.occurredAt) >= fromDate)
      .filter((event) => !toDate || new Date(event.occurredAt) <= toDate)
      .sort(byOccurredAt);

    const limited = events.slice(0, limit);
    return {
      organizationId,
      projectId: projectId ?? null,
      totalMatched: events.length,
      returned: limited.length,
      truncated: events.length > limited.length,
      events: limited,
      meta: {
        generatedAt: clock().toISOString(),
        sources: Object.keys(collectSourceMap()),
        checksum: checksum({ events: limited })
      }
    };
  }

  function getEntityHistory({ principal, organizationId, entityType, entityId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.auditPortalRead, organizationId });
    if (!entityType || !entityId) {
      throw problem(400, "entity_reference_required", "Entity type and identifier are required.");
    }
    const events = collectEvents()
      .filter((event) => event.organizationId === organizationId && event.entityType === entityType && event.entityId === entityId)
      .sort(byOccurredAt);
    const links = caseService?.listCaseLinks
      ? guarded(() => caseService.listCaseLinks({ principal, organizationId, entityType, entityId })) ?? []
      : [];
    return {
      organizationId,
      entityType,
      entityId,
      events,
      relatedCases: links.map((link) => ({ caseId: link.caseId, linkedAt: link.linkedAt })),
      meta: {
        generatedAt: clock().toISOString(),
        eventCount: events.length,
        firstSeenAt: events[0]?.occurredAt ?? null,
        lastSeenAt: events.at(-1)?.occurredAt ?? null,
        checksum: checksum({ entityType, entityId, events })
      }
    };
  }

  /**
   * Security-relevant events are a filtered view of the same trail rather than a separate log,
   * so a security review cannot miss an event that the main trail recorded.
   */
  function listSecurityEvents({ principal, organizationId, projectId, from, to }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.auditPortalRead, organizationId, projectId });
    const securityActions = [
      "cases.hold.",
      "cases.rule.",
      "document.download_grant.",
      "reporting.export.",
      "accounting.period.lock",
      "accounting.posting_matrix.",
      "accounting.voucher.backdate_approve",
      "payment.reconcile.approve",
      "payment.reconcile.reverse"
    ];
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    const events = collectEvents()
      .filter((event) => event.organizationId === organizationId)
      .filter((event) => !projectId || event.projectId === projectId)
      .filter((event) => securityActions.some((prefix) => String(event.action).startsWith(prefix)))
      .filter((event) => !fromDate || new Date(event.occurredAt) >= fromDate)
      .filter((event) => !toDate || new Date(event.occurredAt) <= toDate)
      .sort(byOccurredAt);
    const accessLog = documentService?.listAccessLog
      ? guarded(() => documentService.listAccessLog({ principal, organizationId, projectId })) ?? []
      : [];
    return {
      organizationId,
      projectId: projectId ?? null,
      events,
      documentAccess: accessLog,
      meta: {
        generatedAt: clock().toISOString(),
        eventCount: events.length,
        documentAccessCount: accessLog.length,
        checksum: checksum({ events, accessLog })
      }
    };
  }

  // --------------------------------------------------------- evidence packages

  function buildEvidencePackage({ principal, organizationId, projectId, title, purpose, caseId, entityRefs = [], correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.evidencePackageBuild, organizationId, projectId });
    if (!title || !purpose) {
      throw problem(400, "evidence_package_details_required", "An evidence package requires a title and a stated purpose.");
    }
    const references = [...entityRefs];
    if (caseId && caseService?.listCaseLinks) {
      const links = guarded(() => caseService.listCaseLinks({ principal, organizationId, caseId })) ?? [];
      for (const link of links) {
        references.push({ entityType: link.entityType, entityId: link.entityId });
      }
    }
    if (references.length === 0) {
      throw problem(400, "evidence_package_empty", "An evidence package requires at least one entity reference.");
    }

    const artefacts = references.map((reference, index) => {
      const history = getEntityHistory({ principal, organizationId, entityType: reference.entityType, entityId: reference.entityId });
      return {
        artefactId: `artefact_${index + 1}`,
        entityType: reference.entityType,
        entityId: reference.entityId,
        eventCount: history.events.length,
        firstSeenAt: history.meta.firstSeenAt,
        lastSeenAt: history.meta.lastSeenAt,
        checksum: history.meta.checksum
      };
    });

    const evidencePackage = {
      evidencePackageId: `evidence_${evidencePackages.length + 1}`,
      organizationId,
      projectId: projectId ?? null,
      title,
      purpose,
      caseId: caseId ?? null,
      status: "Draft",
      artefacts,
      builtByUserId: principal.user.userId,
      builtAt: clock().toISOString(),
      sealedByUserId: null,
      sealedAt: null,
      manifestChecksum: null
    };
    evidencePackages.push(evidencePackage);
    audit({ principal, organizationId, projectId, action: "audit.evidence_package.build", entityType: "EvidencePackage", entityId: evidencePackage.evidencePackageId, reason: purpose, correlationId });
    return clonePackage(evidencePackage);
  }

  /**
   * Sealing fixes the manifest checksum. After that the package is immutable and any later
   * divergence between the manifest and the live trail is detectable via `verifyEvidencePackage`.
   */
  function sealEvidencePackage({ principal, organizationId, evidencePackageId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.evidencePackageBuild, organizationId });
    const evidencePackage = findPackageOrThrow({ organizationId, evidencePackageId });
    if (!canTransition("evidencePackage", evidencePackage.status, "Sealed")) {
      throw problem(409, "invalid_evidence_package_transition", `Evidence package cannot transition from ${evidencePackage.status} to Sealed.`);
    }
    evidencePackage.status = "Sealed";
    evidencePackage.sealedByUserId = principal.user.userId;
    evidencePackage.sealedAt = clock().toISOString();
    evidencePackage.manifestChecksum = checksum({
      title: evidencePackage.title,
      purpose: evidencePackage.purpose,
      caseId: evidencePackage.caseId,
      artefacts: evidencePackage.artefacts
    });
    audit({ principal, organizationId, projectId: evidencePackage.projectId, action: "audit.evidence_package.seal", entityType: "EvidencePackage", entityId: evidencePackageId, correlationId });
    return clonePackage(evidencePackage);
  }

  function getEvidencePackage({ principal, organizationId, evidencePackageId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.auditPortalRead, organizationId });
    return clonePackage(findPackageOrThrow({ organizationId, evidencePackageId }));
  }

  function listEvidencePackages({ principal, organizationId, projectId, status }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.auditPortalRead, organizationId, projectId });
    return evidencePackages
      .filter((entry) => entry.organizationId === organizationId)
      .filter((entry) => !projectId || entry.projectId === projectId)
      .filter((entry) => !status || entry.status === status)
      .map(clonePackage);
  }

  function verifyEvidencePackage({ principal, organizationId, evidencePackageId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.auditPortalRead, organizationId });
    const evidencePackage = findPackageOrThrow({ organizationId, evidencePackageId });
    if (evidencePackage.status !== "Sealed") {
      throw problem(409, "evidence_package_not_sealed", "Only a sealed evidence package can be verified.");
    }
    const recomputed = evidencePackage.artefacts.map((artefact) => {
      const history = getEntityHistory({ principal, organizationId, entityType: artefact.entityType, entityId: artefact.entityId });
      return {
        artefactId: artefact.artefactId,
        entityType: artefact.entityType,
        entityId: artefact.entityId,
        sealedChecksum: artefact.checksum,
        currentChecksum: history.meta.checksum,
        unchanged: artefact.checksum === history.meta.checksum,
        sealedEventCount: artefact.eventCount,
        currentEventCount: history.events.length
      };
    });
    const manifestChecksum = checksum({
      title: evidencePackage.title,
      purpose: evidencePackage.purpose,
      caseId: evidencePackage.caseId,
      artefacts: evidencePackage.artefacts
    });
    return {
      evidencePackageId,
      manifestIntact: manifestChecksum === evidencePackage.manifestChecksum,
      artefacts: recomputed,
      // Later activity on a subject is expected. What matters is that the sealed manifest itself
      // has not been altered, and that any divergence is visible rather than hidden.
      allArtefactsUnchanged: recomputed.every((artefact) => artefact.unchanged),
      verifiedAt: clock().toISOString()
    };
  }

  // ------------------------------------------------------------- governance

  function getGovernanceReport({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.governanceReportRead, organizationId, projectId });
    const complaints = caseService?.listComplaints
      ? guarded(() => caseService.listComplaints({ principal, organizationId, projectId })) ?? []
      : [];
    const slaBreaches = caseService?.listSlaBreaches
      ? guarded(() => caseService.listSlaBreaches({ principal, organizationId, projectId })) ?? []
      : [];
    const complianceCases = caseService?.listComplianceCases
      ? guarded(() => caseService.listComplianceCases({ principal, organizationId, projectId })) ?? []
      : [];
    const holds = caseService?.listHolds
      ? guarded(() => caseService.listHolds({ principal, organizationId, projectId, status: "Active" })) ?? []
      : [];
    const exceptions = paymentService?.listPaymentExceptions && projectId
      ? guarded(() => paymentService.listPaymentExceptions({ principal, organizationId, projectId })) ?? []
      : [];
    const periods = accountingService?.listFiscalPeriods
      ? accountingService.listFiscalPeriods().filter((period) => (
        period.organizationId === organizationId && (!projectId || period.projectId === projectId)
      ))
      : [];
    const exports = reportingService?.listExportRequests
      ? guarded(() => reportingService.listExportRequests({ principal, organizationId, projectId })) ?? []
      : [];

    const openComplaints = complaints.filter((complaint) => !["Closed", "Rejected", "Withdrawn"].includes(complaint.status));
    const openCases = complianceCases.filter((entry) => !["Closed", "Rejected"].includes(entry.status));

    return {
      organizationId,
      projectId: projectId ?? null,
      complaints: {
        total: complaints.length,
        open: openComplaints.length,
        bySeverity: countBy(openComplaints, (complaint) => complaint.severity),
        byCategory: countBy(openComplaints, (complaint) => complaint.category),
        slaBreaches: slaBreaches.length,
        whistleblowing: complaints.filter((complaint) => complaint.whistleblowing).length
      },
      complianceCases: {
        total: complianceCases.length,
        open: openCases.length,
        bySeverity: countBy(openCases, (entry) => entry.severity),
        bySource: countBy(openCases, (entry) => entry.source),
        ruleTriggered: complianceCases.filter((entry) => entry.triggeredByRuleId).length
      },
      holds: {
        active: holds.length,
        bySubject: countBy(holds, (hold) => hold.subjectType)
      },
      financialControls: {
        reconciliationExceptions: exceptions.length,
        periodsLocked: periods.filter((period) => period.status === "Locked").length,
        periodsOpen: periods.filter((period) => ["Open", "Closing"].includes(period.status)).length
      },
      exports: {
        total: exports.length,
        pendingApproval: exports.filter((entry) => entry.status === "Pending Approval").length,
        unmaskedGenerated: exports.filter((entry) => entry.masking === "unmasked" && entry.status === "Generated").length
      },
      meta: {
        generatedAt: clock().toISOString(),
        asOf: clock().toISOString(),
        boardReady: true,
        checksum: checksum({ complaints: complaints.length, cases: complianceCases.length, holds: holds.length })
      }
    };
  }

  function listRegulatoryTemplates({ principal, organizationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.governanceReportRead, organizationId });
    return REGULATORY_TEMPLATES.map((template) => ({ ...template, measures: [...template.measures] }));
  }

  function getRegulatoryReport({ principal, organizationId, projectId, templateKey }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.governanceReportRead, organizationId, projectId });
    const template = REGULATORY_TEMPLATES.find((candidate) => candidate.templateKey === templateKey);
    if (!template) {
      throw problem(404, "regulatory_template_not_found", `Unknown regulatory template: ${templateKey}.`);
    }
    const measures = buildRegulatoryMeasures({ principal, organizationId, projectId, template });
    return {
      templateKey,
      title: template.title,
      organizationId,
      projectId: projectId ?? null,
      // No regulatory template is approved for submission in this foundation.
      approvedForSubmission: template.approved,
      submissionBlockedReason: template.approved ? null : "Template awaits compliance owner approval before it may be submitted.",
      measures,
      meta: {
        generatedAt: clock().toISOString(),
        asOf: clock().toISOString(),
        checksum: checksum({ templateKey, measures })
      }
    };
  }

  function buildRegulatoryMeasures({ principal, organizationId, projectId, template }) {
    const measures = {};
    if (template.templateKey === "investor-onboarding-summary") {
      const queue = investorService?.listReviewQueue
        ? guarded(() => investorService.listReviewQueue({ principal, organizationId })) ?? []
        : [];
      measures.investorsTotal = queue.length;
      measures.kycApproved = queue.filter((entry) => (entry.status ?? entry.kycStatus) === "Approved").length;
      measures.kycPending = queue.filter((entry) => ["Submitted", "Under Review", "Information Required"].includes(entry.status ?? entry.kycStatus)).length;
      measures.kycRejected = queue.filter((entry) => (entry.status ?? entry.kycStatus) === "Rejected").length;
      measures.duplicatesDetected = null;
    }
    if (template.templateKey === "complaint-handling-summary") {
      const complaints = caseService?.listComplaints
        ? guarded(() => caseService.listComplaints({ principal, organizationId, projectId })) ?? []
        : [];
      const resolved = complaints.filter((complaint) => complaint.resolvedAt);
      measures.complaintsRegistered = complaints.length;
      measures.complaintsResolved = resolved.length;
      measures.complaintsOpen = complaints.filter((complaint) => !["Closed", "Rejected", "Withdrawn"].includes(complaint.status)).length;
      measures.slaBreaches = complaints.filter((complaint) => complaint.sla?.acknowledgeBreached || complaint.sla?.resolveBreached).length;
      measures.averageResolutionHours = resolved.length === 0
        ? null
        : Number((resolved.reduce((total, complaint) => (
          total + (new Date(complaint.resolvedAt) - new Date(complaint.registeredAt)) / 3600000
        ), 0) / resolved.length).toFixed(2));
    }
    if (template.templateKey === "fund-flow-summary") {
      if (!projectId) {
        throw problem(400, "regulatory_project_required", "The fund flow template requires a project.");
      }
      const utilization = guarded(() => accountingService?.getFundUtilization({ principal, organizationId, projectId }));
      const bankBook = guarded(() => accountingService?.getBankBook({ principal, organizationId, projectId }));
      measures.fundsRaised = utilization?.fundsRaised ?? null;
      measures.fundsDeployed = utilization?.fundsDeployed ?? null;
      measures.undeployed = utilization?.undeployed ?? null;
      measures.cashAtBank = bankBook?.closingBalance ?? null;
    }
    return measures;
  }

  // ------------------------------------------------------------------ internals

  function collectSourceMap() {
    const map = {};
    for (const [name, service] of Object.entries(auditSources)) {
      if (service?.getAuditEvents) {
        map[name] = service;
      }
    }
    return map;
  }

  function collectEvents() {
    return Object.entries(collectSourceMap()).flatMap(([source, service]) => (
      service.getAuditEvents().map((event) => ({ ...event, source }))
    ));
  }

  function guarded(producer) {
    try {
      return producer();
    } catch (error) {
      if (error.status === 403) {
        return null;
      }
      throw error;
    }
  }

  function findPackageOrThrow({ organizationId, evidencePackageId }) {
    const evidencePackage = evidencePackages.find((entry) => (
      entry.organizationId === organizationId && entry.evidencePackageId === evidencePackageId
    ));
    if (!evidencePackage) {
      throw problem(404, "evidence_package_not_found", "Evidence package not found.");
    }
    return evidencePackage;
  }

  function clonePackage(evidencePackage) {
    return { ...evidencePackage, artefacts: evidencePackage.artefacts.map((artefact) => ({ ...artefact })) };
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

export const GOVERNANCE_SEVERITY_ORDER = Object.freeze([
  CASE_SEVERITIES.critical,
  CASE_SEVERITIES.high,
  CASE_SEVERITIES.medium,
  CASE_SEVERITIES.low
]);

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

function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    const key = selector(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function byOccurredAt(left, right) {
  return String(left.occurredAt).localeCompare(String(right.occurredAt));
}

function problem(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
