import { createApp } from './app';
import { config, isProduction } from './config';
import { openDatabase } from './db/database';
import { createRepositories } from './db/repositories';
import { logger } from './lib/logger';
import { AuthService } from './services/auth';
import { CorridorService } from './services/corridor';
import { RealtimeHub } from './services/realtime';

async function main() {
  const db = openDatabase(config.DATABASE_PATH);
  const repos = createRepositories(db);
  const auth = new AuthService(repos, config.SESSION_TTL_HOURS * 3600_000);
  await auth.ensureSeedAdmin(config.SEED_ADMIN_USERNAME, config.SEED_ADMIN_PASSWORD, (msg) => logger.info(msg));
  repos.sessions.purgeExpired();

  const hub = new RealtimeHub();
  const corridor = new CorridorService(repos, hub, logger, config.SIM_SEED);
  corridor.start();

  const app = createApp({
    repos,
    auth,
    corridor,
    hub,
    logger,
    allowSignup: config.ALLOW_SIGNUP,
    secureCookies: config.COOKIE_SECURE ?? isProduction,
    corsOrigin: config.CORS_ORIGIN,
    webDist: config.SERVE_WEB ? config.WEB_DIST : undefined,
  });

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, db: config.DATABASE_PATH }, 'Corridor API listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    corridor.stop();
    hub.close();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
