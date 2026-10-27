import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../context';
import { AppError } from '../errors';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

/**
 * POST com Idempotency-Key: se a mesma chave (do mesmo funcionário) já foi processada,
 * devolve a resposta guardada em vez de executar de novo. É o que permite ao cliente
 * repetir com segurança uma criação de chamado depois de uma queda do legado.
 */
export const idempotency = createMiddleware<AppEnv>(async (c, next) => {
  const key = c.req.header(IDEMPOTENCY_HEADER);
  if (c.req.method !== 'POST' || !key) {
    await next();
    return undefined;
  }
  if (key.length > 200) throw new AppError(400, 'invalid_idempotency_key', 'Idempotency-Key muito longa.');

  const actorId = c.var.actor.employee.id;
  const repo = c.var.repos.idempotency;
  const stored = await repo.find(key, actorId);
  if (stored) {
    if (stored.method !== c.req.method || stored.path !== c.req.path) {
      throw new AppError(422, 'idempotency_key_reused', 'Esta Idempotency-Key já foi usada em outra operação.');
    }
    return new Response(stored.body, {
      status: stored.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'idempotent-replay': 'true' },
    });
  }

  await next();

  if (c.res.status >= 200 && c.res.status < 300) {
    const body = await c.res.clone().text();
    await repo.save(
      key,
      actorId,
      { method: c.req.method, path: c.req.path, status: c.res.status, body },
      c.var.clock().toISOString(),
    );
  }
  return undefined;
});
