import { app } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';

let shuttingDown = false;

async function shutdown(signal: string, server: ReturnType<typeof app.listen>): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Received ${signal}; shutting down ForgeOps API.`);

  server.close(async (error) => {
    try {
      await disconnectDatabase();
      if (error) {
        console.error('HTTP server shutdown failed:', error);
        process.exitCode = 1;
      }
    } catch (databaseError) {
      console.error('MongoDB shutdown failed:', databaseError);
      process.exitCode = 1;
    }
  });

  setTimeout(() => {
    console.error('Graceful shutdown timed out; forcing process exit.');
    process.exit(1);
  }, 10_000).unref();
}

async function start(): Promise<void> {
  await connectDatabase();

  const server = app.listen(env.API_PORT, env.API_HOST, () => {
    console.info(`ForgeOps API listening on http://${env.API_HOST}:${env.API_PORT}`);
  });

  process.once('SIGINT', () => void shutdown('SIGINT', server));
  process.once('SIGTERM', () => void shutdown('SIGTERM', server));
}

start().catch((error: unknown) => {
  console.error('ForgeOps API failed to start:', error);
  process.exitCode = 1;
});