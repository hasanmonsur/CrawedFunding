import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdentityService } from "../../identity/src/index.js";
import { createInvestorService } from "../../investors/src/index.js";
import { createMutableSyntheticProjects, createProjectService } from "../../projects/src/index.js";
import { createInvestmentService } from "../src/index.js";

test("approved investor can watch, acknowledge, reserve, and accept a published offer", () => {
  const { identity, investmentService, offerVersionId } = createPublishedFixture();
  const investor = identity.authenticate("Bearer demo-token-investor-approved");

  const watch = investmentService.addToWatchlist({
    principal: investor,
    organizationId: "org_demo",
    projectId: "project_energy_001",
    offerVersionId,
    correlationId: "corr_watch"
  });
  assert.equal(watch.offerVersionId, offerVersionId);

  investmentService.recordSuitability({
    principal: investor,
    organizationId: "org_demo",
    projectId: "project_energy_001",
    offerVersionId,
    answers: { horizon: "medium", understandsRisk: true },
    riskAcknowledged: true,
    correlationId: "corr_suitability"
  });

  const commitment = investmentService.createCommitment({
    principal: investor,
    organizationId: "org_demo",
    projectId: "project_energy_001",
    offerVersionId,
    amount: "50000.0000",
    correlationId: "corr_commitment"
  });
  assert.equal(commitment.status, "Reserved");
  assert.equal(commitment.acceptedOfferProjectVersion, 4);

  const accepted = investmentService.acceptAgreement({
    principal: investor,
    organizationId: "org_demo",
    commitmentId: commitment.commitmentId,
    agreementVersion: "agreement_v1",
    correlationId: "corr_agreement"
  });
  assert.equal(accepted.status, "Awaiting Payment");
});

test("commitment requires approved KYC, suitability, and project amount limits", () => {
  const { identity, investmentService, offerVersionId } = createPublishedFixture();
  const draftInvestor = identity.authenticate("Bearer demo-token-investor");
  const approvedInvestor = identity.authenticate("Bearer demo-token-investor-approved");

  assert.throws(() => investmentService.createCommitment({
    principal: draftInvestor,
    organizationId: "org_demo",
    projectId: "project_energy_001",
    offerVersionId,
    amount: "50000.0000",
    correlationId: "corr_kyc"
  }), /KYC must be approved/);

  assert.throws(() => investmentService.createCommitment({
    principal: approvedInvestor,
    organizationId: "org_demo",
    projectId: "project_energy_001",
    offerVersionId,
    amount: "50000.0000",
    correlationId: "corr_suitability_missing"
  }), /Suitability/);

  investmentService.recordSuitability({
    principal: approvedInvestor,
    organizationId: "org_demo",
    projectId: "project_energy_001",
    offerVersionId,
    answers: { horizon: "medium" },
    riskAcknowledged: true,
    correlationId: "corr_suitability"
  });

  assert.throws(() => investmentService.createCommitment({
    principal: approvedInvestor,
    organizationId: "org_demo",
    projectId: "project_energy_001",
    offerVersionId,
    amount: "5000.0000",
    correlationId: "corr_amount"
  }), /outside project investment limits/);
});

function createPublishedFixture() {
  const identity = createIdentityService();
  const projectService = createProjectService({
    identity,
    projects: createMutableSyntheticProjects()
  });
  const admin = identity.authenticate("Bearer demo-token-project-admin");
  const published = projectService.publishProject({
    principal: admin,
    organizationId: "org_demo",
    projectId: "project_energy_001",
    correlationId: "corr_publish"
  });
  const investorService = createInvestorService({ identity });
  const investmentService = createInvestmentService({ identity, investorService, projectService });
  return { identity, investmentService, offerVersionId: published.publishedOfferVersionId };
}

test("reconciled commitments allocate, activate, and surface as project holdings", () => {
  const identity = createIdentityService();
  const investorService = createInvestorService({ identity });
  const commitments = [{
    commitmentId: "commitment_alloc_1",
    organizationId: "org_demo",
    investorId: "investor_approved_001",
    projectId: "project_agro_001",
    amount: "120000.0000",
    currency: "BDT",
    status: "Reconciled"
  }];
  const investmentService = createInvestmentService({
    identity,
    investorService,
    projectService: { listPublishedProjects: () => [] },
    commitments
  });
  const accountManager = identity.authenticate("Bearer demo-token-account-manager");

  assert.equal(investmentService.listProjectHoldings({
    organizationId: "org_demo",
    projectId: "project_agro_001"
  }).length, 0);

  const allocated = investmentService.allocateCommitment({
    principal: accountManager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    commitmentId: "commitment_alloc_1",
    allocatedAt: "2026-08-05T00:00:00.000Z",
    correlationId: "corr_allocate"
  });
  assert.equal(allocated.status, "Allocated");
  assert.equal(allocated.capitalAmount, "120000.0000");

  const holdings = investmentService.listProjectHoldings({
    organizationId: "org_demo",
    projectId: "project_agro_001"
  });
  assert.equal(holdings.length, 1);
  assert.equal(holdings[0].allocatedAt, "2026-08-05T00:00:00.000Z");
  assert.equal(holdings[0].capitalAmount, "120000.0000");

  const activated = investmentService.activateCommitment({
    principal: accountManager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    commitmentId: "commitment_alloc_1",
    correlationId: "corr_activate"
  });
  assert.equal(activated.status, "Active");

  const settled = investmentService.settleProjectHoldings({
    organizationId: "org_demo",
    projectId: "project_agro_001",
    actorUserId: "user_admin_001",
    correlationId: "corr_settle"
  });
  assert.equal(settled.length, 1);
  assert.equal(settled[0].status, "Settled");
  assert.equal(investmentService.listProjectHoldings({
    organizationId: "org_demo",
    projectId: "project_agro_001"
  }).length, 0);
});

test("allocation is blocked outside the reconciled state and across projects", () => {
  const identity = createIdentityService();
  const investorService = createInvestorService({ identity });
  const investmentService = createInvestmentService({
    identity,
    investorService,
    projectService: { listPublishedProjects: () => [] },
    commitments: [{
      commitmentId: "commitment_alloc_2",
      organizationId: "org_demo",
      investorId: "investor_approved_001",
      projectId: "project_agro_001",
      amount: "50000.0000",
      currency: "BDT",
      status: "Awaiting Payment"
    }]
  });
  const accountManager = identity.authenticate("Bearer demo-token-account-manager");

  assert.throws(() => investmentService.allocateCommitment({
    principal: accountManager,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    commitmentId: "commitment_alloc_2",
    correlationId: "corr_bad_allocate"
  }), /cannot transition from Awaiting Payment to Allocated/);

  assert.throws(() => investmentService.allocateCommitment({
    principal: accountManager,
    organizationId: "org_demo",
    projectId: "project_energy_001",
    commitmentId: "commitment_alloc_2",
    correlationId: "corr_cross_project"
  }), /does not belong to the requested project/);
});
