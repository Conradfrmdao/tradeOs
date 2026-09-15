import Redis from 'ioredis';
import type { RealtimeMessage } from '@tradeos/shared';
import { config } from '../config';
import { logger } from './logger';

/**
 * Per-user realtime fan-out (PRD 33).
 *
 * Sockets live in memory on whichever instance the browser connected to, so a
 * multi-instance deployment needs a way for the instance that *observed* a
 * change to reach the instance that *holds* the socket. Redis pub/sub does
 * that. With no REDIS_URL configured the hub degrades to in-process delivery,
 * which is correct for a single instance and keeps local development free of
 * infrastructure requirements.
 */

type Sink = (message: RealtimeMessage) => void;

const CHANNEL = 'tradeos:realtime';

class RealtimeHub {
  private readonly sinks = new Map<string, Set<Sink>>();
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;

  async start(): Promise<void> {
    if (!config.REDIS_URL) {
      logger.info('realtime: running in-process (REDIS_URL not set)');
      return;
    }

    try {
      this.publisher = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
      this.subscriber = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });

      await this.publisher.connect();
      await this.subscriber.connect();
      await this.subscriber.subscribe(CHANNEL);

      this.subscriber.on('message', (_channel, raw) => {
        try {
          const { userId, message } = JSON.parse(raw) as {
            userId: string;
            message: RealtimeMessage;
          };
          this.deliverLocal(userId, message);
        } catch (err) {
          logger.warn({ err }, 'realtime: dropped malformed pub/sub payload');
        }
      });

      // A Redis outage must not take the API down with it; local delivery keeps
      // working and reconnection is handled by ioredis.
      this.publisher.on('error', (err) => logger.warn({ err }, 'realtime publisher error'));
      this.subscriber.on('error', (err) => logger.warn({ err }, 'realtime subscriber error'));

      logger.info('realtime: connected to Redis pub/sub');
    } catch (err) {
      logger.warn({ err }, 'realtime: Redis unavailable, falling back to in-process delivery');
      this.publisher = null;
      this.subscriber = null;
    }
  }

  async stop(): Promise<void> {
    this.sinks.clear();
    await Promise.allSettled([this.publisher?.quit(), this.subscriber?.quit()]);
  }

  subscribe(userId: string, sink: Sink): () => void {
    let set = this.sinks.get(userId);
    if (!set) {
      set = new Set();
      this.sinks.set(userId, set);
    }
    set.add(sink);

    return () => {
      const current = this.sinks.get(userId);
      if (!current) return;
      current.delete(sink);
      if (current.size === 0) this.sinks.delete(userId);
    };
  }

  publish(userId: string, message: RealtimeMessage): void {
    this.deliverLocal(userId, message);

    if (this.publisher) {
      this.publisher
        .publish(CHANNEL, JSON.stringify({ userId, message }))
        .catch((err) => logger.warn({ err }, 'realtime: publish failed'));
    }
  }

  /** True when the user has at least one live socket on this instance. */
  hasLocalListeners(userId: string): boolean {
    return (this.sinks.get(userId)?.size ?? 0) > 0;
  }

  private deliverLocal(userId: string, message: RealtimeMessage): void {
    const set = this.sinks.get(userId);
    if (!set) return;
    for (const sink of set) {
      try {
        sink(message);
      } catch (err) {
        logger.warn({ err }, 'realtime: sink threw');
      }
    }
  }
}

export const realtime = new RealtimeHub();
