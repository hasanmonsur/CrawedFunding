import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdentityService } from "../../identity/src/index.js";
import { createInvestorService } from "../../investors/src/index.js";
import { createCaseService, evaluateCondition } from "../src/index.js";

const ORG = "org_demo";
const PROJECT = "project_agro_001";

test("a complaint runs from registration through resolution with SLA targets derived from severity", () => {
  let now = new Date("2026-08-21T09:00:00.000Z");
  const { service, investor, compliance, admin } = harness({ clock: () => now });

  const complaint = service.registerComplaint({
    principal: investor,
    organizationId: ORG,
    projectId: PROJECT,
    category: "Payment",
    severity: "High",
    subject: "Payment not credited",
    description: "My transfer has not appeared against my commitment.",
    correlationId: "corr_register"
  });
  assert.equal(complaint.status, "Registered");
  assert.equal(complaint.acknowledgeDueAt, "2026-08-21T17:00:00.000Z");
  assert.equal(complaint.resolveDueAt, "2026-08-24T09:00:00.000Z");
  assert.equal(complaint.sla.acknowledgeBreached, false);

  service.triageComplaint({ principal: compliance, organizationId: ORG, complaintId: complaint.complaintId, correlationId: "corr_triage" });
  service.assignComplaint({ principal: compliance, organizationId: ORG, complaintId: complaint.complaintId, assignedToUserId: "user_accounts_001", correlationId: "corr_assign" });
  service.startComplaintWork({ principal: compliance, organizationId: ORG, complaintId: complaint.complaintId, correlationId: "corr_start" });

  const resolved = service.resolveComplaint({
    principal: compliance,
    organizationId: ORG,
    complaintId: complaint.complaintId,
    resolution: "Payment traced and credited; reconciliation corrected.",
    correlationId: "corr_resolve"
  });
  assert.equal(resolved.status, "Resolved");
  assert.equal(resolved.sla.resolveBreached, false);

  const closed = service.closeComplaint({ principal: admin, organizationId: ORG, complaintId: complaint.complaintId, correlationId: "corr_close" });
  assert.equal(closed.status, "Closed");

  const appealed = service.appealComplaint({
    principal: investor,
    organizationId: ORG,
    complaintId: complaint.complaintId,
    reason: "The credited amount is short by the bank charge.",
    correlationId: "corr_appeal"
  });
  assert.equal(appealed.status, "Under Appeal");
  assert.equal(appealed.appealCount, 1);
  assert.deepEqual(
    appealed.history.map((entry) => entry.action),
    ["registered", "triaged", "assigned", "work-started", "resolved", "closed", "appealed"]
  );
});

test("SLA breaches are derived from the clock rather than stored", () => {
  let now = new Date("2026-08-21T09:00:00.000Z");
  const { service, investor, compliance } = harness({ clock: () => now });

  const complaint = service.registerComplaint({
    principal: investor,
    organizationId: ORG,
    projectId: PROJECT,
    category: "Service",
    severity: "Critical",
    subject: "No response",
    description: "Nobody has replied to me.",
    correlationId: "corr_sla"
  });
  assert.equal(service.getSlaStatus({ principal: compliance, organizationId: ORG, complaintId: complaint.complaintId }).acknowledgeBreached, false);

  now = new Date("2026-08-21T14:00:00.000Z");
  const breached = service.getSlaStatus({ principal: compliance, organizationId: ORG, complaintId: complaint.complaintId });
  assert.equal(breached.acknowledgeBreached, true);
  assert.equal(breached.resolveBreached, false);
  assert.ok(breached.acknowledgeRemainingHours < 0);

  now = new Date("2026-08-23T14:00:00.000Z");
  const list = service.listSlaBreaches({ principal: compliance, organizationId: ORG, projectId: PROJECT });
  assert.equal(list.length, 1);
  assert.equal(list[0].resolveBreached, true);
});

