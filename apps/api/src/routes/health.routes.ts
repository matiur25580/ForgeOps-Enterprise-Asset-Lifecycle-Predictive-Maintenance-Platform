import { Router } from 'express';
import { isDatabaseReady } from '../config/database.js';

export const healthRouter = Router();

healthRouter.get('/live', (_request, response) => {
  response.status(200).json({
    status: 'ok',
    service: 'forgeops-api',
    timestamp: new Date().toISOString()
  });
});

healthRouter.get('/ready', (_request, response) => {
  const databaseReady = isDatabaseReady();
  response.status(databaseReady ? 200 : 503).json({
    status: databaseReady ? 'ready' : 'not_ready',
    checks: {
      database: databaseReady ? 'connected' : 'disconnected'
    },
    timestamp: new Date().toISOString()
  });
});