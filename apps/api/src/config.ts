import { z } from 'zod';

/**
 * Environment is parsed once, at boot, and the process refuses to start if
 * anything required is missing or malformed. A trading system that starts with
 * a half-configured encryption key is worse than one that does not start.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().optional(),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),

  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z
    .string()
    .refine(
      (v) => tryDecodeKey(v) === 32,
      'ENCRYPTION_KEY must be exactly 32 bytes, base64 encoded',
    ),
  ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('TradeOS <no-reply@tradeos.local>'),

  MAX_FOLLOWER_ACCOUNTS: z.coerce.number().int().min(0).max(1000).default(10),
  MAX_MASTER_ACCOUNTS: z.coerce.number().int().min(1).max(100).default(1),

  AGENT_HEARTBEAT_TIMEOUT_SECONDS: z.coerce.number().int().min(5).default(30),
  AGENT_POLL_INTERVAL_MS: z.coerce.number().int().min(200).max(60000).default(1000),
  COPY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  COPY_TASK_TTL_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

function tryDecodeKey(value: string): number {
  try {
    return Buffer.from(value, 'base64').length;
  } catch {
    return -1;
  }
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // Printed rather than thrown so the operator sees every problem at once,
  // not just the first one.
  console.error(`\nTradeOS API cannot start — invalid environment configuration:\n${issues}\n`);

  // The remedy differs by where this is running, and telling a Railway or
  // Render operator to "copy .env.example to .env" sends them looking for a
  // file that does not exist on the platform.
  const hosted =
    process.env.RAILWAY_ENVIRONMENT ??
    process.env.RENDER ??
    process.env.FLY_APP_NAME ??
    process.env.VERCEL ??
    process.env.KUBERNETES_SERVICE_HOST;

  if (hosted) {
    console.error(
      'Set these in your hosting platform\'s environment variables, then redeploy.\n' +
        'On Railway: the service\'s Variables tab (the Raw Editor accepts KEY=VALUE lines).\n' +
        'On Render: the service\'s Environment tab.\n' +
        'Generate the secrets with:\n' +
        "  SESSION_SECRET  node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"\n" +
        "  ENCRYPTION_KEY  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"\n" +
        'Full list: docs/DEPLOYMENT.md\n',
    );
  } else {
    console.error('Copy .env.example to .env and fill in the missing values.\n');
  }

  process.exit(1);
}

/** True when a well-known hosting platform's marker variable is present. */
export const isHostedPlatform = Boolean(
  process.env.RAILWAY_ENVIRONMENT ??
    process.env.RENDER ??
    process.env.FLY_APP_NAME ??
    process.env.KUBERNETES_SERVICE_HOST,
);

// Running a deployed service in development mode is almost always an unset
// variable rather than a decision: it leaves cookies without the Secure flag
// and turns on verbose per-request logging. Say so loudly rather than letting
// it pass silently.
if (isHostedPlatform && parsed.data.NODE_ENV !== 'production') {
  console.warn(
    `\n[warning] NODE_ENV is "${parsed.data.NODE_ENV}" on a hosted platform.\n` +
      '          Session cookies will not be marked Secure and request logging\n' +
      '          will be verbose. Set NODE_ENV=production and redeploy.\n',
  );
}

/**
 * True when running as a serverless function rather than a long-lived server.
 *
 * Three things have to change in that mode: no WebSocket server (there is no
 * process to hold the socket), no interval-based heartbeat supervisor (no timer
 * survives between invocations), and staleness is swept opportunistically on
 * incoming requests instead.
 */
export const isServerless = Boolean(process.env.VERCEL ?? process.env.AWS_LAMBDA_FUNCTION_NAME);

export const config = {
  ...parsed.data,
  isServerless,
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  /** Total accounts a single user may connect (PRD 38). */
  get maxAccounts() {
    return parsed.data.MAX_MASTER_ACCOUNTS + parsed.data.MAX_FOLLOWER_ACCOUNTS;
  },
};

export type Config = typeof config;
