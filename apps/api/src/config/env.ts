import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  API_CORS_ORIGINS: z.string().default('http://localhost:4200'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/forgeops'),\n  AUTH_ACCESS_TOKEN_SECRET: z.string().min(32),\n  AUTH_ACCESS_TOKEN_TTL: z.string().default('15m'),\n  AUTH_REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(14)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('ForgeOps API environment validation failed');
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.API_CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
};