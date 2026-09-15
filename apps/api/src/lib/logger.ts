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

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  transport: config.isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
      },
});
