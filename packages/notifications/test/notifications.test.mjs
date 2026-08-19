import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdentityService } from "../../identity/src/index.js";
import {
  createNotificationService,
  createRecordingTransport,
  extractPlaceholders,
  maskAddress
} from "../src/index.js";

const ORG = "org_demo";

test("queued notifications render an approved template and mask the recipient address", () => {
  const { service, admin } = harness();

  const notification = service.queueNotification({
    principal: admin,
    organizationId: ORG,
    templateKey: "payment.cleared",
    channel: "Email",
    recipientUserId: "user_investor_approved_001",
    recipientAddress: "approved-investor@example.test",
    data: { amount: "50000.0000", currency: "BDT", paymentReference: "CF360-REF-1" },
    correlationId: "corr_queue"
  });

  assert.equal(notification.status, "Queued");
  assert.equal(notification.locale, "en");
  assert.equal(notification.subject, "Payment received");
  assert.equal(notification.body, "We received 50000.0000 BDT against reference CF360-REF-1.");
  assert.equal(notification.recipientAddressMasked, "a***@example.test");
  assert.ok(!JSON.stringify(notification).includes("approved-investor@example.test"));
});

test("missing template data and unknown channels are refused", () => {
  const { service, admin } = harness();

  assert.throws(() => service.queueNotification({
    principal: admin,
    organizationId: ORG,
    templateKey: "payment.cleared",
    channel: "Email",
    recipientUserId: "user_investor_001",
    recipientAddress: "investor1@example.test",
    data: { amount: "1000.0000" },
    correlationId: "corr_missing_data"
  }), /missing: currency, paymentReference/);

  assert.throws(() => service.queueNotification({
    principal: admin,
    organizationId: ORG,
    templateKey: "payment.cleared",
    channel: "Telegram",
    recipientUserId: "user_investor_001",
    recipientAddress: "x",
    data: {},
    correlationId: "corr_bad_channel"
  }), /Unsupported notification channel/);

  assert.throws(() => service.queueNotification({
    principal: admin,
    organizationId: ORG,
    templateKey: "unknown.key",
    channel: "Email",
    recipientUserId: "user_investor_001",
    recipientAddress: "x@example.test",
    data: {},
    correlationId: "corr_unknown_template"
  }), /No approved Email template/);
});

test("recipient locale selects the Bangla template and falls back to English", () => {
  const { service, admin } = harness();

  service.updatePreferences({
    principal: admin,
    organizationId: ORG,
    userId: "user_investor_001",
    locale: "bn",
    correlationId: "corr_locale"
  });

  const bangla = service.queueNotification({
    principal: admin,
    organizationId: ORG,
    templateKey: "kyc.approved",
    channel: "Email",
    recipientUserId: "user_investor_001",
    recipientAddress: "investor1@example.test",
    data: { investorName: "Synthetic Investor One" },
    correlationId: "corr_bn"
  });
  assert.equal(bangla.locale, "bn");
  assert.equal(bangla.localeFallbackApplied, false);
  assert.match(bangla.body, /অনুমোদিত হয়েছে/);

  const drafted = service.draftTemplate({
    principal: admin,
    organizationId: ORG,
    templateKey: "custom.notice",
    channel: "Email",
    locale: "en",
    subject: "Notice for {{projectTitle}}",
    body: "Project {{projectTitle}} has a notice.",
    correlationId: "corr_draft"
  });
  service.approveTemplate({
    principal: admin.secondApprover,
    organizationId: ORG,
    templateId: drafted.templateId,
    correlationId: "corr_approve"
  });

  const fallback = service.queueNotification({
    principal: admin,
    organizationId: ORG,
    templateKey: "custom.notice",
    channel: "Email",
    recipientUserId: "user_investor_001",
    recipientAddress: "investor1@example.test",
    data: { projectTitle: "Synthetic Agro" },
    correlationId: "corr_fallback"
  });
  assert.equal(fallback.locale, "en");
  assert.equal(fallback.localeFallbackApplied, true);
});

test("template approval requires an independent approver and supersedes the prior version", () => {
  const { service, admin, superAdmin } = harness();

  const drafted = service.draftTemplate({
    principal: admin,
    organizationId: ORG,
    templateKey: "kyc.approved",
    channel: "Email",
    locale: "en",
    subject: "Verification complete",
    body: "Hello {{investorName}}, verification is complete.",
    correlationId: "corr_draft_v2"
  });
  assert.equal(drafted.status, "Draft");
  assert.equal(drafted.placeholders.length, 1);

  assert.throws(() => service.draftTemplate({
    principal: admin,
    organizationId: ORG,
    templateKey: "kyc.approved",
    channel: "Email",
    locale: "en",
    subject: "Another",
    body: "Another {{investorName}}",
    correlationId: "corr_draft_dupe"
  }), /draft already exists/);

  assert.throws(() => service.approveTemplate({
    principal: admin,
    organizationId: ORG,
    templateId: drafted.templateId,
    correlationId: "corr_self_approve"
  }), /requires independent approval/);

  const approved = service.approveTemplate({
    principal: superAdmin,
    organizationId: ORG,
    templateId: drafted.templateId,
    correlationId: "corr_approve_v2"
  });
  assert.equal(approved.status, "Approved");

  const templates = service.listTemplates({ principal: admin, organizationId: ORG });
  const superseded = templates.filter((template) => (
    template.templateKey === "kyc.approved" &&
    template.channel === "Email" &&
    template.locale === "en" &&
    template.status === "Superseded"
  ));
  assert.equal(superseded.length, 1);
});

