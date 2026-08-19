import {
  PERMISSIONS,
  buildAuditEvent,
  canTransition
} from "../../domain-contracts/src/index.js";

export function createProjectService({ identity, projects, auditEvents = [] }) {
  const sponsors = createMutableSyntheticSponsors();
  const dueDiligence = createMutableSyntheticDueDiligence();
  const riskAssessments = [];
  const offerVersions = [];

  return {
    listProjects,
    getProjectDetail,
    completeDueDiligenceItem,
    recordDueDiligenceFinding,
    calculateRiskAssessment,
    submitForDueDiligence,
    submitForReview,
    approveProject,
    publishProject,
    listOfferVersions,
    listPublishedProjects,
    findPublishedOfferVersion,
    getAuditEvents: () => auditEvents.slice()
  };

  function listProjects({ principal, organizationId }) {
    return projects.filter((project) => (
      project.organizationId === organizationId &&
      principal.assignments.some((assignment) => (
        assignment.organizationId === organizationId &&
        (assignment.projectId === undefined || assignment.projectId === project.projectId)
      ))
    ));
  }

  function getProjectDetail({ principal, organizationId, projectId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.projectCreate,
      organizationId,
      projectId
    });
    const project = findProjectOrThrow({ organizationId, projectId });
    return {
      ...project,
      sponsor: sponsors.find((sponsor) => sponsor.sponsorId === project.sponsorId) ?? null,
      dueDiligence: dueDiligence.filter((item) => item.projectId === projectId),
      latestRiskAssessment: riskAssessments.findLast?.((item) => item.projectId === projectId) ??
        [...riskAssessments].reverse().find((item) => item.projectId === projectId) ??
        null,
      offerVersions: offerVersions.filter((offer) => offer.projectId === projectId)
    };
  }

  function completeDueDiligenceItem({ principal, organizationId, projectId, itemId, evidenceDocumentId, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.projectDueDiligenceReview,
      organizationId,
      projectId
    });
    const item = findDueDiligenceItemOrThrow({ organizationId, projectId, itemId });
    item.status = "Completed";
    item.evidenceDocumentId = evidenceDocumentId ?? null;
    item.completedByUserId = principal.user.userId;

    auditEvents.push(buildAuditEvent({
      organizationId,
      projectId,
      actorUserId: principal.user.userId,
      action: "project.due_diligence.complete_item",
      entityType: "DueDiligenceItem",
      entityId: itemId,
      correlationId
    }));

    return { ...item };
  }

  function recordDueDiligenceFinding({ principal, organizationId, projectId, itemId, severity, note, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.projectDueDiligenceReview,
      organizationId,
      projectId
    });
    const item = findDueDiligenceItemOrThrow({ organizationId, projectId, itemId });
    item.findings.push({
      findingId: `finding_${item.findings.length + 1}`,
      severity,
      note,
      recordedByUserId: principal.user.userId
    });
    item.status = severity === "High" ? "Remediation Required" : item.status;

    auditEvents.push(buildAuditEvent({
      organizationId,
      projectId,
      actorUserId: principal.user.userId,
      action: "project.due_diligence.record_finding",
      entityType: "DueDiligenceItem",
      entityId: itemId,
      reason: severity,
      correlationId
    }));

    return { ...item, findings: item.findings.map((finding) => ({ ...finding })) };
  }

  function calculateRiskAssessment({ principal, organizationId, projectId, scores, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.projectRiskAssess,
      organizationId,
      projectId
    });
    findProjectOrThrow({ organizationId, projectId });
    const requiredDimensions = ["sponsor", "market", "finance", "execution", "legal", "governance"];
    for (const dimension of requiredDimensions) {
      const value = scores?.[dimension];
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        throw Object.assign(new Error(`Risk score ${dimension} must be an integer from 1 to 5.`), {
          status: 400,
          code: "risk_score_invalid"
        });
      }
    }
    const total = requiredDimensions.reduce((sum, dimension) => sum + scores[dimension], 0);
    const average = Number((total / requiredDimensions.length).toFixed(2));
    const band = average >= 4 ? "High" : average >= 2.5 ? "Medium" : "Low";
    const assessment = {
      assessmentId: `risk_${riskAssessments.length + 1}`,
      organizationId,
      projectId,
      scores: { ...scores },
      average,
      band,
      assessedByUserId: principal.user.userId
    };
    riskAssessments.push(assessment);

    auditEvents.push(buildAuditEvent({
      organizationId,
      projectId,
      actorUserId: principal.user.userId,
      action: "project.risk.assess",
      entityType: "RiskAssessment",
      entityId: assessment.assessmentId,
      reason: band,
      correlationId
    }));

    return { ...assessment, scores: { ...assessment.scores } };
  }

  function submitForDueDiligence({ principal, organizationId, projectId, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.projectCreate,
      organizationId,
      projectId
    });
    return transition({
      principal,
      organizationId,
      projectId,
      to: "Due Diligence",
      action: "project.submit_due_diligence",
      correlationId
    });
  }

  function submitForReview({ principal, organizationId, projectId, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.projectDueDiligenceReview,
      organizationId,
      projectId
    });
    assertDueDiligenceReady({ organizationId, projectId });
    assertRiskAssessmentReady({ projectId });
    return transition({
      principal,
      organizationId,
      projectId,
      to: "Review",
      action: "project.submit_review",
      correlationId
    });
  }

  function approveProject({ principal, organizationId, projectId, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.projectApprove,
      organizationId,
      projectId
    });
    assertDueDiligenceReady({ organizationId, projectId });
    assertRiskAssessmentReady({ projectId });
    return transition({
      principal,
      organizationId,
      projectId,
      to: "Approved",
      action: "project.approve",
      correlationId
    });
  }

  function publishProject({ principal, organizationId, projectId, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.projectPublish,
      organizationId,
      projectId
    });
    const project = transition({
      principal,
      organizationId,
      projectId,
      to: "Published",
      action: "project.publish",
      correlationId
    });
    const offerVersion = createOfferVersion({ principal, project, correlationId });
    return { ...project, publishedOfferVersionId: offerVersion.offerVersionId };
  }

  function listOfferVersions({ principal, organizationId, projectId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.projectCreate,
      organizationId,
      projectId
    });
    return offerVersions
      .filter((offer) => offer.organizationId === organizationId && offer.projectId === projectId)
      .map((offer) => ({ ...offer, snapshot: { ...offer.snapshot } }));
  }

  function listPublishedProjects({ organizationId }) {
    return projects
      .filter((project) => project.organizationId === organizationId && project.status === "Published")
      .map((project) => ({
        ...project,
        latestOfferVersion: [...offerVersions].reverse().find((offer) => (
          offer.organizationId === organizationId &&
          offer.projectId === project.projectId &&
          offer.status === "Published"
        )) ?? null
      }))
      .filter((project) => project.latestOfferVersion);
  }

  function findPublishedOfferVersion({ organizationId, projectId, offerVersionId }) {
    const offer = offerVersions.find((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.projectId === projectId &&
      candidate.offerVersionId === offerVersionId &&
      candidate.status === "Published"
    ));
    if (!offer) {
      throw Object.assign(new Error("Published offer version not found."), {
        status: 404,
        code: "published_offer_not_found"
      });
    }
    const project = findProjectOrThrow({ organizationId, projectId });
    return { offer: { ...offer, snapshot: { ...offer.snapshot } }, project: { ...project } };
  }

  function transition({ principal, organizationId, projectId, to, action, correlationId }) {
    const project = findProjectOrThrow({ organizationId, projectId });
    if (!canTransition("project", project.status, to)) {
      throw Object.assign(new Error(`Project cannot transition from ${project.status} to ${to}.`), {
        status: 409,
        code: "invalid_project_transition"
      });
    }

    project.status = to;
    project.version += 1;
    project.updatedByUserId = principal.user.userId;

    auditEvents.push(buildAuditEvent({
      organizationId,
      projectId,
      actorUserId: principal.user.userId,
      action,
      entityType: "Project",
      entityId: projectId,
      correlationId
    }));

    return { ...project };
  }

  function findProjectOrThrow({ organizationId, projectId }) {
    const project = projects.find((candidate) => (
      candidate.organizationId === organizationId && candidate.projectId === projectId
    ));
    if (!project) {
      throw Object.assign(new Error("Project not found."), { status: 404, code: "project_not_found" });
    }
    return project;
  }

  function findDueDiligenceItemOrThrow({ organizationId, projectId, itemId }) {
    const item = dueDiligence.find((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.projectId === projectId &&
      candidate.itemId === itemId
    ));
    if (!item) {
      throw Object.assign(new Error("Due diligence item not found."), {
        status: 404,
        code: "due_diligence_item_not_found"
      });
    }
    return item;
  }

  function assertDueDiligenceReady({ organizationId, projectId }) {
    const items = dueDiligence.filter((item) => item.organizationId === organizationId && item.projectId === projectId);
    const incomplete = items.filter((item) => item.status !== "Completed");
    if (items.length === 0 || incomplete.length > 0) {
      throw Object.assign(new Error("All due diligence checklist items must be completed before approval."), {
        status: 409,
        code: "due_diligence_incomplete"
      });
    }
  }

  function assertRiskAssessmentReady({ projectId }) {
    if (!riskAssessments.some((assessment) => assessment.projectId === projectId)) {
      throw Object.assign(new Error("Risk assessment is required before project approval."), {
        status: 409,
        code: "risk_assessment_required"
      });
    }
  }

  function createOfferVersion({ principal, project, correlationId }) {
    const offerVersion = Object.freeze({
      offerVersionId: `offer_${project.projectId}_${offerVersions.length + 1}`,
      organizationId: project.organizationId,
      projectId: project.projectId,
      projectVersion: project.version,
      status: "Published",
      acceptedByInvestors: 0,
      snapshot: Object.freeze({
        title: project.title,
        fundingTarget: project.fundingTarget,
        minimumInvestment: project.minimumInvestment,
        maximumInvestment: project.maximumInvestment,
        currency: project.currency,
        riskBand: riskAssessments.findLast?.((item) => item.projectId === project.projectId)?.band ??
          [...riskAssessments].reverse().find((item) => item.projectId === project.projectId)?.band ??
          null
      })
    });
    offerVersions.push(offerVersion);

    auditEvents.push(buildAuditEvent({
      organizationId: project.organizationId,
      projectId: project.projectId,
      actorUserId: principal.user.userId,
      action: "project.offer_version.publish",
      entityType: "OfferVersion",
      entityId: offerVersion.offerVersionId,
      correlationId
    }));

    return offerVersion;
  }
}

