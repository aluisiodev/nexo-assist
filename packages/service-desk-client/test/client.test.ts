import { describe, expect, it } from 'vitest';
import { createServiceDeskClient, ServiceDeskError } from '../src';

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function fakeFetch(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error('sem mais respostas');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fn, calls };
}

const make = (fetchFn: typeof fetch, delays: number[] = []) =>
  createServiceDeskClient({
    baseUrl: 'http://sd.test/',
    apiKey: 'k'.repeat(20),
    fetch: fetchFn,
    sleep: async (ms) => {
      delays.push(ms);
    },
    random: () => 0,
  });

describe('createServiceDeskClient', () => {
  it('envia chave, ator e marca de agent nos cabeçalhos', async () => {
    const { fn, calls } = fakeFetch([jsonResponse(200, { tickets: [] })]);
    await make(fn).forActor('emp-ana', { viaAgent: true }).listTickets({ status: 'all' });
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(calls[0]?.url).toBe('http://sd.test/tickets?status=all');
    expect(headers).toMatchObject({ 'x-api-key': 'k'.repeat(20), 'x-actor-id': 'emp-ana', 'x-actor-via': 'agent' });
  });

  it('GET repete em 503 com backoff exponencial, respeitando Retry-After', async () => {
    const delays: number[] = [];
    const { fn, calls } = fakeFetch([
      jsonResponse(503, {}, { 'retry-after': '2' }),
      new TypeError('fetch failed'),
      jsonResponse(200, { tickets: [] }),
    ]);
    await make(fn, delays).forActor('emp-ana').listTickets();
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([2000, 600]);
  });

  it('erro de negócio não é repetido e preserva o código do serviço', async () => {
    const { fn, calls } = fakeFetch([
      jsonResponse(409, { error: { code: 'possible_duplicate', message: 'Já existe o INC-1', details: { ticketId: 'INC-1' } } }),
    ]);
    const err = await make(fn)
      .forActor('emp-ana')
      .createTicket(
        { type: 'INC', category: 'outros', title: 'Teste de título', description: 'Descrição longa o bastante', priority: 'baixa', impact: 'individual' },
        'k-1',
      )
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'conflict', code: 'possible_duplicate', details: { ticketId: 'INC-1' } });
    expect(calls).toHaveLength(1);
  });

  it('POST com chave de idempotência repete em 503 e reenvia a mesma chave', async () => {
    const ticket = {
      id: 'INC-1', type: 'INC', category: 'outros', title: 'Teste de título', description: 'Descrição longa o bastante',
      priority: 'baixa', priorityReason: null, impact: 'individual', status: 'aguardando_analista', requesterId: 'emp-ana',
      assignedGroup: 'N1', assigneeId: null, source: 'agent', createdAt: '2026-10-27T13:00:00.000Z',
      updatedAt: '2026-10-27T13:00:00.000Z', slaReferenceAt: '2026-10-27T13:00:00.000Z', resolvedAt: null,
      sla: { dueAt: null, overdue: false, target: '5 dias úteis', paused: false }, canReopen: false,
    };
    const { fn, calls } = fakeFetch([jsonResponse(503, {}), jsonResponse(201, { ticket })]);
    const created = await make(fn)
      .forActor('emp-ana')
      .createTicket(
        { type: 'INC', category: 'outros', title: 'Teste de título', description: 'Descrição longa o bastante', priority: 'baixa', impact: 'individual' },
        'draft-1',
      );
    expect(created.id).toBe('INC-1');
    expect(calls.map((c) => (c.init?.headers as Record<string, string>)['idempotency-key'])).toEqual(['draft-1', 'draft-1']);
  });

  it('valida o contrato da resposta', async () => {
    const { fn } = fakeFetch([jsonResponse(200, { tickets: [{ id: 'X' }] })]);
    const err = await make(fn).forActor('emp-ana').listTickets().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceDeskError);
    expect(err).toMatchObject({ kind: 'invalid_response' });
  });

  it('timeout vira "unavailable" depois das tentativas', async () => {
    const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const { fn, calls } = fakeFetch([timeout, timeout, timeout, timeout]);
    const err = await make(fn).forActor('emp-ana').listTickets().catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'unavailable' });
    expect((err as Error).message).toContain('timeout');
    expect(calls).toHaveLength(4);
  });
});