test("severity re-classification moves the SLA targets", () => {
  const now = new Date("2026-08-21T09:00:00.000Z");
  const { service, investor, compliance } = harness({ clock: () => now });

  const complaint = service.registerComplaint({
    principal: investor,
    organizationId: ORG,
    projectId: PROJECT,
    category: "Service",
    severity: "Low",
    subject: "Slow support",
    description: "Support has been slow to respond.",
    correlationId: "corr_reclass"
  });
  assert.equal(complaint.resolveDueAt, "2026-09-04T09:00:00.000Z");

  const reclassified = service.applyClassification({
    principal: compliance,
    organizationId: ORG,
    complaintId: complaint.complaintId,
    category: "Payment",
    severity: "Critical",
    rationale: "Investor confirmed funds are missing, not merely a support delay.",
    correlationId: "corr_apply"
  });
  assert.equal(reclassified.severity, "Critical");
  assert.equal(reclassified.resolveDueAt, "2026-08-22T09:00:00.000Z");
  assert.equal(reclassified.classification.appliedByUserId, "user_compliance_001");
});

test("whistleblowing reports withhold the reporter and open a compliance case", () => {
  const { service, investor, compliance } = harness();

  const report = service.registerComplaint({
    principal: investor,
    organizationId: ORG,
    projectId: PROJECT,
    category: "Suspected Fraud",
    subject: "Suspected forged invoices",
    description: "Invoices appear forged and funds may have been diverted.",
    investorId: "investor_approved_001",
    correlationId: "corr_whistle"
  });

  assert.equal(report.whistleblowing, true);
  assert.equal(report.anonymous, true);
  assert.equal(report.reportedByUserId, null);
  assert.equal(report.investorId, null);
  assert.equal(report.history[0].actorUserId, "anonymous");
  assert.ok(!JSON.stringify(report).includes("user_investor_approved_001"));

  const cases = service.listComplianceCases({ principal: compliance, organizationId: ORG });
  assert.equal(cases.length, 1);
  assert.equal(cases[0].source, "Whistleblowing");
  assert.equal(cases[0].severity, "High");

  const links = service.listCaseLinks({ principal: compliance, organizationId: ORG, caseId: cases[0].caseId });
  assert.equal(links.length, 1);
  assert.equal(links[0].entityType, "Complaint");
  assert.equal(links[0].entityId, report.complaintId);
});

test("a complaint cannot be resolved by the person who raised it", () => {
  const { service, compliance, identity } = harness();
  const complianceSelf = identity.authenticate("Bearer demo-token-compliance");

  const complaint = service.registerComplaint({
    principal: complianceSelf,
    organizationId: ORG,
    projectId: PROJECT,
    category: "Service",
    severity: "Medium",
    subject: "Internal escalation",
    description: "Raised by compliance on behalf of an investor call.",
    correlationId: "corr_self"
  });
  service.triageComplaint({ principal: compliance, organizationId: ORG, complaintId: complaint.complaintId, correlationId: "corr_self_triage" });
  service.assignComplaint({ principal: compliance, organizationId: ORG, complaintId: complaint.complaintId, assignedToUserId: "user_accounts_001", correlationId: "corr_self_assign" });
  service.startComplaintWork({ principal: compliance, organizationId: ORG, complaintId: complaint.complaintId, correlationId: "corr_self_start" });

  assert.throws(() => service.resolveComplaint({
    principal: complianceSelf,
    organizationId: ORG,
    complaintId: complaint.complaintId,
    resolution: "Closing my own complaint.",
    correlationId: "corr_self_resolve"
  }), /requires independent approval/);
});