export function createMutableSyntheticProjects() {
  return [
    {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      sponsorId: "sponsor_agro_001",
      title: "Synthetic Agro Processing Pilot",
      status: "Draft",
      version: 1,
      currency: "BDT",
      fundingTarget: "5000000.0000",
      minimumInvestment: "10000.0000",
      maximumInvestment: "500000.0000"
    },
    {
      organizationId: "org_demo",
      projectId: "project_energy_001",
      sponsorId: "sponsor_energy_001",
      title: "Synthetic Renewable Energy Pilot",
      status: "Approved",
      version: 3,
      currency: "BDT",
      fundingTarget: "8000000.0000",
      minimumInvestment: "20000.0000",
      maximumInvestment: "800000.0000"
    }
  ];
}

export function createMutableSyntheticSponsors() {
  return [
    {
      organizationId: "org_demo",
      sponsorId: "sponsor_agro_001",
      legalName: "Synthetic Agro Sponsor Ltd",
      sector: "Agro Processing",
      status: "Under Review"
    },
    {
      organizationId: "org_demo",
      sponsorId: "sponsor_energy_001",
      legalName: "Synthetic Renewable Sponsor Ltd",
      sector: "Renewable Energy",
      status: "Approved"
    }
  ];
}

export function createMutableSyntheticDueDiligence() {
  return [
    {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      itemId: "dd_legal_identity",
      label: "Legal identity and authorization",
      status: "Pending",
      findings: []
    },
    {
      organizationId: "org_demo",
      projectId: "project_agro_001",
      itemId: "dd_financial_assumptions",
      label: "Financial assumptions and liabilities",
      status: "Pending",
      findings: []
    },
    {
      organizationId: "org_demo",
      projectId: "project_energy_001",
      itemId: "dd_legal_identity",
      label: "Legal identity and authorization",
      status: "Completed",
      findings: []
    }
  ];
}
