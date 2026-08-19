export function requiredString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required.`);
  }
  return value.trim();
}

export function requiredUuidLike(value, fieldName) {
  requiredString(value, fieldName);
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(value)) {
    throw new Error(`${fieldName} must be a stable identifier.`);
  }
  return value;
}
