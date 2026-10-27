import { timingSafeEqual } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../context';
import { forbidden, unauthorized } from '../errors';

export const API_KEY_HEADER = 'x-api-key';
export const ACTOR_HEADER = 'x-actor-id';
export const VIA_HEADER = 'x-actor-via';

function sameSecret(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Só o app/agent (quem tem a chave) fala com o service desk. */
export function requireApiKey(apiKey: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const provided = c.req.header(API_KEY_HEADER);
    if (!provided || !sameSecret(provided, apiKey)) throw unauthorized('Chave de API ausente ou inválida.');
    await next();
  });
}

/**
 * Identifica o funcionário em nome de quem a chamada é feita. O app preenche este
 * cabeçalho a partir da sessão autenticada; o LLM nunca escolhe o valor.
 */
export const requireActor = createMiddleware<AppEnv>(async (c, next) => {
  const actorId = c.req.header(ACTOR_HEADER);
  if (!actorId) throw unauthorized(`Cabeçalho ${ACTOR_HEADER} obrigatório.`);
  const employee = await c.var.repos.employees.findById(actorId);
  if (!employee) throw unauthorized('Funcionário desconhecido.');
  c.set('actor', { employee, viaAgent: c.req.header(VIA_HEADER) === 'agent' });
  await next();
});

export const requireAnalyst = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.actor.employee.role !== 'analyst') throw forbidden('Apenas analistas podem fazer isso.');
  await next();
});
