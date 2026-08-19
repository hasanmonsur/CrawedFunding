import {
  DEFAULT_LOCALE,
  NOTIFICATION_CHANNELS,
  PERMISSIONS,
  SUPPORTED_LOCALES,
  assertFourEyes,
  buildAuditEvent,
  canTransition
} from "../../domain-contracts/src/index.js";

const MAX_ATTEMPTS = 3;
const BACKOFF_SECONDS = Object.freeze([60, 300, 900]);

export function createNotificationService({
  identity,
  templates = createDefaultTemplates(),
  preferences = createDefaultPreferences(),
  notifications = [],
  deliveryAttempts = [],
  clock = () => new Date(),
  transport = createRecordingTransport(),
  auditEvents = []
}) {
  return {
    listTemplates,
    draftTemplate,
    approveTemplate,
    getPreferences,
    updatePreferences,
    queueNotification,
    processDeliveryQueue,
    listNotifications,
    listDeliveryAttempts,
    cancelNotification,
    getAuditEvents: () => auditEvents.slice()
  };

  function listTemplates({ principal, organizationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.notificationManage, organizationId });
    return templates.map(cloneTemplate);
  }

  function draftTemplate({ principal, organizationId, templateKey, channel, locale, subject, body, category, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.notificationManage, organizationId });
    assertChannel(channel);
    assertLocale(locale);
    if (!templateKey || !body) {
      throw problem(400, "template_details_required", "A notification template requires a key and a body.");
    }
    if (channel === NOTIFICATION_CHANNELS.email && !subject) {
      throw problem(400, "template_subject_required", "Email templates require a subject.");
    }
    const siblings = templates.filter((candidate) => (
      candidate.templateKey === templateKey && candidate.channel === channel && candidate.locale === locale
    ));
    if (siblings.some((candidate) => candidate.status === "Draft")) {
      throw problem(409, "template_draft_exists", "A draft already exists for this template, channel, and locale.");
    }
    const template = {
      templateId: `notification_template_${templates.length + 1}`,
      organizationId,
      templateKey,
      channel,
      locale,
      category: category ?? "operational",
      subject: subject ?? null,
      body,
      version: siblings.length + 1,
      status: "Draft",
      draftedByUserId: principal.user.userId,
      approvedByUserId: null,
      placeholders: extractPlaceholders(`${subject ?? ""} ${body}`)
    };
    templates.push(template);
    audit({ principal, organizationId, action: "notification.template.draft", entityType: "NotificationTemplate", entityId: template.templateId, correlationId });
    return cloneTemplate(template);
  }

  function approveTemplate({ principal, organizationId, templateId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.notificationApprove, organizationId });
    const template = templates.find((candidate) => candidate.templateId === templateId);
    if (!template) {
      throw problem(404, "template_not_found", "Notification template not found.");
    }
    assertFourEyes({
      creatorUserId: template.draftedByUserId,
      approverUserId: principal.user.userId,
      action: "Notification template approval"
    });
    if (!canTransition("notificationTemplate", template.status, "Approved")) {
      throw problem(409, "invalid_template_transition", `Template cannot transition from ${template.status} to Approved.`);
    }
    for (const candidate of templates) {
      if (
        candidate !== template &&
        candidate.templateKey === template.templateKey &&
        candidate.channel === template.channel &&
        candidate.locale === template.locale &&
        candidate.status === "Approved"
      ) {
        candidate.status = "Superseded";
      }
    }
    template.status = "Approved";
    template.approvedByUserId = principal.user.userId;
    audit({ principal, organizationId, action: "notification.template.approve", entityType: "NotificationTemplate", entityId: templateId, correlationId });
    return cloneTemplate(template);
  }

  function getPreferences({ principal, organizationId, userId }) {
    const targetUserId = userId ?? principal.user.userId;
    if (targetUserId !== principal.user.userId) {
      identity.requirePermission({ principal, permission: PERMISSIONS.notificationManage, organizationId });
    }
    return { ...resolvePreferences({ organizationId, userId: targetUserId }) };
  }

  function updatePreferences({ principal, organizationId, userId, channels, locale, correlationId }) {
    const targetUserId = userId ?? principal.user.userId;
    if (targetUserId !== principal.user.userId) {
      identity.requirePermission({ principal, permission: PERMISSIONS.notificationManage, organizationId });
    }
    if (locale) {
      assertLocale(locale);
    }
    const current = resolvePreferences({ organizationId, userId: targetUserId });
    for (const channel of Object.keys(channels ?? {})) {
      assertChannel(channel);
    }
    const updated = {
      ...current,
      locale: locale ?? current.locale,
      channels: { ...current.channels, ...(channels ?? {}) }
    };
    const index = preferences.findIndex((candidate) => (
      candidate.organizationId === organizationId && candidate.userId === targetUserId
    ));
    if (index >= 0) {
      preferences[index] = updated;
    } else {
      preferences.push(updated);
    }
    audit({ principal, organizationId, action: "notification.preferences.update", entityType: "NotificationPreference", entityId: targetUserId, correlationId });
    return { ...updated };
  }

  function queueNotification({
    principal,
    organizationId,
    projectId,
    templateKey,
    channel,
    recipientUserId,
    recipientAddress,
    data = {},
    dedupeKey,
    correlationId
  }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.notificationManage, organizationId, projectId });
    assertChannel(channel);
    const recipientPreferences = resolvePreferences({ organizationId, userId: recipientUserId });
    const resolved = resolveTemplate({ organizationId, templateKey, channel, locale: recipientPreferences.locale });

    if (dedupeKey) {
      const existing = notifications.find((candidate) => (
        candidate.organizationId === organizationId && candidate.dedupeKey === dedupeKey
      ));
      if (existing) {
        return { ...existing, deduplicated: true };
      }
    }

    const rendered = renderTemplate({ template: resolved.template, data });
    const suppressed = recipientPreferences.channels[channel] === false;
    const notification = {
      notificationId: `notification_${notifications.length + 1}`,
      organizationId,
      projectId: projectId ?? null,
      templateKey,
      templateId: resolved.template.templateId,
      channel,
      locale: resolved.template.locale,
      localeFallbackApplied: resolved.fallbackApplied,
      category: resolved.template.category,
      recipientUserId,
      // Delivery addresses are personal data. Only a masked form is retained on the record.
      recipientAddressMasked: maskAddress(recipientAddress, channel),
      subject: rendered.subject,
      body: rendered.body,
      dedupeKey: dedupeKey ?? null,
      status: suppressed ? "Suppressed" : "Queued",
      suppressionReason: suppressed ? `Recipient opted out of ${channel} notifications.` : null,
      attempts: 0,
      nextAttemptAt: suppressed ? null : clock().toISOString(),
      queuedByUserId: principal.user.userId,
      queuedAt: clock().toISOString(),
      deliveredAt: null,
      failureReason: null
    };
    notifications.push(notification);
    audit({
      principal,
      organizationId,
      projectId,
      action: suppressed ? "notification.suppress" : "notification.queue",
      entityType: "Notification",
      entityId: notification.notificationId,
      correlationId
    });
    return { ...notification, deduplicated: false };
  }

  function processDeliveryQueue({ principal, organizationId, now, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.notificationManage, organizationId });
    const at = now ? new Date(now) : clock();
    const processed = [];
    for (const notification of notifications) {
      if (notification.organizationId !== organizationId) {
        continue;
      }
      if (!["Queued", "Retrying"].includes(notification.status)) {
        continue;
      }
      if (notification.nextAttemptAt && new Date(notification.nextAttemptAt) > at) {
        continue;
      }
      processed.push(attemptDelivery({ notification, at, correlationId }));
    }
    return {
      organizationId,
      processedAt: at.toISOString(),
      processed: processed.length,
      delivered: processed.filter((entry) => entry.status === "Delivered").length,
      retrying: processed.filter((entry) => entry.status === "Retrying").length,
      failed: processed.filter((entry) => entry.status === "Failed").length,
      notifications: processed
    };
  }

  function attemptDelivery({ notification, at, correlationId }) {
    transitionNotification({ notification, to: "Sending" });
    notification.attempts += 1;
    let outcome;
    let failureReason = null;
    try {
      outcome = transport.send({
        channel: notification.channel,
        notificationId: notification.notificationId,
        subject: notification.subject,
        body: notification.body,
        attempt: notification.attempts
      });
    } catch (error) {
      outcome = { delivered: false, reason: error.message };
    }
    if (outcome?.delivered) {
      transitionNotification({ notification, to: "Delivered" });
      notification.deliveredAt = at.toISOString();
      notification.nextAttemptAt = null;
      notification.failureReason = null;
    } else {
      failureReason = outcome?.reason ?? "transport_rejected";
      if (notification.attempts >= MAX_ATTEMPTS) {
        transitionNotification({ notification, to: "Failed" });
        notification.nextAttemptAt = null;
      } else {
        transitionNotification({ notification, to: "Retrying" });
        const backoff = BACKOFF_SECONDS[Math.min(notification.attempts - 1, BACKOFF_SECONDS.length - 1)];
        notification.nextAttemptAt = new Date(at.getTime() + backoff * 1000).toISOString();
      }
      notification.failureReason = failureReason;
    }
    deliveryAttempts.push({
      deliveryAttemptId: `delivery_attempt_${deliveryAttempts.length + 1}`,
      organizationId: notification.organizationId,
      notificationId: notification.notificationId,
      attempt: notification.attempts,
      channel: notification.channel,
      outcome: notification.status,
      failureReason,
      nextAttemptAt: notification.nextAttemptAt,
      correlationId: correlationId ?? null,
      occurredAt: at.toISOString()
    });
    return { ...notification };
  }

  function cancelNotification({ principal, organizationId, notificationId, reason, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.notificationManage, organizationId });
    const notification = notifications.find((candidate) => (
      candidate.organizationId === organizationId && candidate.notificationId === notificationId
    ));
    if (!notification) {
      throw problem(404, "notification_not_found", "Notification not found.");
    }
    if (!reason) {
      throw problem(400, "notification_cancel_reason_required", "Cancelling a notification requires a documented reason.");
    }
    transitionNotification({ notification, to: "Cancelled" });
    notification.failureReason = reason;
    audit({ principal, organizationId, action: "notification.cancel", entityType: "Notification", entityId: notificationId, reason, correlationId });
    return { ...notification };
  }

  function listNotifications({ principal, organizationId, projectId, status }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.notificationManage, organizationId, projectId });
    return notifications
      .filter((notification) => notification.organizationId === organizationId)
      .filter((notification) => !projectId || notification.projectId === projectId)
      .filter((notification) => !status || notification.status === status)
      .map((notification) => ({ ...notification }));
  }

  function listDeliveryAttempts({ principal, organizationId, notificationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.notificationManage, organizationId });
    return deliveryAttempts
      .filter((attempt) => attempt.organizationId === organizationId)
      .filter((attempt) => !notificationId || attempt.notificationId === notificationId)
      .map((attempt) => ({ ...attempt }));
  }

  /**
   * Locale resolution prefers the recipient's locale and falls back to the default locale.
   * A missing approved template is an error rather than a silent no-send.
   */
  function resolveTemplate({ organizationId, templateKey, channel, locale }) {
    const approved = templates.filter((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.templateKey === templateKey &&
      candidate.channel === channel &&
      candidate.status === "Approved"
    ));
    const preferred = approved.find((candidate) => candidate.locale === locale);
    if (preferred) {
      return { template: preferred, fallbackApplied: false };
    }
    const fallback = approved.find((candidate) => candidate.locale === DEFAULT_LOCALE);
    if (fallback) {
      return { template: fallback, fallbackApplied: true };
    }
    throw problem(404, "notification_template_not_approved", `No approved ${channel} template for ${templateKey}.`);
  }

  function resolvePreferences({ organizationId, userId }) {
    return preferences.find((candidate) => (
      candidate.organizationId === organizationId && candidate.userId === userId
    )) ?? {
      organizationId,
      userId,
      locale: DEFAULT_LOCALE,
      channels: {
        [NOTIFICATION_CHANNELS.email]: true,
        [NOTIFICATION_CHANNELS.sms]: true,
        [NOTIFICATION_CHANNELS.push]: true,
        [NOTIFICATION_CHANNELS.inApp]: true
      }
    };
  }

  function transitionNotification({ notification, to }) {
    if (!canTransition("notificationDelivery", notification.status, to)) {
      throw problem(409, "invalid_notification_transition", `Notification cannot transition from ${notification.status} to ${to}.`);
    }
    notification.status = to;
  }

  function audit({ principal, organizationId, projectId, action, entityType, entityId, reason, correlationId }) {
    auditEvents.push(buildAuditEvent({
      organizationId,
      projectId: projectId ?? undefined,
      actorUserId: principal.user.userId,
      action,
      entityType,
      entityId,
      reason,
      correlationId
    }));
  }
}

