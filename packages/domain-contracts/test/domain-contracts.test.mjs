import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRODUCT_BOUNDARIES,
  PERMISSIONS,
  ROLES,
  assertApprovalLimit,
  assertFourEyes,
  assertMoney,
  assertPermission,
  assertTenantProjectScope,
  buildAuditEvent,
  canTransition,
  createApiEnvelope,
  hasPermission
} from "../src/index.js";

test("regulated product boundaries are disabled by default", () => {
  assert.equal(PRODUCT_BOUNDARIES.publicFundraisingEnabled, false);
  assert.equal(PRODUCT_BOUNDARIES.guaranteedReturnEnabled, false);
  assert.equal(PRODUCT_BOUNDARIES.autonomousFinancialAdviceEnabled, false);
});

test("project publication follows approved lifecycle transitions", () => {
  assert.equal(canTransition("project", "Approved", "Published"), true);
  assert.equal(canTransition("project", "Draft", "Published"), false);
});

test("posted voucher cannot be edited through ordinary lifecycle", () => {
  assert.equal(canTransition("voucher", "Posted", "Submitted"), false);
  assert.equal(canTransition("voucher", "Posted", "Reversed"), true);
});

test("tenant and project scope must match", () => {
  const record = { organizationId: "org_1", projectId: "project_1" };
  assert.equal(assertTenantProjectScope(record, record), true);
  assert.throws(
    () => assertTenantProjectScope(record, { organizationId: "org_2", projectId: "project_1" }),
    /Cross-organization/
  );
  assert.throws(
    () => assertTenantProjectScope(record, { organizationId: "org_1", projectId: "project_2" }),
    /Cross-project/
  );
});

test("four-eyes rule blocks self approval", () => {
  assert.equal(assertFourEyes({ creatorUserId: "u1", approverUserId: "u2", action: "Voucher authorization" }), true);
  assert.throws(
    () => assertFourEyes({ creatorUserId: "u1", approverUserId: "u1", action: "Voucher authorization" }),
    /independent approval/
  );
});

test("role permission matrix grants only approved actions", () => {
  assert.equal(hasPermission(ROLES.projectManager, PERMISSIONS.voucherCreate), true);
  assert.equal(hasPermission(ROLES.projectManager, PERMISSIONS.voucherAuthorize), false);
  assert.equal(hasPermission(ROLES.complianceOfficer, PERMISSIONS.projectDueDiligenceReview), true);
  assert.equal(hasPermission(ROLES.superAdministrator, PERMISSIONS.auditRead), true);
});

test("permission assertion checks assignment scope and role", () => {
  const assignment = {
    organizationId: "org_1",
    projectId: "project_1",
    role: ROLES.accountManager
  };

  assert.equal(assertPermission({
    role: ROLES.accountManager,
    permission: PERMISSIONS.voucherCheck,
    organizationId: "org_1",
    projectId: "project_1",
    assignment
  }), true);

  assert.throws(() => assertPermission({
    role: ROLES.accountManager,
    permission: PERMISSIONS.projectPublish,
    organizationId: "org_1",
    projectId: "project_1",
    assignment
  }), /not allowed/);

  assert.throws(() => assertPermission({
    role: ROLES.accountManager,
    permission: PERMISSIONS.voucherCheck,
    organizationId: "org_1",
    projectId: "project_2",
    assignment
  }), /Cross-project/);
});

test("approval limits block amounts above authority", () => {
  assert.equal(assertApprovalLimit({
    amount: "50000.00",
    approvalLimit: { currency: "BDT", maxAmount: "100000.00" }
  }), true);

  assert.throws(() => assertApprovalLimit({
    amount: "150000.00",
    approvalLimit: { currency: "BDT", maxAmount: "100000.00" }
  }), /exceeds approval limit/);
});

test("money is fixed precision and currency coded", () => {
  assert.deepEqual(assertMoney("1000.1234"), { amount: "1000.1234", currency: "BDT" });
  assert.throws(() => assertMoney("1000.12345"), /fixed-precision/);
  assert.throws(() => assertMoney("10", "BD"), /ISO 4217/);
});

test("audit events and API envelopes require correlation identifiers", () => {
  const event = buildAuditEvent({
    organizationId: "org_1",
    actorUserId: "user_1",
    action: "project.create",
    entityType: "Project",
    entityId: "project_1",
    correlationId: "corr_1"
  });
  assert.equal(event.correlationId, "corr_1");
  assert.equal(createApiEnvelope({ data: { ok: true }, correlationId: "corr_1" }).meta.correlationId, "corr_1");
  assert.throws(() => createApiEnvelope({ data: null }), /Correlation ID/);
});
