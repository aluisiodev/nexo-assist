import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { Hono } from 'hono';
import { createApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db/client';
import { seedIfEmpty } from './seed/seed';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = await openDatabase(config.databaseUrl, config.databaseAuthToken);
  const seeded = await seedIfEmpty(db, new Date());

  const app = new Hono();
  app.use('*', logger());
  app.route('/', createApp({ db, apiKey: config.apiKey, chaos: config.chaos }));

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`[service-desk] ouvindo em http://localhost:${info.port}`);
    console.log(`[service-desk] banco: ${config.databaseUrl}${seeded ? ' (dados de exemplo criados agora)' : ''}`);
    const { failureRate, outageMs } = config.chaos;
    console.log(
      failureRate > 0
        ? `[service-desk] instabilidade simulada: ${Math.round(failureRate * 100)}% de chance de queda de ${outageMs} ms`
        : '[service-desk] instabilidade simulada desligada',
    );
    if (config.usingDevApiKey)
      console.warn('[service-desk] usando a chave de API de desenvolvimento (defina SERVICE_DESK_API_KEY)');
  });

  const shutdown = () => {
    server.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
