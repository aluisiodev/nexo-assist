import { Hono } from 'hono';
import { createRepositories, type AppDeps, type AppEnv } from './context';
import { errorResponse } from './errors';
import { requireApiKey } from './middleware/auth';
import { employeeRoutes } from './routes/employees';
import { knowledgeBaseRoutes } from './routes/knowledge-base';
import { ticketRoutes } from './routes/tickets';

/**
 * Monta a API do service desk simulado. Recebe as dependências prontas (banco, relógio,
 * configuração de instabilidade) para que os testes usem a mesma app que o servidor.
 */
export function createApp(deps: AppDeps) {
  const repos = createRepositories(deps.db);
  const clock = deps.clock ?? (() => new Date());

  const app = new Hono<AppEnv>();
  app.onError((err, c) => errorResponse(c, err));
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Rota não encontrada.' } }, 404));

  app.use('*', async (c, next) => {
    c.set('repos', repos);
    c.set('clock', clock);
    c.set('calendar', deps.calendar);
    await next();
  });

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.use('*', requireApiKey(deps.apiKey));
  app.route('/employees', employeeRoutes());
  app.route('/kb', knowledgeBaseRoutes());
  app.route('/tickets', ticketRoutes(deps.chaos));

  return app;
}

export type ServiceDeskApp = ReturnType<typeof createApp>;
