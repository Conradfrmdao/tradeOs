import type { CopyErrorCode } from '@tradeos/shared';

/**
 * Narrows raw MetaTrader return codes into the small vocabulary the UI shows
 * (PRD 17).
 *
 * The agent already sends a best-effort `errorCode`; this is the authority
 * when it does not, and the normaliser when it sends something unexpected.
 * The raw retcode is always preserved alongside, because support questions are
 * answered with the raw number, not with our label.
 */

/** MT5 TRADE_RETCODE_* values. */
const MT5_RETCODES: Record<number, CopyErrorCode> = {
  10004: 'REQUOTE', // REQUOTE
  10006: 'BROKER_REJECTED', // REJECT
  10007: 'BROKER_REJECTED', // CANCEL
  10013: 'BROKER_REJECTED', // INVALID_REQUEST
  10014: 'INVALID_VOLUME', // INVALID_VOLUME
  10015: 'BROKER_REJECTED', // INVALID_PRICE
  10016: 'INVALID_STOPS', // INVALID_STOPS
  10017: 'TRADE_DISABLED', // TRADE_DISABLED
  10018: 'MARKET_CLOSED', // MARKET_CLOSED
  10019: 'INSUFFICIENT_MARGIN', // NO_MONEY
  10020: 'REQUOTE', // PRICE_CHANGED
  10021: 'MARKET_CLOSED', // PRICE_OFF (no quotes)
  10024: 'BROKER_REJECTED', // TOO_MANY_REQUESTS
  10026: 'TRADE_DISABLED', // SERVER_DISABLES_AT (autotrading off on server)
  10027: 'TRADE_DISABLED', // CLIENT_DISABLES_AT (autotrading off in terminal)
  10030: 'BROKER_REJECTED', // INVALID_FILL
  10031: 'CONNECTION_LOST', // CONNECTION
  10034: 'INVALID_VOLUME', // LIMIT_VOLUME
  10036: 'POSITION_NOT_FOUND', // POSITION_CLOSED
  10038: 'INVALID_VOLUME', // INVALID_CLOSE_VOLUME
  10039: 'POSITION_NOT_FOUND', // CLOSE_ORDER_EXIST
  10041: 'BROKER_REJECTED', // REQUEST_CANCELED (order rejected)
  10043: 'BROKER_REJECTED', // ORDER_CHANGED
  10045: 'BROKER_REJECTED', // FIFO_CLOSE violation
};

/** MT4 GetLastError() values. */
const MT4_ERRORS: Record<number, CopyErrorCode> = {
  4: 'BROKER_REJECTED', // SERVER_BUSY
  6: 'CONNECTION_LOST', // NO_CONNECTION
  8: 'BROKER_REJECTED', // TOO_FREQUENT_REQUESTS
  64: 'TRADE_DISABLED', // ACCOUNT_DISABLED
  65: 'BROKER_REJECTED', // INVALID_ACCOUNT
  128: 'BROKER_REJECTED', // TRADE_TIMEOUT
  129: 'BROKER_REJECTED', // INVALID_PRICE
  130: 'INVALID_STOPS', // INVALID_STOPS
  131: 'INVALID_VOLUME', // INVALID_TRADE_VOLUME
  132: 'MARKET_CLOSED', // MARKET_CLOSED
  133: 'TRADE_DISABLED', // TRADE_DISABLED
  134: 'INSUFFICIENT_MARGIN', // NOT_ENOUGH_MONEY
  135: 'REQUOTE', // PRICE_CHANGED
  136: 'MARKET_CLOSED', // OFF_QUOTES
  138: 'REQUOTE', // REQUOTE
  139: 'BROKER_REJECTED', // ORDER_LOCKED
  141: 'BROKER_REJECTED', // TOO_MANY_REQUESTS
  145: 'BROKER_REJECTED', // TRADE_MODIFY_DENIED
  146: 'BROKER_REJECTED', // TRADE_CONTEXT_BUSY
  147: 'BROKER_REJECTED', // TRADE_EXPIRATION_DENIED
  148: 'BROKER_REJECTED', // TRADE_TOO_MANY_ORDERS
  4051: 'INVALID_VOLUME', // INVALID_FUNCTION_PARAMVALUE
  4106: 'SYMBOL_UNAVAILABLE', // UNKNOWN_SYMBOL
  4109: 'TRADE_DISABLED', // TRADE_NOT_ALLOWED
  4110: 'TRADE_DISABLED', // LONGS_NOT_ALLOWED
  4111: 'TRADE_DISABLED', // SHORTS_NOT_ALLOWED
};

const KNOWN_CODES = new Set<string>([
  'SYMBOL_UNAVAILABLE',
  'CONNECTION_LOST',
  'INSUFFICIENT_MARGIN',
  'INVALID_VOLUME',
  'INVALID_STOPS',
  'MARKET_CLOSED',
  'BROKER_REJECTED',
  'REQUOTE',
  'TRADE_DISABLED',
  'POSITION_NOT_FOUND',
  'TASK_EXPIRED',
  'AGENT_OFFLINE',
  'UNKNOWN',
]);

export function mapBrokerError(
  platform: 'MT4' | 'MT5',
  retcode: number | undefined,
  agentCode: string | undefined,
): CopyErrorCode {
  if (agentCode && KNOWN_CODES.has(agentCode)) return agentCode as CopyErrorCode;

  if (typeof retcode === 'number') {
    const table = platform === 'MT5' ? MT5_RETCODES : MT4_ERRORS;
    const mapped = table[retcode];
    if (mapped) return mapped;
  }

  return 'UNKNOWN';
}

/**
 * Whether a failure is worth retrying.
 *
 * Retrying a requote or a busy server is sensible — the next attempt is a new
 * price. Retrying "insufficient margin" or "symbol unavailable" is not: the
 * condition will not have changed a second later, and each attempt costs a
 * round trip while the price moves further from the master's entry.
 */
export function isRetryable(code: CopyErrorCode): boolean {
  switch (code) {
    case 'REQUOTE':
    case 'CONNECTION_LOST':
    case 'BROKER_REJECTED':
      return true;
    default:
      return false;
  }
}
