import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccountingService } from "../../accounting/src/index.js";
import { createAuditPortalService } from "../src/index.js";
import { createCaseService } from "../../cases/src/index.js";
import { createDocumentService, hashContent } from "../../documents/src/index.js";
import { createIdentityService } from "../../identity/src/index.js";
import { createInvestorService } from "../../investors/src/index.js";

const ORG = "org_demo";
const PROJECT = "project_agro_001";

test("the audit portal traces an entity end to end without altering it", () => {
  const world = build();
  const complaint = registerComplaint(world);

  const before = world.cases.getComplaint({ principal: world.compliance, organizationId: ORG, complaintId: complaint.complaintId });
  const history = world.portal.getEntityHistory({
    principal: world.auditor,
    organizationId: ORG,
    entityType: "Complaint",
    entityId: complaint.complaintId
  });
  const after = world.cases.getComplaint({ principal: world.compliance, organizationId: ORG, complaintId: complaint.complaintId });

  assert.deepEqual(after, before, "reading the audit trail must not change the source record");
  assert.ok(history.events.length >= 3);
  assert.ok(history.events.every((event) => event.entityId === complaint.complaintId));
  assert.equal(history.meta.checksum.length, 64);
  assert.ok(history.meta.firstSeenAt <= history.meta.lastSeenAt);
});

test("the audit portal exposes no command that mutates another module", () => {
  const world = build();
  const surface = Object.keys(world.portal);
  const mutating = surface.filter((name) => /^(create|update|delete|post|approve|resolve|place|release|register|assign)/.test(name));
  assert.deepEqual(mutating, [], `audit portal must stay read-only, found: ${mutating.join(", ")}`);
  // The only write it performs is sealing its own evidence package.
  assert.ok(surface.includes("sealEvidencePackage"));
  assert.ok(surface.includes("buildEvidencePackage"));
});

test("audit search filters by entity, actor, action prefix, and correlation id", () => {
  const world = build();
  const complaint = registerComplaint(world);
  world.cases.startComplaintWork({ principal: world.compliance, organizationId: ORG, complaintId: complaint.complaintId, correlationId: "corr_trace_start" });

  const byPrefix = world.portal.searchAuditTrail({
    principal: world.auditor,
    organizationId: ORG,
    actionPrefix: "cases.complaint."
  });
  assert.ok(byPrefix.events.length >= 2);
  assert.ok(byPrefix.events.every((event) => event.action.startsWith("cases.complaint.")));
  assert.equal(byPrefix.meta.checksum.length, 64);

  const byCorrelation = world.portal.searchAuditTrail({
    principal: world.auditor,
    organizationId: ORG,
    correlationIdFilter: "corr_trace_start"
  });
  assert.equal(byCorrelation.events.length, 1);
  assert.equal(byCorrelation.events[0].action, "cases.complaint.start");

  const byActor = world.portal.searchAuditTrail({
    principal: world.auditor,
    organizationId: ORG,
    actorUserId: "user_compliance_001"
  });
  assert.ok(byActor.events.every((event) => event.actorUserId === "user_compliance_001"));

  const limited = world.portal.searchAuditTrail({ principal: world.auditor, organizationId: ORG, limit: 1 });
  assert.equal(limited.returned, 1);
  assert.equal(limited.truncated, limited.totalMatched > 1);
});

test("security events surface holds, rules, exports, and document downloads", () => {
  const world = build();
  world.cases.placeHold({
    principal: world.compliance,
    organizationId: ORG,
    projectId: PROJECT,
    subjectType: "Project",
    subjectId: PROJECT,
    reason: "Investigation in progress.",
    correlationId: "corr_security_hold"
  });
  const document = world.documents.registerDocument({
    principal: world.admin,
    organizationId: ORG,
    projectId: PROJECT,
    documentType: "Evidence",
    title: "Bank statement",
    documentRef: "object://synthetic/statement",
    contentHash: hashContent("statement"),
    classification: "Internal",
    correlationId: "corr_security_doc"
  });
  world.documents.createDownloadGrant({
    principal: world.admin,
    organizationId: ORG,
    documentId: document.documentId,
    purpose: "Investigation evidence",
    correlationId: "corr_security_grant"
  });

  const security = world.portal.listSecurityEvents({ principal: world.auditor, organizationId: ORG });
  const actions = security.events.map((event) => event.action);
  assert.ok(actions.includes("cases.hold.place"));
  assert.ok(actions.includes("document.download_grant.issue"));
  assert.ok(!actions.includes("cases.complaint.register"), "routine business events must not be classed as security events");
});