test("opted-out channels suppress delivery without discarding the record", () => {
  const { service, admin } = harness();

  service.updatePreferences({
    principal: admin,
    organizationId: ORG,
    userId: "user_investor_001",
    channels: { Email: false },
    correlationId: "corr_optout"
  });

  const notification = service.queueNotification({
    principal: admin,
    organizationId: ORG,
    templateKey: "kyc.approved",
    channel: "Email",
    recipientUserId: "user_investor_001",
    recipientAddress: "investor1@example.test",
    data: { investorName: "Synthetic Investor One" },
    correlationId: "corr_suppressed"
  });
  assert.equal(notification.status, "Suppressed");
  assert.match(notification.suppressionReason, /opted out of Email/);

  const run = service.processDeliveryQueue({ principal: admin, organizationId: ORG, correlationId: "corr_process" });
  assert.equal(run.processed, 0);
});

test("deduplication keys prevent a duplicate notification", () => {
  const { service, admin } = harness();
  const payload = {
    principal: admin,
    organizationId: ORG,
    templateKey: "kyc.approved",
    channel: "In-App",
    recipientUserId: "user_investor_001",
    recipientAddress: null,
    data: { investorName: "Synthetic Investor One" },
    dedupeKey: "kyc-approved:investor_001",
    correlationId: "corr_dedupe"
  };

  const first = service.queueNotification(payload);
  const second = service.queueNotification(payload);
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(second.notificationId, first.notificationId);
  assert.equal(service.listNotifications({ principal: admin, organizationId: ORG }).length, 1);
});

test("failed deliveries retry with backoff and stop after the attempt limit", () => {
  const outcomes = new Map();
  const transport = createRecordingTransport(outcomes);
  const { service, admin } = harness({ transport });

  const notification = service.queueNotification({
    principal: admin,
    organizationId: ORG,
    templateKey: "kyc.approved",
    channel: "Email",
    recipientUserId: "user_investor_001",
    recipientAddress: "investor1@example.test",
    data: { investorName: "Synthetic Investor One" },
    correlationId: "corr_retry"
  });
  outcomes.set(notification.notificationId, { delivered: false, reason: "provider_unavailable" });

  const first = service.processDeliveryQueue({ principal: admin, organizationId: ORG, now: "2026-08-20T10:00:00.000Z", correlationId: "corr_run_1" });
  assert.equal(first.retrying, 1);
  assert.equal(first.notifications[0].attempts, 1);
  assert.equal(first.notifications[0].nextAttemptAt, "2026-08-20T10:01:00.000Z");

  const tooEarly = service.processDeliveryQueue({ principal: admin, organizationId: ORG, now: "2026-08-20T10:00:30.000Z", correlationId: "corr_run_early" });
  assert.equal(tooEarly.processed, 0);

  service.processDeliveryQueue({ principal: admin, organizationId: ORG, now: "2026-08-20T10:01:00.000Z", correlationId: "corr_run_2" });
  const third = service.processDeliveryQueue({ principal: admin, organizationId: ORG, now: "2026-08-20T10:10:00.000Z", correlationId: "corr_run_3" });
  assert.equal(third.failed, 1);
  assert.equal(third.notifications[0].status, "Failed");
  assert.equal(third.notifications[0].attempts, 3);

  const exhausted = service.processDeliveryQueue({ principal: admin, organizationId: ORG, now: "2026-08-20T11:00:00.000Z", correlationId: "corr_run_4" });
  assert.equal(exhausted.processed, 0);

  const attempts = service.listDeliveryAttempts({ principal: admin, organizationId: ORG, notificationId: notification.notificationId });
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts.map((attempt) => attempt.outcome), ["Retrying", "Retrying", "Failed"]);
  assert.ok(attempts.every((attempt) => attempt.failureReason === "provider_unavailable"));
});

test("a recovering provider delivers on retry", () => {
  const outcomes = new Map();
  const transport = createRecordingTransport(outcomes);
  const { service, admin } = harness({ transport });

  const notification = service.queueNotification({
    principal: admin,
    organizationId: ORG,
    templateKey: "distribution.paid",
    channel: "Email",
    recipientUserId: "user_investor_approved_001",
    recipientAddress: "approved-investor@example.test",
    data: { amount: "1000.0000", currency: "BDT", projectTitle: "Synthetic Agro" },
    correlationId: "corr_recover"
  });
  outcomes.set(`${notification.notificationId}:1`, { delivered: false, reason: "timeout" });

  service.processDeliveryQueue({ principal: admin, organizationId: ORG, now: "2026-08-20T10:00:00.000Z", correlationId: "corr_recover_1" });
  const second = service.processDeliveryQueue({ principal: admin, organizationId: ORG, now: "2026-08-20T10:02:00.000Z", correlationId: "corr_recover_2" });

  assert.equal(second.delivered, 1);
  assert.equal(second.notifications[0].status, "Delivered");
  assert.equal(second.notifications[0].failureReason, null);
  assert.equal(transport.sent.length, 2);
});

test("placeholder extraction and address masking behave predictably", () => {
  assert.deepEqual(extractPlaceholders("Hello {{name}}, your {{name}} and {{amount}}"), ["name", "amount"]);
  assert.equal(maskAddress("investor1@example.test", "Email"), "i***@example.test");
  assert.equal(maskAddress("+8801700000001", "SMS"), "***0001");
  assert.equal(maskAddress(null, "SMS"), null);
});

function harness({ transport } = {}) {
  const identity = createIdentityService();
  const service = createNotificationService({
    identity,
    transport: transport ?? createRecordingTransport(),
    clock: () => new Date("2026-08-20T10:00:00.000Z")
  });
  const admin = identity.authenticate("Bearer demo-token-project-admin");
  const superAdmin = identity.authenticate("Bearer demo-token-super-admin");
  admin.secondApprover = superAdmin;
  return { identity, service, admin, superAdmin };
}
