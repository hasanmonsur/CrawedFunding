import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdentityService } from "../../identity/src/index.js";
import { createMutableSyntheticProjects, createProjectService } from "../src/index.js";

test("project manager can submit assigned draft project to due diligence", () => {
  const identity = createIdentityService();
  const principal = identity.authenticate("Bearer demo-token-project-manager");
  const projects = createMutableSyntheticProjects();
  const service = createProjectService({ identity, projects });

  const updated = service.submitForDueDiligence({
    principal,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    correlationId: "corr_project_submit"
  });

  assert.equal(updated.status, "Due Diligence");
  assert.equal(updated.version, 2);
  assert.equal(service.getAuditEvents()[0].action, "project.submit_due_diligence");
});

test("project lifecycle rejects invalid direct publication", () => {
  const identity = createIdentityService();
  const principal = identity.authenticate("Bearer demo-token-project-manager");
  const projects = createMutableSyntheticProjects();
  const service = createProjectService({ identity, projects });

  assert.throws(() => service.publishProject({
    principal,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    correlationId: "corr_project_publish"
  }), /not allowed/);
});

test("project administrator can publish an approved project", () => {
  const identity = createIdentityService();
  const principal = identity.authenticate("Bearer demo-token-project-admin");
  const projects = createMutableSyntheticProjects();
  const service = createProjectService({ identity, projects });

  const updated = service.publishProject({
    principal,
    organizationId: "org_demo",
    projectId: "project_energy_001",
    correlationId: "corr_project_publish"
  });

  assert.equal(updated.status, "Published");
  assert.equal(updated.publishedOfferVersionId, "offer_project_energy_001_1");
});

test("due diligence, risk assessment, review, and approval are gated", () => {
  const identity = createIdentityService();
  const pm = identity.authenticate("Bearer demo-token-project-manager");
  const compliance = identity.authenticate("Bearer demo-token-compliance");
  const admin = identity.authenticate("Bearer demo-token-project-admin");
  const projects = createMutableSyntheticProjects();
  const service = createProjectService({ identity, projects });

  service.submitForDueDiligence({
    principal: pm,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    correlationId: "corr_submit_dd"
  });

  assert.throws(() => service.submitForReview({
    principal: compliance,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    correlationId: "corr_review_blocked"
  }), /due diligence checklist/);

  service.completeDueDiligenceItem({
    principal: compliance,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    itemId: "dd_legal_identity",
    evidenceDocumentId: "doc_legal_001",
    correlationId: "corr_dd_legal"
  });
  service.completeDueDiligenceItem({
    principal: compliance,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    itemId: "dd_financial_assumptions",
    evidenceDocumentId: "doc_finance_001",
    correlationId: "corr_dd_finance"
  });

  assert.throws(() => service.submitForReview({
    principal: compliance,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    correlationId: "corr_review_risk_blocked"
  }), /Risk assessment/);

  const risk = service.calculateRiskAssessment({
    principal: compliance,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    scores: { sponsor: 2, market: 3, finance: 3, execution: 2, legal: 2, governance: 3 },
    correlationId: "corr_risk"
  });
  assert.equal(risk.band, "Medium");

  const review = service.submitForReview({
    principal: compliance,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    correlationId: "corr_review"
  });
  assert.equal(review.status, "Review");

  const approved = service.approveProject({
    principal: admin,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    correlationId: "corr_approve"
  });
  assert.equal(approved.status, "Approved");
});

test("high due-diligence finding blocks review until remediated", () => {
  const identity = createIdentityService();
  const pm = identity.authenticate("Bearer demo-token-project-manager");
  const compliance = identity.authenticate("Bearer demo-token-compliance");
  const projects = createMutableSyntheticProjects();
  const service = createProjectService({ identity, projects });

  service.submitForDueDiligence({
    principal: pm,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    correlationId: "corr_submit_dd"
  });

  const item = service.recordDueDiligenceFinding({
    principal: compliance,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    itemId: "dd_legal_identity",
    severity: "High",
    note: "Synthetic title evidence missing",
    correlationId: "corr_finding"
  });

  assert.equal(item.status, "Remediation Required");
  assert.throws(() => service.submitForReview({
    principal: compliance,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    correlationId: "corr_review"
  }), /due diligence checklist/);
});
