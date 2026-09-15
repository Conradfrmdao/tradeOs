import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { config } from '../config';

/**
 * Every deliberate failure is an AppError carrying a stable machine code, so
 * the frontend can branch on `error.code` rather than string-matching prose.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly expose: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    opts: { fields?: Record<string, string>; expose?: boolean } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.fields = opts.fields;
    this.expose = opts.expose ?? true;
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'BAD_REQUEST', message, { fields });

export const unauthorized = (message = 'You need to sign in to do that') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have access to that') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, code = 'CONFLICT') =>
  new AppError(409, code, message);

export const tooManyRequests = (message = 'Too many requests — slow down') =>
  new AppError(429, 'RATE_LIMITED', message);

export const limitReached = (message: string) =>
  new AppError(409, 'LIMIT_REACHED', message);

/**
 * Turns a ZodError into inline form errors keyed by field path.
 * Only the first message per field survives — forms show one at a time.
 */
export function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

export function errorHandler(
  error: FastifyError | AppError | ZodError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof ZodError) {
    const fields = zodFields(error);
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please check the highlighted fields',
        fields,
      },
    });
  }

  if (error instanceof AppError) {
    // 4xx are the user's problem and are expected traffic; 5xx are ours.
    if (error.statusCode >= 500) {
      request.log.error({ err: error }, 'application error');
    }
    return reply.status(error.statusCode).send({
      error: { code: error.code, message: error.message, fields: error.fields },
    });
  }

  const fastifyError = error as FastifyError;

  // Fastify's own validation and rate-limit errors.
  if (fastifyError.statusCode === 429) {
    return reply.status(429).send({
      error: { code: 'RATE_LIMITED', message: 'Too many requests — slow down' },
    });
  }
  if (fastifyError.statusCode && fastifyError.statusCode < 500) {
    return reply.status(fastifyError.statusCode).send({
      error: {
        code: fastifyError.code ?? 'BAD_REQUEST',
        message: fastifyError.message,
      },
    });
  }

  request.log.error({ err: error }, 'unhandled error');

  return reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      // Never leak internals to the client in production.
      message: config.isProduction
        ? 'Something went wrong on our end'
        : (error as Error).message,
    },
  });
}