export function renderTemplate({ template, data }) {
  const missing = template.placeholders.filter((placeholder) => data[placeholder] === undefined);
  if (missing.length > 0) {
    throw problem(400, "notification_placeholder_missing", `Notification data is missing: ${missing.join(", ")}.`);
  }
  return {
    subject: template.subject ? substitute(template.subject, data) : null,
    body: substitute(template.body, data)
  };
}

export function extractPlaceholders(text) {
  return [...new Set([...String(text).matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((match) => match[1]))];
}

export function maskAddress(address, channel) {
  const normalized = String(address ?? "");
  if (!normalized) {
    return null;
  }
  if (channel === NOTIFICATION_CHANNELS.email && normalized.includes("@")) {
    const [local, domain] = normalized.split("@");
    return `${local.slice(0, 1)}***@${domain}`;
  }
  return `***${normalized.slice(-4)}`;
}

export function createRecordingTransport(outcomes = new Map()) {
  const sent = [];
  return {
    sent,
    send(message) {
      sent.push(message);
      const planned = outcomes.get(`${message.notificationId}:${message.attempt}`) ?? outcomes.get(message.notificationId);
      if (planned) {
        return planned;
      }
      return { delivered: true };
    }
  };
}

export function createDefaultPreferences() {
  return [];
}

export function createDefaultTemplates() {
  const seed = [
    {
      templateKey: "kyc.approved",
      category: "compliance",
      subject: { en: "Your verification is approved", bn: "আপনার যাচাই অনুমোদিত হয়েছে" },
      body: {
        en: "Hello {{investorName}}, your verification is approved. You can now review published projects.",
        bn: "প্রিয় {{investorName}}, আপনার যাচাই অনুমোদিত হয়েছে। আপনি এখন প্রকাশিত প্রকল্প দেখতে পারেন।"
      }
    },
    {
      templateKey: "payment.cleared",
      category: "payments",
      subject: { en: "Payment received", bn: "পেমেন্ট গৃহীত হয়েছে" },
      body: {
        en: "We received {{amount}} {{currency}} against reference {{paymentReference}}.",
        bn: "আমরা {{paymentReference}} রেফারেন্সের বিপরীতে {{amount}} {{currency}} পেয়েছি।"
      }
    },
    {
      templateKey: "distribution.paid",
      category: "distributions",
      subject: { en: "Distribution paid", bn: "বিতরণ পরিশোধ করা হয়েছে" },
      body: {
        en: "A distribution of {{amount}} {{currency}} for {{projectTitle}} has been paid.",
        bn: "{{projectTitle}} প্রকল্পের জন্য {{amount}} {{currency}} বিতরণ পরিশোধ করা হয়েছে।"
      }
    },
    {
      templateKey: "milestone.delayed",
      category: "operations",
      subject: { en: "Milestone delayed", bn: "মাইলস্টোন বিলম্বিত" },
      body: {
        en: "Milestone {{milestoneTitle}} on {{projectTitle}} is delayed. A project update will follow.",
        bn: "{{projectTitle}} প্রকল্পের {{milestoneTitle}} মাইলস্টোন বিলম্বিত। শীঘ্রই একটি হালনাগাদ আসবে।"
      }
    }
  ];

  const templates = [];
  for (const entry of seed) {
    for (const locale of SUPPORTED_LOCALES) {
      for (const channel of [NOTIFICATION_CHANNELS.email, NOTIFICATION_CHANNELS.inApp]) {
        const subject = channel === NOTIFICATION_CHANNELS.email ? entry.subject[locale] : null;
        const body = entry.body[locale];
        templates.push({
          templateId: `notification_template_seed_${templates.length + 1}`,
          organizationId: "org_demo",
          templateKey: entry.templateKey,
          channel,
          locale,
          category: entry.category,
          subject,
          body,
          version: 1,
          status: "Approved",
          syntheticApproval: true,
          draftedByUserId: "system:seed",
          approvedByUserId: "system:seed",
          placeholders: extractPlaceholders(`${subject ?? ""} ${body}`)
        });
      }
    }
  }
  return templates;
}

function cloneTemplate(template) {
  return { ...template, placeholders: [...template.placeholders] };
}

function substitute(text, data) {
  return String(text).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => String(data[key]));
}

function assertChannel(channel) {
  if (!Object.values(NOTIFICATION_CHANNELS).includes(channel)) {
    throw problem(400, "notification_channel_invalid", `Unsupported notification channel: ${channel}.`);
  }
}

function assertLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    throw problem(400, "notification_locale_invalid", `Unsupported locale: ${locale}.`);
  }
}

function problem(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
