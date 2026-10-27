import { beforeEach, describe, expect, it } from 'vitest';
import { ANA, BRUNO, createTestServer, DIEGO, RAFAEL, vpnTicket, type TestServer } from './helpers';

type Json = Record<string, any>;
const json = async (res: Response): Promise<Json> => (await res.json()) as Json;

let s: TestServer;
beforeEach(async () => {
  s = await createTestServer();
});

describe('autenticação', () => {
  it('exige a chave de API', async () => {
    const res = await s.app.request('/tickets', { headers: { 'x-actor-id': ANA } });
    expect(res.status).toBe(401);
  });

  it('exige saber em nome de quem é a chamada', async () => {
    const res = await s.call('/tickets');
    expect(res.status).toBe(401);
  });

  it('health não exige nada', async () => {
    expect((await s.app.request('/health')).status).toBe(200);
  });
});

describe('privacidade: chamados de um funcionário nunca aparecem para outro', () => {
  it('lista só os chamados abertos do próprio funcionário', async () => {
    const body = await json(await s.call('/tickets', { actor: ANA }));
    const ids = body.tickets.map((t: Json) => t.id).sort();
    expect(ids).toEqual(['INC-20298', 'INC-20311', 'REQ-10442']);
  });

  it('responde 404 (e não 403) para o chamado de outra pessoa', async () => {
    const res = await s.call('/tickets/INC-20330', { actor: ANA });
    expect(res.status).toBe(404);
    expect((await s.call('/tickets/INC-20330/events', { actor: ANA })).status).toBe(404);
  });

  it('funcionário não lista chamados de outra pessoa nem pedindo explicitamente', async () => {
    const res = await s.call(`/tickets?requesterId=${BRUNO}`, { actor: ANA });
    expect(res.status).toBe(403);
  });

  it('funcionário não comenta nem transfere chamado alheio', async () => {
    expect((await s.call('/tickets/INC-20330/comments', { actor: ANA, body: { body: 'oi' } })).status).toBe(404);
    expect(
      (
        await s.call('/tickets/INC-20330/transfer', {
          actor: ANA,
          body: { group: 'N2', summary: 'resumo qualquer aqui' },
        })
      ).status,
    ).toBe(404);
  });

  it('a busca de duplicados não vaza chamados de outros (Bruno tem um sobre VPN 809)', async () => {
    const body = await json(await s.call('/tickets/similar?text=vpn%20erro%20809&category=rede_vpn', { actor: ANA }));
    expect(body.matches).toEqual([]);
  });

  it('analista vê chamados de qualquer funcionário', async () => {
    const body = await json(await s.call(`/tickets?requesterId=${BRUNO}`, { actor: RAFAEL }));
    expect(body.tickets.map((t: Json) => t.id)).toEqual(['INC-20330']);
  });
});

describe('consulta com prazo calculado', () => {
  it('INC-20311 está vencido (sem resposta há 6 dias, prazo de 3 dias úteis)', async () => {
    const { ticket } = await json(await s.call('/tickets/inc-20311', { actor: ANA }));
    expect(ticket.id).toBe('INC-20311');
    expect(ticket.sla).toMatchObject({ overdue: true, target: '3 dias úteis', paused: false });
  });

  it('chamado aguardando o funcionário tem o prazo pausado', async () => {
    const { ticket } = await json(await s.call('/tickets/INC-20325', { actor: DIEGO }));
    expect(ticket.sla).toMatchObject({ paused: true, overdue: false });
  });

  it('marca o que pode ser reaberto', async () => {
    const { tickets } = await json(await s.call('/tickets?status=closed', { actor: ANA }));
    const reopenable = tickets.filter((t: Json) => t.canReopen).map((t: Json) => t.id);
    expect(reopenable).toEqual(['INC-20150']);
  });

  it('valida o filtro', async () => {
    expect((await s.call('/tickets?status=qualquer', { actor: ANA })).status).toBe(400);
  });
});

describe('abertura de chamado', () => {
  it('cria com número sequencial, prazo e evento de abertura feito pelo agent', async () => {
    const res = await s.call('/tickets', { actor: ANA, body: vpnTicket, headers: { 'x-actor-via': 'agent' } });
    expect(res.status).toBe(201);
    const { ticket } = await json(res);
    expect(ticket).toMatchObject({
      id: 'INC-20517',
      requesterId: ANA,
      status: 'aguardando_analista',
      priority: 'alta',
      source: 'agent',
    });
    expect(ticket.sla.dueAt).toBe(new Date('2026-10-27T14:00:00-03:00').toISOString());

    const { events } = await json(await s.call('/tickets/INC-20517/events', { actor: ANA }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'created', actorType: 'agent', actorId: ANA });
  });

  it('numera requisições separadamente', async () => {
    const res = await s.call('/tickets', {
      actor: ANA,
      body: {
        ...vpnTicket,
        type: 'REQ',
        category: 'software',
        title: 'Instalar o Power BI Desktop',
        description: 'Preciso do Power BI Desktop para os relatórios do fechamento.',
        priority: 'baixa',
      },
    });
    expect((await json(res)).ticket.id).toBe('REQ-10461');
  });

  it('rejeita dados incompletos com detalhes', async () => {
    const res = await s.call('/tickets', { actor: ANA, body: { ...vpnTicket, title: 'VPN', impact: undefined } });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe('validation_error');
    expect(body.error.details.map((d: Json) => d.path)).toEqual(expect.arrayContaining(['title', 'impact']));
  });

  it('funcionário não abre chamado em nome de outra pessoa', async () => {
    const res = await s.call('/tickets', { actor: ANA, body: { ...vpnTicket, requesterId: BRUNO } });
    expect(res.status).toBe(403);
  });

  it('bloqueia duplicado de um chamado aberto e libera após confirmação', async () => {
    const dup = {
      ...vpnTicket,
      category: 'hardware',
      title: 'Notebook lento após atualização do Windows',
      description: 'Lentidão geral no notebook desde a atualização do Windows.',
      priority: 'media',
    };
    const blocked = await s.call('/tickets', { actor: ANA, body: dup });
    expect(blocked.status).toBe(409);
    expect((await json(blocked)).error).toMatchObject({
      code: 'possible_duplicate',
      details: { ticketId: 'INC-20311' },
    });

    const allowed = await s.call('/tickets', { actor: ANA, body: { ...dup, confirmedNotDuplicate: true } });
    expect(allowed.status).toBe(201);
  });
});

