import { z } from 'zod';

/**
 * Configuration (M16).
 *
 * **The only place in `apps/api` that reads `process.env`.** Every variable is
 * validated at startup and a missing or malformed one fails the boot, naming
 * every problem at once — a misconfiguration discovered on first use is
 * discovered at a customer's door, by a Junior who cannot fix it.
 *
 * Every variable here is documented in `.env.example` at the repository root.
 */
const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

const configSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// connection URL'),
    BETTER_AUTH_SECRET: z
      .string()
      // Checked first and final: "too short" would be true but beside the point.
      .refine((value) => value !== 'CHANGEME', {
        message: 'is still the CHANGEME placeholder from .env.example',
        abort: true,
      })
      .min(16, 'must be at least 16 characters'),
    WEB_ORIGIN: z
      .url({ protocol: /^https?$/ })
      .refine(
        (value) => new URL(value).origin === value.replace(/\/$/, ''),
        'must be an origin — scheme, host and port only, with no path',
      ),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    /** Identifies the deployed build in `/health/info`. Optional in development. */
    BUILD_ID: z.string().min(1).optional(),
  })
  .superRefine((config, context) => {
    // security.md: generated with `openssl rand -base64 32`, 44 characters.
    if (
      config.NODE_ENV === 'production' &&
      config.BETTER_AUTH_SECRET.length < 32
    ) {
      context.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message: 'must be at least 32 characters in production',
      });
    }
  });

export type AppConfig = Readonly<z.infer<typeof configSchema>>;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Injection token for the validated configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export class ConfigValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Invalid configuration — ${problems.length} problem${problems.length === 1 ? '' : 's'}. ` +
        `Fix these in .env (see .env.example):\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validates an environment, reporting every problem together. Messages name
 * the variable and the rule, never the value — the value may be a secret.
 */
export function parseConfig(
  env: Record<string, string | undefined>,
): AppConfig {
  // An empty string is how a variable left blank in .env arrives; treat it as
  // absent so the message says "required" rather than something misleading.
  const present = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== ''),
  );
  const result = configSchema.safeParse(present);
  if (result.success) return Object.freeze(result.data);

  const problems = result.error.issues.map((issue) => {
    const name = issue.path.join('.') || '(root)';
    const missing = issue.path.length === 1 && present[name] === undefined;
    return `${name} ${missing ? 'is required' : issue.message}`;
  });
  throw new ConfigValidationError(problems);
}

let loaded: AppConfig | undefined;

/** The process configuration, validated once. Throws `ConfigValidationError`. */
export function loadConfig(): AppConfig {
  loaded ??= parseConfig(process.env);
  return loaded;
}
