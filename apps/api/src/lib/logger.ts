import pino from 'pino';
import { config } from '../config';

/**
 * Redaction is declared here rather than at each call site: it is the one
 * guarantee that a stray `log.info({ body })` can never print a password or a
 * bearer token (PRD 32 — "never log MT4/MT5 password or API secret").
 */
const REDACT_PATHS = [
  'password',
  'confirmPassword',
  'currentPassword',
  'token',
  'pairingCode',
  'investorPassword',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.token',
  '*.pairingCode',
  'body.password',
  'body.confirmPassword',
  'body.token',
  'body.pairingCode',
];

/**
 * Human-readable log formatting, when it is both wanted and available.
 *
 * `pino-pretty` is a development convenience and therefore a devDependency, so
 * it is absent from production images. Asking for it unconditionally makes the
 * *formatting* of logs able to stop the API from booting, which is an absurd
 * way to lose a trading system — so its presence is probed rather than assumed.
 *
 * This also covers the case where NODE_ENV is not set correctly on a hosting
 * platform: the worst outcome is JSON logs instead of coloured ones.
 */
function prettyTransport() {
  if (config.isProduction) return undefined;

  try {
    require.resolve('pino-pretty');
  } catch {
    return undefined;
  }

  return {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
  };
}

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  transport: prettyTransport(),
});