describe('idempotência (retry seguro depois de queda)', () => {
  it('a mesma Idempotency-Key devolve o mesmo chamado sem criar outro', async () => {
    const headers = { 'idempotency-key': 'draft-D-381' };
    const first = await json(await s.call('/tickets', { actor: ANA, body: vpnTicket, headers }));
    const replay = await s.call('/tickets', { actor: ANA, body: vpnTicket, headers });
    expect(replay.headers.get('idempotent-replay')).toBe('true');
    expect((await json(replay)).ticket.id).toBe(first.ticket.id);

    const { tickets } = await json(await s.call('/tickets', { actor: ANA }));
    expect(tickets.filter((t: Json) => t.title === vpnTicket.title)).toHaveLength(1);
  });

  it('a chave é por funcionário', async () => {
    const headers = { 'idempotency-key': 'mesma-chave' };
    const a = await json(await s.call('/tickets', { actor: ANA, body: vpnTicket, headers }));
    const b = await json(
      await s.call('/tickets', { actor: DIEGO, body: { ...vpnTicket, title: 'Outlook trava ao abrir' }, headers }),
    );
    expect(a.ticket.id).not.toBe(b.ticket.id);
    expect(b.ticket.requesterId).toBe(DIEGO);
  });

  it('não reaproveita a chave em outra operação', async () => {
    const headers = { 'idempotency-key': 'k1' };
    await s.call('/tickets', { actor: ANA, body: vpnTicket, headers });
    const res = await s.call('/tickets/INC-20311/comments', { actor: ANA, body: { body: 'mais info' }, headers });
    expect(res.status).toBe(422);
  });
});

describe('atualização, reabertura e transferência', () => {
  it('complementa um chamado aberto', async () => {
    const res = await s.call('/tickets/INC-20311/comments', {
      actor: ANA,
      body: { body: 'Agora também trava ao abrir o Excel.' },
    });
    expect(res.status).toBe(200);
    const { events } = await json(await s.call('/tickets/INC-20311/events', { actor: ANA }));
    expect(events.at(-1)).toMatchObject({ kind: 'comment', body: 'Agora também trava ao abrir o Excel.' });
  });

  it('resposta do funcionário devolve o chamado à fila e reinicia o prazo', async () => {
    const { ticket } = await json(
      await s.call('/tickets/INC-20325/comments', { actor: DIEGO, body: { body: 'Windows 11, print em anexo.' } }),
    );
    expect(ticket.status).toBe('aguardando_analista');
    expect(ticket.sla.paused).toBe(false);
  });

  it('não comenta em chamado resolvido e indica a reabertura', async () => {
    const res = await s.call('/tickets/INC-20150/comments', { actor: ANA, body: { body: 'Bloqueou de novo' } });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatchObject({ code: 'ticket_closed', details: { canReopen: true } });
  });

  it('reabre resolvido há até 7 dias', async () => {
    const res = await s.call('/tickets/INC-20150/reopen', { actor: ANA, body: { reason: 'O SAP bloqueou de novo.' } });
    expect(res.status).toBe(200);
    const { ticket } = await json(res);
    expect(ticket).toMatchObject({ status: 'aguardando_analista', resolvedAt: null, canReopen: false });
  });

  it('não reabre depois de 7 dias', async () => {
    const res = await s.call('/tickets/INC-19877/reopen', { actor: ANA, body: { reason: 'Parou de novo.' } });
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe('reopen_window_expired');
  });

  it('transfere para um grupo levando o resumo', async () => {
    const summary = 'Chamado vencido há 3 dias úteis; funcionária pediu para falar com analista.';
    const { ticket } = await json(
      await s.call('/tickets/INC-20311/transfer', { actor: ANA, body: { group: 'N2', summary } }),
    );
    expect(ticket.assignedGroup).toBe('N2');
    const { events } = await json(await s.call('/tickets/INC-20311/events', { actor: ANA }));
    expect(events.at(-1)).toMatchObject({ kind: 'transferred' });
    expect(events.at(-1).body).toContain(summary);
  });

  it('só analista muda status; assumir registra o responsável e resolver permite reabrir', async () => {
    expect((await s.call('/tickets/INC-20311/status', { actor: ANA, body: { status: 'resolvido' } })).status).toBe(403);

    const taken = await json(
      await s.call('/tickets/INC-20311/status', { actor: RAFAEL, body: { status: 'em_andamento' } }),
    );
    expect(taken.ticket).toMatchObject({ status: 'em_andamento', assigneeId: RAFAEL });
    expect(taken.ticket.sla.overdue).toBe(false);

    const resolved = await json(
      await s.call('/tickets/INC-20311/status', { actor: RAFAEL, body: { status: 'resolvido' } }),
    );
    expect(resolved.ticket.canReopen).toBe(true);
  });
});
