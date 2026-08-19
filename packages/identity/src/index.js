import {
  PERMISSIONS,
  ROLES,
  assertApprovalLimit,
  assertPermission
} from "../../domain-contracts/src/index.js";

export const demoIdentityStore = Object.freeze({
  organizations: Object.freeze([
    Object.freeze({ organizationId: "org_demo", name: "CrowdFund360 Demo Organization", status: "Active" })
  ]),
  projects: Object.freeze([
    Object.freeze({ organizationId: "org_demo", projectId: "project_agro_001", title: "Synthetic Agro Processing Pilot" }),
    Object.freeze({ organizationId: "org_demo", projectId: "project_energy_001", title: "Synthetic Renewable Energy Pilot" })
  ]),
  users: Object.freeze([
    Object.freeze({
      userId: "user_pm_001",
      displayName: "Synthetic Project Manager",
      organizationId: "org_demo",
      status: "Active",
      mfaVerified: true
    }),
    Object.freeze({
      userId: "user_accounts_001",
      displayName: "Synthetic Account Manager",
      organizationId: "org_demo",
      status: "Active",
      mfaVerified: true
    }),
    Object.freeze({
      userId: "user_accounts_002",
      displayName: "Synthetic Second Account Manager",
      organizationId: "org_demo",
      status: "Active",
      mfaVerified: true
    }),
    Object.freeze({
      userId: "user_authorizer_001",
      displayName: "Synthetic Voucher Authorizer",
      organizationId: "org_demo",
      status: "Active",
      mfaVerified: true
    }),
    Object.freeze({
      userId: "user_auditor_001",
      displayName: "Synthetic Auditor",
      organizationId: "org_demo",
      status: "Active",
      mfaVerified: true
    }),
    Object.freeze({
      userId: "user_admin_001",
      displayName: "Synthetic Project Administrator",
      organizationId: "org_demo",
      status: "Active",
      mfaVerified: true
    }),
    Object.freeze({
      userId: "user_compliance_001",
      displayName: "Synthetic Compliance Officer",
      organizationId: "org_demo",
      status: "Active",
      mfaVerified: true
    }),
    Object.freeze({
      userId: "user_investor_001",
      displayName: "Synthetic Investor One",
      organizationId: "org_demo",
      status: "Active",
      mfaVerified: true
    }),
    Object.freeze({
      userId: "user_investor_duplicate_001",
      displayName: "Synthetic Duplicate Investor",
      organizationId: "org_demo",
      status: "Active",
      mfaVerified: true
    }),
    Object.freeze({
      userId: "user_investor_approved_001",
      displayName: "Synthetic Approved Investor",
      organizationId: "org_demo",
      status: "Active",
      mfaVerified: true
    }),
    Object.freeze({
      userId: "user_superadmin_001",
      displayName: "Synthetic Super Administrator",
      organizationId: "org_demo",
      status: "Active",
      mfaVerified: true
    }),
    Object.freeze({
      userId: "user_suspended_001",
      displayName: "Synthetic Suspended User",
      organizationId: "org_demo",
      status: "Suspended",
      mfaVerified: true
    })
  ]),
  assignments: Object.freeze([
    Object.freeze({
      assignmentId: "assignment_pm_agro",
      userId: "user_pm_001",
      organizationId: "org_demo",
      projectId: "project_agro_001",
      role: ROLES.projectManager
    }),
    Object.freeze({
      assignmentId: "assignment_accounts_agro",
      userId: "user_accounts_001",
      organizationId: "org_demo",
      projectId: "project_agro_001",
      role: ROLES.accountManager
    }),
    Object.freeze({
      assignmentId: "assignment_accounts_energy",
      userId: "user_accounts_001",
      organizationId: "org_demo",
      projectId: "project_energy_001",
      role: ROLES.accountManager
    }),
    Object.freeze({
      assignmentId: "assignment_accounts_two_agro",
      userId: "user_accounts_002",
      organizationId: "org_demo",
      projectId: "project_agro_001",
      role: ROLES.accountManager
    }),
    Object.freeze({
      assignmentId: "assignment_accounts_two_energy",
      userId: "user_accounts_002",
      organizationId: "org_demo",
      projectId: "project_energy_001",
      role: ROLES.accountManager
    }),
    Object.freeze({
      assignmentId: "assignment_authorizer_agro",
      userId: "user_authorizer_001",
      organizationId: "org_demo",
      projectId: "project_agro_001",
      role: ROLES.voucherAuthorizer
    }),
    Object.freeze({
      assignmentId: "assignment_authorizer_energy",
      userId: "user_authorizer_001",
      organizationId: "org_demo",
      projectId: "project_energy_001",
      role: ROLES.voucherAuthorizer
    }),
    Object.freeze({
      assignmentId: "assignment_auditor_org",
      userId: "user_auditor_001",
      organizationId: "org_demo",
      role: ROLES.auditor
    }),
    Object.freeze({
      assignmentId: "assignment_admin_org",
      userId: "user_admin_001",
      organizationId: "org_demo",
      role: ROLES.projectAdministrator
    }),
    Object.freeze({
      assignmentId: "assignment_compliance_agro",
      userId: "user_compliance_001",
      organizationId: "org_demo",
      projectId: "project_agro_001",
      role: ROLES.complianceOfficer
    }),
    Object.freeze({
      assignmentId: "assignment_investor_self",
      userId: "user_investor_001",
      organizationId: "org_demo",
      role: ROLES.investor
    }),
    Object.freeze({
      assignmentId: "assignment_investor_duplicate_self",
      userId: "user_investor_duplicate_001",
      organizationId: "org_demo",
      role: ROLES.investor
    }),
    Object.freeze({
      assignmentId: "assignment_investor_approved_self",
      userId: "user_investor_approved_001",
      organizationId: "org_demo",
      role: ROLES.investor
    }),
    Object.freeze({
      assignmentId: "assignment_superadmin_org",
      userId: "user_superadmin_001",
      organizationId: "org_demo",
      role: ROLES.superAdministrator
    }),
    Object.freeze({
      assignmentId: "assignment_suspended_agro",
      userId: "user_suspended_001",
      organizationId: "org_demo",
      projectId: "project_agro_001",
      role: ROLES.projectManager
    })
  ]),
  approvalLimits: Object.freeze([
    Object.freeze({
      userId: "user_authorizer_001",
      organizationId: "org_demo",
      projectId: "project_agro_001",
      permission: PERMISSIONS.voucherAuthorize,
      currency: "BDT",
      maxAmount: "100000.0000"
    }),
    Object.freeze({
      userId: "user_authorizer_001",
      organizationId: "org_demo",
      projectId: "project_energy_001",
      permission: PERMISSIONS.voucherAuthorize,
      currency: "BDT",
      maxAmount: "1000000.0000"
    }),
    Object.freeze({
      userId: "user_admin_001",
      organizationId: "org_demo",
      projectId: "project_agro_001",
      permission: PERMISSIONS.distributionApprove,
      currency: "BDT",
      maxAmount: "2000000.0000"
    }),
    Object.freeze({
      userId: "user_admin_001",
      organizationId: "org_demo",
      projectId: "project_energy_001",
      permission: PERMISSIONS.distributionApprove,
      currency: "BDT",
      maxAmount: "2000000.0000"
    })
  ]),
  sessions: Object.freeze([
    Object.freeze({ token: "demo-token-project-manager", userId: "user_pm_001", status: "Active" }),
    Object.freeze({ token: "demo-token-account-manager", userId: "user_accounts_001", status: "Active" }),
    Object.freeze({ token: "demo-token-account-manager-two", userId: "user_accounts_002", status: "Active" }),
    Object.freeze({ token: "demo-token-voucher-authorizer", userId: "user_authorizer_001", status: "Active" }),
    Object.freeze({ token: "demo-token-auditor", userId: "user_auditor_001", status: "Active" }),
    Object.freeze({ token: "demo-token-project-admin", userId: "user_admin_001", status: "Active" }),
    Object.freeze({ token: "demo-token-compliance", userId: "user_compliance_001", status: "Active" }),
    Object.freeze({ token: "demo-token-investor", userId: "user_investor_001", status: "Active" }),
    Object.freeze({ token: "demo-token-investor-duplicate", userId: "user_investor_duplicate_001", status: "Active" }),
    Object.freeze({ token: "demo-token-investor-approved", userId: "user_investor_approved_001", status: "Active" }),
    Object.freeze({ token: "demo-token-super-admin", userId: "user_superadmin_001", status: "Active" }),
    Object.freeze({ token: "demo-token-suspended", userId: "user_suspended_001", status: "Active" })
  ])
});

