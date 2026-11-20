import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.routes.js';

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
app.use(pinoHttp({ level: env.LOG_LEVEL }));
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
app.use(errorHandler);