export const REQUIRED_ENVIRONMENT_KEYS = Object.freeze([
  "NODE_ENV",
  "PORT",
  "DATABASE_URL",
  "REDIS_URL",
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_BUCKET"
]);

export const CALLBACK_TIMESTAMP_TOLERANCE_SECONDS = 300;

export const CALLBACK_SIGNATURE_ALGORITHM = "sha256";

export function readConfiguration(env = process.env) {
  const missing = REQUIRED_ENVIRONMENT_KEYS.filter((key) => !env[key]);
  return {
    missing,
    values: Object.fromEntries(REQUIRED_ENVIRONMENT_KEYS.map((key) => [key, env[key] ?? null]))
  };
}

/**
 * Payment provider callback verification settings.
 *
 * Secrets are read from the environment. When a provider secret is absent the provider loads in
 * synthetic mode with a clearly non-production placeholder so local foundation checks can exercise
 * signature, replay, and deduplication controls without real credentials. No provider in this
 * foundation is enabled for live money movement.
 */
export function readPaymentProviderRegistry(env = process.env) {
  const providers = [
    {
      providerId: "synthetic-bank-api",
      displayName: "Synthetic Bank API",
      channel: "Bank API",
      secretEnvKey: "SYNTHETIC_BANK_API_CALLBACK_SECRET"
    },
    {
      providerId: "synthetic-mfs",
      displayName: "Synthetic Mobile Financial Service",
      channel: "MFS",
      secretEnvKey: "SYNTHETIC_MFS_CALLBACK_SECRET"
    }
  ];

  return providers.map((provider) => {
    const configuredSecret = env[provider.secretEnvKey];
    return Object.freeze({
      providerId: provider.providerId,
      displayName: provider.displayName,
      channel: provider.channel,
      signatureAlgorithm: CALLBACK_SIGNATURE_ALGORITHM,
      timestampToleranceSeconds: CALLBACK_TIMESTAMP_TOLERANCE_SECONDS,
      secret: configuredSecret ?? `synthetic-local-secret.${provider.providerId}.not-for-production`,
      syntheticSecret: !configuredSecret,
      liveMoneyMovementEnabled: false
    });
  });
}
