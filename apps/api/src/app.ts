import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import pinoHttp from 'pino-http';
import type { Logger } from 'pino';
import { errorHandler, requireJson, securityHeaders, sessionMiddleware } from './http/middleware';
import { createRouter, type RouteDeps } from './http/routes';

export interface AppOptions extends RouteDeps {
  logger: Logger;
  corsOrigin?: string;
  /** Directory of the built web client to serve (production single-origin deploy). */
  webDist?: string;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use(
    pinoHttp({
      logger: options.logger,
      // the event stream is long-lived; skip noisy logging for it and health checks
      autoLogging: { ignore: (req) => req.url === '/api/stream' || req.url === '/api/healthz' },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(securityHeaders());
  if (options.corsOrigin) app.use(cors({ origin: options.corsOrigin.split(','), credentials: true }));
  app.use(cookieParser());
  app.use(requireJson);
  app.use(express.json({ limit: '64kb' }));
  app.use(sessionMiddleware(options.auth));

  app.use('/api', createRouter(options));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Unknown API route' });
  });

  if (options.webDist && existsSync(path.join(options.webDist, 'index.html'))) {
    app.use(express.static(options.webDist, { index: false, maxAge: '1h' }));
    // client-side routing fallback
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(options.webDist!, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