export function createIdentityService(store = demoIdentityStore) {
  return {
    authenticate,
    requirePermission,
    listAssignments,
    findProject,
    authorizeAmount
  };

  function authenticate(authorizationHeader) {
    const token = readBearerToken(authorizationHeader);
    if (!token) {
      throw Object.assign(new Error("Bearer token is required."), { status: 401, code: "auth_required" });
    }

    const session = store.sessions.find((candidate) => candidate.token === token && candidate.status === "Active");
    if (!session) {
      throw Object.assign(new Error("Session is invalid or expired."), { status: 401, code: "invalid_session" });
    }

    const user = store.users.find((candidate) => candidate.userId === session.userId);
    if (!user || user.status !== "Active") {
      throw Object.assign(new Error("User is not active."), { status: 403, code: "user_not_active" });
    }

    if (!user.mfaVerified) {
      throw Object.assign(new Error("MFA verification is required."), { status: 403, code: "mfa_required" });
    }

    return {
      user,
      session,
      assignments: store.assignments.filter((assignment) => assignment.userId === user.userId)
    };
  }

  function requirePermission({ principal, permission, organizationId, projectId }) {
    const assignment = principal.assignments.find((candidate) => {
      const sameOrg = candidate.organizationId === organizationId;
      const sameProject = projectId === undefined || candidate.projectId === projectId || candidate.projectId === undefined;
      return sameOrg && sameProject;
    });

    if (!assignment) {
      throw Object.assign(new Error("No active assignment for requested scope."), {
        status: 403,
        code: "assignment_scope_denied"
      });
    }

    try {
      assertPermission({
        role: assignment.role,
        permission,
        organizationId,
        projectId,
        assignment
      });
    } catch (error) {
      throw Object.assign(error, { status: 403, code: "permission_denied" });
    }

    return assignment;
  }

  function listAssignments(principal) {
    return principal.assignments.map((assignment) => ({
      assignmentId: assignment.assignmentId,
      organizationId: assignment.organizationId,
      projectId: assignment.projectId ?? null,
      role: assignment.role
    }));
  }

  function findProject({ organizationId, projectId }) {
    return store.projects.find((project) => (
      project.organizationId === organizationId && project.projectId === projectId
    ));
  }

  function authorizeAmount({ principal, permission, organizationId, projectId, amount, currency = "BDT" }) {
    const limit = store.approvalLimits.find((candidate) => (
      candidate.userId === principal.user.userId &&
      candidate.organizationId === organizationId &&
      candidate.permission === permission &&
      (projectId === undefined || candidate.projectId === projectId)
    ));

    try {
      assertApprovalLimit({ amount, currency, approvalLimit: limit });
    } catch (error) {
      throw Object.assign(error, { status: 403, code: "approval_limit_denied" });
    }

    return limit;
  }
}

function readBearerToken(authorizationHeader) {
  if (!authorizationHeader) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
  return match?.[1] ?? null;
}