test("evidence packages seal a manifest and detect later divergence", () => {
  const world = build();
  const complaint = registerComplaint(world);
  const complianceCase = world.cases.openComplianceCase({
    principal: world.compliance,
    organizationId: ORG,
    projectId: PROJECT,
    source: "Complaint",
    severity: "High",
    summary: "Escalated payment complaint",
    links: [{ entityType: "Complaint", entityId: complaint.complaintId }],
    correlationId: "corr_pack_case"
  });

  assert.throws(() => world.portal.buildEvidencePackage({
    principal: world.auditor,
    organizationId: ORG,
    projectId: PROJECT,
    title: "Empty package",
    purpose: "Nothing referenced",
    correlationId: "corr_pack_empty"
  }), /requires at least one entity reference/);

  const built = world.portal.buildEvidencePackage({
    principal: world.auditor,
    organizationId: ORG,
    projectId: PROJECT,
    title: "Complaint investigation pack",
    purpose: "Independent review of the escalated payment complaint",
    caseId: complianceCase.caseId,
    correlationId: "corr_pack_build"
  });
  assert.equal(built.status, "Draft");
  assert.equal(built.artefacts.length, 1);
  assert.equal(built.artefacts[0].entityId, complaint.complaintId);

  assert.throws(() => world.portal.verifyEvidencePackage({
    principal: world.auditor,
    organizationId: ORG,
    evidencePackageId: built.evidencePackageId
  }), /Only a sealed evidence package can be verified/);

  const sealed = world.portal.sealEvidencePackage({
    principal: world.auditor,
    organizationId: ORG,
    evidencePackageId: built.evidencePackageId,
    correlationId: "corr_pack_seal"
  });
  assert.equal(sealed.status, "Sealed");
  assert.equal(sealed.manifestChecksum.length, 64);

  const verifiedImmediately = world.portal.verifyEvidencePackage({
    principal: world.auditor,
    organizationId: ORG,
    evidencePackageId: built.evidencePackageId
  });
  assert.equal(verifiedImmediately.manifestIntact, true);
  assert.equal(verifiedImmediately.allArtefactsUnchanged, true);

  world.cases.startComplaintWork({ principal: world.compliance, organizationId: ORG, complaintId: complaint.complaintId, correlationId: "corr_pack_after" });
  const verifiedAfter = world.portal.verifyEvidencePackage({
    principal: world.auditor,
    organizationId: ORG,
    evidencePackageId: built.evidencePackageId
  });
  assert.equal(verifiedAfter.manifestIntact, true, "the sealed manifest itself must remain intact");
  assert.equal(verifiedAfter.allArtefactsUnchanged, false, "later activity on the subject must be visible, not hidden");
  assert.ok(verifiedAfter.artefacts[0].currentEventCount > verifiedAfter.artefacts[0].sealedEventCount);

  assert.throws(() => world.portal.sealEvidencePackage({
    principal: world.auditor,
    organizationId: ORG,
    evidencePackageId: built.evidencePackageId,
    correlationId: "corr_pack_reseal"
  }), /cannot transition from Sealed to Sealed/);
});

