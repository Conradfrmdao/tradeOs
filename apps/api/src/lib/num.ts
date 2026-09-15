import { Prisma } from '@tradeos/db';

/**
 * Prisma Decimal <-> JSON number conversion, done in exactly one place.
 *
 * Decimals are the right storage type but a poor wire type: `JSON.stringify`
 * turns a Decimal into `{"s":1,"e":2,"d":[...]}`. Everything leaving the API
 * goes through here.
 */

export type DecimalLike = Prisma.Decimal | number | string | null | undefined;

export function toNumber(value: DecimalLike): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  const n = value.toNumber();
  return Number.isFinite(n) ? n : null;
}

/** Same as `toNumber` but never null — for columns with a DB default of 0. */
export function toNum(value: DecimalLike, fallback = 0): number {
  return toNumber(value) ?? fallback;
}

export function toDecimal(value: number | string | null | undefined): Prisma.Decimal | null {
  if (value == null) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return null;
  return new Prisma.Decimal(n);
}

/** Sums a list of decimal-ish values as plain numbers. */
export function sumOf<T>(items: T[], pick: (item: T) => DecimalLike): number {
  let total = 0;
  for (const item of items) total += toNum(pick(item));
  return round2(total);
}

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
