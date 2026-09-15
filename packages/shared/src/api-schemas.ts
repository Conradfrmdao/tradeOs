/** Request validation shared by the API (enforcement) and the web app (forms). */

import { z } from 'zod';
import { PLATFORMS, RISK_MODES, ACCOUNT_ROLES } from './enums';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

/**
 * Length is the control that actually matters, so the floor is 10 rather than
 * the usual 8 and there is no character-class theatre. The only rejections
 * beyond length are passwords that are entirely one repeated character or a
 * straight run of digits, which are the two shapes users pick when a form
 * nags them about complexity.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'That password is too long')
  .refine((v) => !/^(.)\1+$/.test(v), 'That password is too predictable')
  .refine((v) => !/^\d+$/.test(v), 'Use more than just digits');

export const signupSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your name').max(80),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(16),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const verifyEmailSchema = z.object({ token: z.string().min(16) });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  timezone: z.string().max(64).optional(),
});

// ---------------------------------------------------------------------------
// Trading accounts
// ---------------------------------------------------------------------------

export const createAccountSchema = z.object({
  name: z.string().trim().min(1, 'Give the account a name').max(60),
  platform: z.enum(PLATFORMS),
  role: z.enum(ACCOUNT_ROLES),
  broker: z.string().trim().max(80).optional(),
  accountNumber: z
    .string()
    .trim()
    .min(1, 'Enter the account login number')
    .max(32)
    .regex(/^[0-9A-Za-z_-]+$/, 'Account number looks invalid'),
  server: z.string().trim().max(128).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  broker: z.string().trim().max(80).optional(),
  enabled: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Copier
// ---------------------------------------------------------------------------

export const symbolMappingSchema = z.object({
  masterSymbol: z.string().trim().min(1).max(64).toUpperCase(),
  followerSymbol: z.string().trim().min(1).max(64),
});

export const copierSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    riskMode: z.enum(RISK_MODES).optional(),
    lotMultiplier: z.number().positive().max(100).optional(),
    fixedLot: z.number().positive().max(1000).optional(),
    minLot: z.number().positive().max(1000).nullable().optional(),
    maxLot: z.number().positive().max(1000).nullable().optional(),
    copyStopLoss: z.boolean().optional(),
    copyTakeProfit: z.boolean().optional(),
    copyPendingOrders: z.boolean().optional(),
    reverseTrades: z.boolean().optional(),
    maxSlippagePoints: z.number().int().min(0).max(1000).optional(),
    symbolMappings: z.array(symbolMappingSchema).max(100).optional(),
  })
  .refine(
    (v) => v.minLot == null || v.maxLot == null || v.minLot <= v.maxLot,
    { message: 'Minimum lot cannot exceed maximum lot', path: ['minLot'] },
  );
export type CopierSettingsInput = z.infer<typeof copierSettingsSchema>;

export const toggleCopyingSchema = z.object({ enabled: z.boolean() });

export const closeAllSchema = z.object({
  /** Empty means every account the user owns. */
  accountIds: z.array(z.string().uuid()).max(50).optional(),
  /** Deliberate friction: the client must echo this exact word (PRD 28). */
  confirm: z.literal('CLOSE ALL'),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const openTradesQuerySchema = paginationSchema.extend({
  accountId: z.string().uuid().optional(),
  scope: z.enum(['all', 'master', 'followers']).default('all'),
  symbol: z.string().max(64).optional(),
  direction: z.enum(['BUY', 'SELL']).optional(),
  pnl: z.enum(['all', 'profitable', 'losing']).default('all'),
});

export const historyQuerySchema = paginationSchema.extend({
  accountId: z.string().uuid().optional(),
  scope: z.enum(['all', 'master', 'followers']).default('all'),
  symbol: z.string().max(64).optional(),
  direction: z.enum(['BUY', 'SELL']).optional(),
  search: z.string().max(64).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sortBy: z.enum(['closeTime', 'openTime', 'netProfit', 'symbol']).default('closeTime'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const copyEventsQuerySchema = paginationSchema.extend({
  accountId: z.string().uuid().optional(),
  status: z.enum(['all', 'SUCCESS', 'FAILED', 'SKIPPED', 'PENDING']).default('all'),
});

export const chartQuerySchema = z.object({
  range: z.enum(['today', '7d', '30d', '3m', 'all']).default('30d'),
  accountId: z.string().uuid().optional(),
});