test("governance report summarises cases, holds, and financial controls for the board", () => {
  const world = build();
  registerComplaint(world);
  world.cases.registerComplaint({
    principal: world.investor,
    organizationId: ORG,
    projectId: PROJECT,
    category: "Suspected Fraud",
    subject: "Possible forged evidence",
    description: "Milestone evidence looks forged.",
    correlationId: "corr_gov_whistle"
  });
  world.cases.placeHold({
    principal: world.compliance,
    organizationId: ORG,
    projectId: PROJECT,
    subjectType: "Distribution",
    subjectId: "distribution_1",
    reason: "Pending investigation.",
    correlationId: "corr_gov_hold"
  });

  const report = world.portal.getGovernanceReport({ principal: world.admin, organizationId: ORG, projectId: PROJECT });
  assert.equal(report.complaints.total, 2);
  assert.equal(report.complaints.whistleblowing, 1);
  assert.equal(report.complianceCases.total, 1);
  assert.equal(report.complianceCases.bySource.Whistleblowing, 1);
  assert.equal(report.holds.active, 1);
  assert.equal(report.holds.bySubject.Distribution, 1);
  assert.equal(report.financialControls.periodsOpen, 1);
  assert.equal(report.meta.boardReady, true);
  assert.equal(report.meta.checksum.length, 64);
});

test("regulatory templates are enumerated, unapproved, and refuse unknown keys", () => {
  const world = build();
  registerComplaint(world);

  const templates = world.portal.listRegulatoryTemplates({ principal: world.compliance, organizationId: ORG });
  assert.equal(templates.length, 3);
  assert.ok(templates.every((template) => template.approved === false));

  const report = world.portal.getRegulatoryReport({
    principal: world.compliance,
    organizationId: ORG,
    projectId: PROJECT,
    templateKey: "complaint-handling-summary"
  });
  assert.equal(report.approvedForSubmission, false);
  assert.match(report.submissionBlockedReason, /awaits compliance owner approval/);
  assert.equal(report.measures.complaintsRegistered, 1);
  assert.equal(report.measures.complaintsOpen, 1);
  assert.equal(report.meta.checksum.length, 64);

  assert.throws(() => world.portal.getRegulatoryReport({
    principal: world.compliance,
    organizationId: ORG,
    templateKey: "made-up-return"
  }), /Unknown regulatory template/);

  assert.throws(() => world.portal.getRegulatoryReport({
    principal: world.compliance,
    organizationId: ORG,
    templateKey: "fund-flow-summary"
  }), /requires a project/);
});

test("audit portal access is refused to roles without the portal permission", () => {
  const world = build();
  assert.throws(() => world.portal.searchAuditTrail({
    principal: world.investor,
    organizationId: ORG
  }), /not allowed to perform audit-portal:read/);

  assert.throws(() => world.portal.getGovernanceReport({
    principal: world.investor,
    organizationId: ORG
  }), /not allowed to perform governance-report:read/);
});

function build() {
  const identity = createIdentityService();
  const investorService = createInvestorService({ identity });
  const accountingService = createAccountingService({ identity });
  const documents = createDocumentService({ identity, investorService });
  const cases = createCaseService({ identity, investorService, clock: () => new Date("2026-08-21T09:00:00.000Z") });
  const portal = createAuditPortalService({
    identity,
    auditSources: { cases, documents, accounting: accountingService, investors: investorService },
    documentService: documents,
    caseService: cases,
    accountingService,
    investorService,
    clock: () => new Date("2026-08-21T12:00:00.000Z")
  });
  return {
    identity,
    cases,
    documents,
    accountingService,
    portal,
    investor: identity.authenticate("Bearer demo-token-investor-approved"),
    compliance: identity.authenticate("Bearer demo-token-compliance"),
    admin: identity.authenticate("Bearer demo-token-project-admin"),
    auditor: identity.authenticate("Bearer demo-token-auditor")
  };
}

function registerComplaint(world) {
  const complaint = world.cases.registerComplaint({
    principal: world.investor,
    organizationId: ORG,
    projectId: PROJECT,
    category: "Payment",
    severity: "High",
    subject: "Payment not credited",
    description: "My transfer has not appeared.",
    correlationId: "corr_trace_register"
  });
  world.cases.triageComplaint({ principal: world.compliance, organizationId: ORG, complaintId: complaint.complaintId, correlationId: "corr_trace_triage_seed" });
  world.cases.assignComplaint({ principal: world.compliance, organizationId: ORG, complaintId: complaint.complaintId, assignedToUserId: "user_accounts_001", correlationId: "corr_trace_assign" });
  return complaint;
}
