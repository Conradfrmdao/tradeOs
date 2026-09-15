import { buildApp } from './app';
import { config } from './config';
import { logger } from './lib/logger';
import { realtime } from './lib/realtime';
import { disconnectPrisma } from './lib/prisma';
import { startHeartbeatMonitor, stopHeartbeatMonitor } from './engine/heartbeat';

async function main(): Promise<void> {
  await realtime.start();

  const app = await buildApp();

  startHeartbeatMonitor();

  await app.listen({ port: config.API_PORT, host: config.API_HOST });

  logger.info(
    {
      port: config.API_PORT,
      env: config.NODE_ENV,
      webOrigin: config.WEB_ORIGIN,
      maxAccounts: config.maxAccounts,
    },
    'TradeOS API listening',
  );

  /**
   * Graceful shutdown.
   *
   * In-flight agent syncs are allowed to finish before the process exits:
   * cutting one short could leave a copy task marked DISPATCHED with no result
   * ever recorded, which is exactly the ambiguity the engine is built to avoid.
   */
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'shutting down');
    stopHeartbeatMonitor();

    const force = setTimeout(() => {
      logger.error('graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 15_000);
    force.unref();

    try {
      await app.close();
      await realtime.stop();
      await disconnectPrisma();
      clearTimeout(force);
      logger.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled promise rejection');
  });

  process.on('uncaughtException', (err) => {
    // An unknown-state process must not keep placing trades.
    logger.fatal({ err }, 'uncaught exception — exiting');
    void shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start TradeOS API');
  process.exit(1);
});
