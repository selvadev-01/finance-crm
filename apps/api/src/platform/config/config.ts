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
    /**
     * ADR-0003: this process also consumes jobs and runs the schedules (M14).
     * Read once, in `JobsModule`. Off by default, so the API and the test
     * suites never start a queue.
     */
    WORKER_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    /** M14 schedules, cron expressions evaluated in Asia/Kolkata. */
    JOBS_RECONCILE_CRON: z.string().min(9).default('0 1 * * *'),
    JOBS_OVERDUE_CRON: z.string().min(9).default('30 0 * * *'),
    JOBS_PURGE_KEYS_CRON: z.string().min(9).default('0 2 * * *'),
    /**
     * notifications.md: which push providers deliver. `NONE` (the development
     * default) still writes every in-app notification.
     */
    PUSH_PROVIDER: z.enum(['WEB_PUSH', 'FCM', 'BOTH', 'NONE']).default('NONE'),
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    VAPID_SUBJECT: z
      .string()
      .regex(/^(mailto:|https:\/\/)/, 'must be a mailto: or https:// URL')
      .optional(),
    FCM_PROJECT_ID: z.string().min(1).optional(),
    FCM_CLIENT_EMAIL: z.string().min(1).optional(),
    FCM_PRIVATE_KEY: z.string().min(1).optional(),
    /**
     * notifications.md#email: `SMTP` sends email through the server below;
     * `NONE` (the default) queues nothing, so development and the test suites
     * never send mail.
     */
    EMAIL_PROVIDER: z.enum(['SMTP', 'NONE']).default('NONE'),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    /** `true` for implicit TLS (465); `false` upgrades with STARTTLS (587). */
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    /** The sender, `Rasi <no-reply@example.com>` or a bare address. */
    EMAIL_FROM: z
      .string()
      .regex(
        /^(?:[^<>]+<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/,
        'must be an address, or a name and <address>',
      )
      .optional(),
  })
  .superRefine((config, context) => {
    const needs = (
      provider: 'WEB_PUSH' | 'FCM',
      keys: (keyof typeof config)[],
    ) => {
      if (config.PUSH_PROVIDER !== provider && config.PUSH_PROVIDER !== 'BOTH')
        return;
      for (const key of keys) {
        if (config[key] === undefined) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: `is required when PUSH_PROVIDER is ${config.PUSH_PROVIDER}`,
          });
        }
      }
    };
    needs('WEB_PUSH', [
      'VAPID_PUBLIC_KEY',
      'VAPID_PRIVATE_KEY',
      'VAPID_SUBJECT',
    ]);
    needs('FCM', ['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY']);
    if (config.EMAIL_PROVIDER === 'SMTP') {
      for (const key of ['SMTP_HOST', 'EMAIL_FROM'] as const) {
        if (config[key] === undefined) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: 'is required when EMAIL_PROVIDER is SMTP',
          });
        }
      }
    }
    // A login is a user and a password together; half of one is a typo.
    if ((config.SMTP_USER === undefined) !== (config.SMTP_PASS === undefined)) {
      context.addIssue({
        code: 'custom',
        path: [config.SMTP_USER === undefined ? 'SMTP_USER' : 'SMTP_PASS'],
        message: 'is required when the other SMTP login value is set',
      });
    }
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
