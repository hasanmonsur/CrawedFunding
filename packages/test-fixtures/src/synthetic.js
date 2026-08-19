export const syntheticOrganization = Object.freeze({
  organizationId: "org_demo",
  name: "CrowdFund360 Demo Organization"
});

export const syntheticProject = Object.freeze({
  organizationId: "org_demo",
  projectId: "project_agro_001",
  title: "Synthetic Agro Processing Pilot",
  status: "Draft",
  currency: "BDT"
});

export const syntheticUsers = Object.freeze([
  { userId: "user_pm_001", role: "Project Manager", organizationId: "org_demo" },
  { userId: "user_accounts_001", role: "Account Manager", organizationId: "org_demo" },
  { userId: "user_authorizer_001", role: "Voucher Authorizer", organizationId: "org_demo" },
  { userId: "user_compliance_001", role: "Compliance Officer", organizationId: "org_demo" }
]);
