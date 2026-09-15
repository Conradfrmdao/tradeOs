import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config';

/**
 * All cryptographic material handling lives here so there is exactly one place
 * to audit.
 *
 * Rules enforced by this module:
 *  - passwords are bcrypt-hashed, never encrypted, never logged
 *  - session/reset/agent tokens are stored only as SHA-256 digests, so a
 *    database leak does not hand over live credentials
 *  - anything reversible uses AES-256-GCM with a versioned key
 */

const BCRYPT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Burns roughly the same time as a real bcrypt comparison.
 *
 * Called when the email does not exist, so that "unknown email" and "wrong
 * password" take the same wall-clock time and cannot be told apart by an
 * attacker enumerating addresses.
 */
export async function fakePasswordVerify(): Promise<void> {
  await bcrypt.compare(
    'timing-equalizer',
    '$2a$12$ygYgB9icRjCkhd95zhQ.x.A21wsBG26w38P1bTafASLjiV3oJWa9i',
  );
}

// ---------------------------------------------------------------------------
// Opaque tokens (sessions, email links, agent bearer tokens)
// ---------------------------------------------------------------------------

/** 32 bytes of CSPRNG entropy, URL-safe. */
export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Human-typed pairing code shown in the dashboard and entered into the EA.
 * Uses Crockford-style alphabet: no 0/O/1/I/L to survive being read aloud or
 * copied off a screen.
 */
const PAIRING_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generatePairingCode(length = 12): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PAIRING_ALPHABET[bytes[i]! % PAIRING_ALPHABET.length];
    if (i % 4 === 3 && i !== length - 1) out += '-';
  }
  return out;
}

export function normalizePairingCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** Constant-time string comparison that tolerates different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still do a comparison so the branch itself is not a timing signal.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Reversible encryption (AES-256-GCM)
// ---------------------------------------------------------------------------

export interface EncryptedEnvelope {
  v: number; // key version, so keys can be rotated without a migration
  iv: string; // base64
  tag: string; // base64 auth tag
  data: string; // base64 ciphertext
}

function encryptionKey(): Buffer {
  return Buffer.from(config.ENCRYPTION_KEY, 'base64');
}

export function encrypt(plaintext: string): EncryptedEnvelope {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: config.ENCRYPTION_KEY_VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decrypt(envelope: EncryptedEnvelope): string {
  if (envelope.v !== config.ENCRYPTION_KEY_VERSION) {
    throw new Error(
      `Cannot decrypt: envelope was sealed with key version ${envelope.v}, ` +
        `current version is ${config.ENCRYPTION_KEY_VERSION}`,
    );
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