test("AI classification and drafted responses are advisory and never applied automatically", () => {
  const { service, investor, compliance } = harness();

  const complaint = service.registerComplaint({
    principal: investor,
    organizationId: ORG,
    projectId: PROJECT,
    category: "Other",
    severity: "Low",
    subject: "Money deducted twice",
    description: "A payment was deducted twice and no refund has arrived.",
    correlationId: "corr_ai"
  });

  const classification = service.classifyComplaint({ principal: compliance, organizationId: ORG, complaintId: complaint.complaintId });
  assert.equal(classification.authoritative, false);
  assert.equal(classification.requiresHumanApproval, true);
  assert.equal(classification.suggestedCategory, "Payment");
  assert.ok(classification.explanation.length > 0);

  const unchanged = service.getComplaint({ principal: compliance, organizationId: ORG, complaintId: complaint.complaintId });
  assert.equal(unchanged.category, "Other");
  assert.equal(unchanged.severity, "Low");
  assert.equal(unchanged.classification, null);

  const draft = service.draftComplaintResponse({ principal: compliance, organizationId: ORG, complaintId: complaint.complaintId });
  assert.equal(draft.authoritative, false);
  assert.equal(draft.requiresHumanApproval, true);
  assert.match(draft.draft, /still under review and no outcome has been decided/);

  assert.throws(() => service.applyClassification({
    principal: compliance,
    organizationId: ORG,
    complaintId: complaint.complaintId,
    category: classification.suggestedCategory,
    severity: classification.suggestedSeverity,
    correlationId: "corr_apply_no_rationale"
  }), /requires a human rationale/);
});

test("governance holds require an independent releaser and propagate to the investor module", () => {
  const { service, compliance, admin, investorService, complianceSecond } = harness();

  const hold = service.placeHold({
    principal: compliance,
    organizationId: ORG,
    projectId: PROJECT,
    subjectType: "Investor",
    subjectId: "investor_approved_001",
    reason: "Sanctions screening match pending review.",
    correlationId: "corr_hold"
  });
  assert.equal(hold.status, "Active");
  assert.equal(hold.propagated, true);
  assert.equal(
    investorService.getInvestorSettlementProfile({ organizationId: ORG, investorId: "investor_approved_001" }).holdStatus,
    "Compliance Hold"
  );
  assert.equal(service.isHeld({ organizationId: ORG, subjectType: "Investor", subjectId: "investor_approved_001" }), true);

  assert.throws(() => service.placeHold({
    principal: compliance,
    organizationId: ORG,
    projectId: PROJECT,
    subjectType: "Investor",
    subjectId: "investor_approved_001",
    reason: "Duplicate hold attempt.",
    correlationId: "corr_hold_twice"
  }), /already exists/);

  assert.throws(() => service.releaseHold({
    principal: compliance,
    organizationId: ORG,
    holdId: hold.holdId,
    reason: "Self release.",
    correlationId: "corr_release_self"
  }), /not allowed to perform governance-hold:release/);

  const released = service.releaseHold({
    principal: admin,
    organizationId: ORG,
    holdId: hold.holdId,
    reason: "Screening cleared with documented evidence.",
    correlationId: "corr_release"
  });
  assert.equal(released.status, "Released");
  assert.equal(service.isHeld({ organizationId: ORG, subjectType: "Investor", subjectId: "investor_approved_001" }), false);
  assert.ok(complianceSecond);
});

test("a compliance case cannot be resolved while it still holds something", () => {
  const { service, compliance, admin } = harness();

  const complianceCase = service.openComplianceCase({
    principal: compliance,
    organizationId: ORG,
    projectId: PROJECT,
    source: "Payment",
    severity: "High",
    summary: "Unexplained third-party credit",
    links: [{ entityType: "Payment", entityId: "banktx_1" }],
    correlationId: "corr_case"
  });
  const hold = service.placeHold({
    principal: compliance,
    organizationId: ORG,
    projectId: PROJECT,
    subjectType: "Payment",
    subjectId: "banktx_1",
    reason: "Source of funds unverified.",
    caseId: complianceCase.caseId,
    correlationId: "corr_case_hold"
  });

  service.advanceComplianceCase({ principal: compliance, organizationId: ORG, caseId: complianceCase.caseId, to: "Under Investigation", correlationId: "corr_case_advance" });
  assert.throws(() => service.resolveComplianceCase({
    principal: compliance,
    organizationId: ORG,
    caseId: complianceCase.caseId,
    resolution: "Closing early.",
    correlationId: "corr_case_resolve_early"
  }), /Resolve or release 1 active hold/);

  service.releaseHold({ principal: admin, organizationId: ORG, holdId: hold.holdId, reason: "Source of funds evidenced.", correlationId: "corr_case_release" });
  const resolved = service.resolveComplianceCase({
    principal: compliance,
    organizationId: ORG,
    caseId: complianceCase.caseId,
    resolution: "Third-party credit evidenced as investor transfer.",
    correlationId: "corr_case_resolve"
  });
  assert.equal(resolved.status, "Resolved");
});

