import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { accountRouter } from './routes/account.routes.js';
import { operationsRouter } from './routes/operations.routes.js';
import { maintenanceRouter } from './routes/maintenance.routes.js';
import { inventoryRouter } from './routes/inventory.routes.js';
import { procurementRouter } from './routes/procurement.routes.js';
import { telemetryRouter } from './routes/telemetry.routes.js';
import { alertsRouter } from './routes/alerts.routes.js';
import { inspectionsRouter } from './routes/inspections.routes.js';
import { analyticsRouter } from './routes/analytics.routes.js';
import { downtimeRouter } from './routes/downtime.routes.js';
import { financialRouter } from './routes/financial.routes.js';
import { vendorIntelligenceRouter } from './routes/vendor-intelligence.routes.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin is not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// pino-http's published typings expose a module namespace under NodeNext,
// while its ESM default export is the middleware factory at runtime.
const createHttpLogger = pinoHttp as unknown as (
  options: { level: string }
) => express.RequestHandler;
app.use(createHttpLogger({ level: env.LOG_LEVEL }));

app.use(rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false
}));

app.get('/api/v1', (_request, response) => {
  response.status(200).json({
    name: 'ForgeOps API',
    version: '0.1.0',
    documentation: 'API documentation will be published as the domain modules are implemented.'
  });
});

app.use('/health', healthRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/account', accountRouter);
app.use('/api/v1/operations', operationsRouter);
app.use('/api/v1/maintenance', maintenanceRouter);
app.use('/api/v1/inventory', inventoryRouter);
app.use('/api/v1/procurement', procurementRouter);
app.use('/api/v1/telemetry', telemetryRouter);
app.use('/api/v1/alerts', alertsRouter);
app.use('/api/v1/inspections', inspectionsRouter);
app.use('/api/v1/analytics', analyticsRouter);
app.use('/api/v1/downtime', downtimeRouter);
app.use('/api/v1/financial', financialRouter);
app.use('/api/v1/vendors', vendorIntelligenceRouter);
app.use(errorHandler);
