import assert from "node:assert/strict";
import { test } from "node:test";
import { PERMISSIONS } from "../../domain-contracts/src/index.js";
import { createIdentityService } from "../src/index.js";

test("authenticates active synthetic bearer token", () => {
  const identity = createIdentityService();
  const principal = identity.authenticate("Bearer demo-token-project-manager");

  assert.equal(principal.user.userId, "user_pm_001");
  assert.equal(principal.assignments.length, 1);
});

test("rejects missing, invalid, and suspended sessions", () => {
  const identity = createIdentityService();

  assert.throws(() => identity.authenticate(), /Bearer token/);
  assert.throws(() => identity.authenticate("Bearer missing"), /invalid or expired/);
  assert.throws(() => identity.authenticate("Bearer demo-token-suspended"), /not active/);
});

test("authorizes scoped project manager permission", () => {
  const identity = createIdentityService();
  const principal = identity.authenticate("Bearer demo-token-project-manager");
  const assignment = identity.requirePermission({
    principal,
    permission: PERMISSIONS.projectCreate,
    organizationId: "org_demo",
    projectId: "project_agro_001"
  });

  assert.equal(assignment.role, "Project Manager");
});

test("blocks cross-project and role permission violations", () => {
  const identity = createIdentityService();
  const principal = identity.authenticate("Bearer demo-token-project-manager");

  assert.throws(() => identity.requirePermission({
    principal,
    permission: PERMISSIONS.projectCreate,
    organizationId: "org_demo",
    projectId: "project_energy_001"
  }), /No active assignment/);

  assert.throws(() => identity.requirePermission({
    principal,
    permission: PERMISSIONS.voucherAuthorize,
    organizationId: "org_demo",
    projectId: "project_agro_001"
  }), /not allowed/);
});

test("checks approval limits before amount-based approval", () => {
  const identity = createIdentityService();
  const principal = identity.authenticate("Bearer demo-token-voucher-authorizer");

  assert.equal(identity.authorizeAmount({
    principal,
    permission: PERMISSIONS.voucherAuthorize,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    amount: "90000.0000"
  }).maxAmount, "100000.0000");

  assert.throws(() => identity.authorizeAmount({
    principal,
    permission: PERMISSIONS.voucherAuthorize,
    organizationId: "org_demo",
    projectId: "project_agro_001",
    amount: "110000.0000"
  }), /exceeds approval limit/);
});