test("approved rules open cases, raise holds, and flag patterns with an explanation", () => {
  const { service, compliance } = harness();

  const duplicate = service.evaluateSignal({
    principal: compliance,
    organizationId: ORG,
    projectId: PROJECT,
    signalType: "Duplicate Detection",
    payload: { duplicateCount: 2, investorId: "investor_duplicate_001" },
    correlationId: "corr_signal_dup"
  });
  assert.deepEqual(duplicate.matchedRuleIds, ["rule_seed_duplicate_identity"]);
  assert.equal(duplicate.createdCaseIds.length, 1);

  const cases = service.listComplianceCases({ principal: compliance, organizationId: ORG, source: "Duplicate Detection" });
  assert.equal(cases[0].triggeredByRuleId, "rule_seed_duplicate_identity");
  assert.match(cases[0].summary, /duplicateCount greaterThan 0/);
  const links = service.listCaseLinks({ principal: compliance, organizationId: ORG, caseId: cases[0].caseId });
  assert.ok(links.some((link) => link.entityType === "Investor" && link.entityId === "investor_duplicate_001"));

  const fraud = service.evaluateSignal({
    principal: compliance,
    organizationId: ORG,
    projectId: PROJECT,
    signalType: "Fraud Signal",
    payload: { confirmed: true, investorId: "investor_001" },
    correlationId: "corr_signal_fraud"
  });
  assert.equal(fraud.createdHoldIds.length, 1);
  assert.equal(service.isHeld({ organizationId: ORG, subjectType: "Investor", subjectId: "investor_001" }), true);

  const pattern = service.evaluateSignal({
    principal: compliance,
    organizationId: ORG,
    projectId: PROJECT,
    signalType: "Unusual Pattern",
    payload: { sameDayTransactionCount: 9 },
    correlationId: "corr_signal_pattern"
  });
  assert.equal(pattern.flags.length, 1);
  assert.equal(pattern.createdCaseIds.length, 0);
  assert.match(pattern.flags[0].explanation[0], /sameDayTransactionCount greaterThan 5/);

  const noMatch = service.evaluateSignal({
    principal: compliance,
    organizationId: ORG,
    projectId: PROJECT,
    signalType: "Unusual Pattern",
    payload: { sameDayTransactionCount: 1 },
    correlationId: "corr_signal_none"
  });
  assert.equal(noMatch.matchedRuleIds.length, 0);
});

