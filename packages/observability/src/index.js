export function createCorrelationContext(headers = {}) {
  return {
    correlationId: headers["x-correlation-id"] ?? cryptoRandomId(),
    actorUserId: headers["x-actor-user-id"] ?? null,
    organizationId: headers["x-organization-id"] ?? null,
    projectId: headers["x-project-id"] ?? null
  };
}

function cryptoRandomId() {
  return `corr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