test("rules are versioned, independently approved, and validated as data", () => {
  const { service, compliance, admin } = harness();

  assert.throws(() => service.draftRule({
    principal: compliance,
    organizationId: ORG,
    name: "Bad operator",
    source: "Payment",
    severity: "High",
    conditions: [{ field: "amount", operator: "explodes", value: 1 }],
    action: { type: "flag" },
    correlationId: "corr_bad_operator"
  }), /Unsupported rule operator/);

  assert.throws(() => service.draftRule({
    principal: compliance,
    organizationId: ORG,
    name: "Bad action",
    source: "Payment",
    severity: "High",
    conditions: [{ field: "amount", operator: "greaterThan", value: 1 }],
    action: { type: "delete-everything" },
    correlationId: "corr_bad_action"
  }), /Unsupported rule action/);

  const drafted = service.draftRule({
    principal: compliance,
    organizationId: ORG,
    name: "Large single payment",
    source: "Payment",
    severity: "High",
    conditions: [{ field: "amount", operator: "greaterThan", value: 1000000 }],
    action: { type: "open-case" },
    correlationId: "corr_rule_draft"
  });
  assert.equal(drafted.status, "Draft");

  const beforeApproval = service.evaluateSignal({
    principal: compliance,
    organizationId: ORG,
    signalType: "Payment",
    payload: { amount: 2000000 },
    correlationId: "corr_rule_unapproved"
  });
  assert.equal(beforeApproval.matchedRuleIds.length, 0);

  assert.throws(() => service.approveRule({
    principal: compliance,
    organizationId: ORG,
    ruleId: drafted.ruleId,
    correlationId: "corr_rule_self_approve"
  }), /not allowed to perform compliance-rule:approve/);

  const approved = service.approveRule({ principal: admin, organizationId: ORG, ruleId: drafted.ruleId, correlationId: "corr_rule_approve" });
  assert.equal(approved.status, "Approved");
  assert.equal(approved.syntheticApproval, false);

  const afterApproval = service.evaluateSignal({
    principal: compliance,
    organizationId: ORG,
    signalType: "Payment",
    payload: { amount: 2000000 },
    correlationId: "corr_rule_approved"
  });
  assert.deepEqual(afterApproval.matchedRuleIds, [drafted.ruleId]);

  service.suspendRule({ principal: admin, organizationId: ORG, ruleId: drafted.ruleId, reason: "False positive rate too high.", correlationId: "corr_rule_suspend" });
  const afterSuspension = service.evaluateSignal({
    principal: compliance,
    organizationId: ORG,
    signalType: "Payment",
    payload: { amount: 2000000 },
    correlationId: "corr_rule_suspended"
  });
  assert.equal(afterSuspension.matchedRuleIds.length, 0);
});

test("condition operators behave as documented", () => {
  const payload = { amount: 500, name: "Synthetic Investor", flagged: true, tier: "gold", empty: "" };
  assert.equal(evaluateCondition({ field: "amount", operator: "greaterThan", value: 100 }, payload), true);
  assert.equal(evaluateCondition({ field: "amount", operator: "lessThan", value: 100 }, payload), false);
  assert.equal(evaluateCondition({ field: "name", operator: "contains", value: "synthetic" }, payload), true);
  assert.equal(evaluateCondition({ field: "tier", operator: "in", value: ["gold", "silver"] }, payload), true);
  assert.equal(evaluateCondition({ field: "flagged", operator: "isTrue", value: true }, payload), true);
  assert.equal(evaluateCondition({ field: "empty", operator: "isPresent", value: null }, payload), false);
  assert.equal(evaluateCondition({ field: "missing", operator: "isPresent", value: null }, payload), false);
  assert.equal(evaluateCondition({ field: "amount", operator: "unknown", value: 1 }, payload), false);
});

test("an investor cannot read another complaint or manage the queue", () => {
  const { service, investor, compliance } = harness();
  const other = service.registerComplaint({
    principal: compliance,
    organizationId: ORG,
    projectId: PROJECT,
    category: "Service",
    severity: "Low",
    subject: "Internal note",
    description: "Raised internally.",
    correlationId: "corr_other"
  });

  assert.throws(() => service.getComplaint({
    principal: investor,
    organizationId: ORG,
    complaintId: other.complaintId
  }), /not allowed to perform complaint:manage/);

  assert.throws(() => service.listComplaints({
    principal: investor,
    organizationId: ORG,
    projectId: PROJECT
  }), /not allowed to perform complaint:manage/);
});

function harness({ clock = () => new Date("2026-08-21T09:00:00.000Z") } = {}) {
  const identity = createIdentityService();
  const investorService = createInvestorService({ identity });
  const service = createCaseService({ identity, investorService, clock });
  return {
    identity,
    investorService,
    service,
    investor: identity.authenticate("Bearer demo-token-investor-approved"),
    compliance: identity.authenticate("Bearer demo-token-compliance"),
    complianceSecond: identity.authenticate("Bearer demo-token-super-admin"),
    admin: identity.authenticate("Bearer demo-token-project-admin"),
    auditor: identity.authenticate("Bearer demo-token-auditor")
  };
}
