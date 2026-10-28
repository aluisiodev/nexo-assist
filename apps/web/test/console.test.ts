import { beforeEach, describe, expect, it } from 'vitest';
import { allowedActions, compareQueueItems, matchesFilter, queueBadge, type QueueItem } from '@/lib/console';
import type { AgentReply, AgentResponder } from '@/server/agent/types';
import { ConsoleService } from '@/server/console/service';
import { ConversationService } from '@/server/conversations/service';
import { ANA, createConversationRepo, createServiceDesk, draftsFor, JULIANA, NOW, RAFAEL } from './helpers';

/**
 * Console do analista (Telas 4 e 5): rótulos e filtros da fila (funções puras) e o
 * serviço contra o banco e o service desk reais.
 */

const RAFAEL_VIEW = { id: RAFAEL.employeeId, group: RAFAEL.supportGroup };
const JULIANA_VIEW = { id: JULIANA.employeeId, group: JULIANA.supportGroup };

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: 'c_1',
  employee: { id: 'emp-ana', name: 'Ana Souza', email: 'ana.souza@nexo.com.br', department: 'Financeiro' },
  status: 'agent',
  assignedAnalystId: null,
  assignedAnalystName: null,
  handoff: null,
  closedBy: null,
  closedAt: null,
  lastMessageAt: NOW.toISOString(),
  preview: 'oi',
  employeeMessageCount: 1,
  messageLimit: 30,
  createdAt: NOW.toISOString(),
  ...over,
});

const handoff = (over: Partial<NonNullable<QueueItem['handoff']>> = {}): NonNullable<QueueItem['handoff']> => ({
  reason: 'employee_request',
  group: 'N1',
  confidence: null,
  at: NOW.toISOString(),
  dueAt: new Date(NOW.getTime() + 2 * 3600_000).toISOString(),
  ticketId: null,
  summary: 'Resumo',
  ...over,
});

describe('fila: rótulos de status (como no protótipo)', () => {
  it('transferida, agent pediu ajuda com a confiança, caso crítico', () => {
    expect(queueBadge(item({ status: 'waiting_analyst', handoff: handoff() }), RAFAEL_VIEW).label).toBe('Transferida');
    expect(
      queueBadge(
        item({ status: 'waiting_analyst', handoff: handoff({ reason: 'low_confidence', confidence: 0.41 }) }),
        RAFAEL_VIEW,
      ),
    ).toEqual({ label: 'Agent pediu ajuda · confiança 41%', tone: 'warning' });
    expect(
      queueBadge(item({ status: 'waiting_analyst', handoff: handoff({ reason: 'critical' }) }), RAFAEL_VIEW).tone,
    ).toBe('danger');
  });

  it('com você / com outro analista, com o agent e encerradas', () => {
    const withRafael = item({
      status: 'with_analyst',
      assignedAnalystId: 'ana-rafael',
      assignedAnalystName: 'Rafael Lima',
    });
    expect(queueBadge(withRafael, RAFAEL_VIEW).label).toBe('Com você');
    expect(queueBadge(withRafael, JULIANA_VIEW).label).toBe('Com Rafael Lima');
    expect(queueBadge(item(), RAFAEL_VIEW).label).toBe('Com o agent');
    expect(queueBadge(item({ status: 'closed', closedBy: 'employee' }), RAFAEL_VIEW).label).toBe(
      'Resolvida pelo agent',
    );
    expect(
      queueBadge(item({ status: 'closed', closedBy: 'analyst', assignedAnalystName: 'Juliana Costa' }), RAFAEL_VIEW)
        .label,
    ).toBe('Encerrada por Juliana Costa');
  });
});

describe('fila: filtros, ordem e ações permitidas', () => {
  const waitingN1 = item({ id: 'w1', status: 'waiting_analyst', handoff: handoff({ group: 'N1' }) });
  const waitingN2 = item({ id: 'w2', status: 'waiting_analyst', handoff: handoff({ group: 'N2' }) });
  const mine = item({
    id: 'm',
    status: 'with_analyst',
    assignedAnalystId: 'ana-rafael',
    assignedAnalystName: 'Rafael',
  });
  const agent = item({ id: 'a' });

  it('"Para você" mostra só o grupo do analista; "Minhas" só as que ele assumiu', () => {
    const all = [waitingN1, waitingN2, mine, agent];
    expect(all.filter((i) => matchesFilter(i, 'para_voce', RAFAEL_VIEW)).map((i) => i.id)).toEqual(['w2']);
    expect(all.filter((i) => matchesFilter(i, 'para_voce', JULIANA_VIEW)).map((i) => i.id)).toEqual(['w1']);
    expect(all.filter((i) => matchesFilter(i, 'minhas', RAFAEL_VIEW)).map((i) => i.id)).toEqual(['m']);
    expect(all.filter((i) => matchesFilter(i, 'com_agent', RAFAEL_VIEW)).map((i) => i.id)).toEqual(['a']);
    expect(all.filter((i) => matchesFilter(i, 'todas', RAFAEL_VIEW))).toHaveLength(4);
  });

  it('crítico primeiro, depois o prazo mais curto; encerradas por último', () => {
    const later = item({
      id: 'later',
      status: 'waiting_analyst',
      handoff: handoff({ dueAt: new Date(NOW.getTime() + 5 * 3600_000).toISOString() }),
    });
    const critical = item({ id: 'crit', status: 'waiting_analyst', handoff: handoff({ reason: 'critical' }) });
    const closed = item({ id: 'closed', status: 'closed', closedAt: NOW.toISOString() });
    const sorted = [closed, agent, later, mine, waitingN1, critical].sort(compareQueueItems).map((i) => i.id);
    expect(sorted).toEqual(['crit', 'w1', 'later', 'm', 'a', 'closed']);
  });

  it('só quem assumiu responde; com outro analista, não há ações', () => {
    expect(allowedActions(waitingN2, RAFAEL_VIEW)).toEqual({ assume: true, return: true, close: true, reply: false });
    expect(allowedActions(mine, RAFAEL_VIEW)).toEqual({ assume: false, return: true, close: true, reply: true });
    expect(allowedActions(mine, JULIANA_VIEW)).toEqual({ assume: false, return: false, close: false, reply: false });
    expect(allowedActions(agent, RAFAEL_VIEW)).toMatchObject({ assume: true, return: false, reply: false });
  });
});

describe('ConsoleService', () => {
  class Responder implements AgentResponder {
    readonly name = 'fake';
    next: AgentReply = { messages: [{ text: 'ok', trace: { engine: 'fake', steps: [] } }] };
    async respond(): Promise<AgentReply> {
      return this.next;
    }
  }

  let responder: Responder;
  let consoleService: ConsoleService;
  let conversations: ConversationService;

  beforeEach(async () => {
    const repo = await createConversationRepo();
    const sd = await createServiceDesk();
    responder = new Responder();
    conversations = new ConversationService({
      repo,
      responder,
      serviceDesk: sd.access,
      drafts: draftsFor(repo),
      clock: () => NOW,
      log: () => {},
    });
    consoleService = new ConsoleService({ repo, conversations, serviceDesk: sd.client, clock: () => NOW });
  });

  const transferAna = async () => {
    responder.next = {
      messages: [{ text: 'Chamei um analista.', trace: { engine: 'fake', steps: [] } }],
      handoff: {
        reason: 'low_confidence',
        group: 'N1',
        confidence: 0.41,
        summary: 'Ana relata lentidão; o agent não teve segurança para decidir.',
        ticketId: 'INC-20311',
      },
    };
    await conversations.sendEmployeeMessage(ANA, 'Meu notebook está estranho');
    return (await conversations.getOrStart(ANA)).id;
  };

  it('a fila traz a transferência com motivo, confiança, prazo e chamado; conversa vazia fica de fora', async () => {
    await conversations.getOrStart(ANA); // abriu a tela e não escreveu nada
    expect((await consoleService.queue()).items).toHaveLength(0);

    const id = await transferAna();
    const [entry] = (await consoleService.queue()).items;
    expect(entry).toMatchObject({
      id,
      status: 'waiting_analyst',
      employee: { name: 'Ana Souza', department: 'Financeiro' },
      handoff: { reason: 'low_confidence', group: 'N1', confidence: 0.41, ticketId: 'INC-20311' },
    });
    // 2 horas úteis a partir das 10:00 de terça.
    expect(entry!.handoff!.dueAt).toBe(new Date('2026-10-27T12:00:00-03:00').toISOString());
  });

  it('assumir, responder, devolver ao agent e encerrar, com avisos na conversa', async () => {
    const id = await transferAna();

    const assumed = await consoleService.act(JULIANA, id, 'assume');
    expect(assumed.conversation).toMatchObject({ status: 'with_analyst', assignedAnalystName: 'Juliana Costa' });
    expect(assumed.messages.at(-1)?.text).toMatch(/Juliana Costa assumiu · agent pausado/);

    await expect(consoleService.reply(RAFAEL, id, 'Oi')).rejects.toMatchObject({ code: 'not_assigned' });
    const reply = await consoleService.reply(JULIANA, id, 'Oi, Ana! Vou olhar o INC-20311.');
    expect(reply).toMatchObject({ role: 'analyst', authorName: 'Juliana Costa' });

    const returned = await consoleService.act(JULIANA, id, 'return');
    expect(returned.conversation.status).toBe('agent');
    expect(returned.messages.at(-1)?.text).toMatch(/devolveu a conversa ao Nexo Assist/);

    const closed = await consoleService.act(RAFAEL, id, 'close');
    expect(closed.conversation).toMatchObject({
      status: 'closed',
      closedBy: 'analyst',
      assignedAnalystName: 'Rafael Lima',
    });
    expect(queueBadge(closed.conversation, RAFAEL_VIEW).label).toBe('Encerrada por Rafael Lima');
  });

  it('dois analistas: o segundo a assumir recebe erro e nada muda', async () => {
    const id = await transferAna();
    await consoleService.act(RAFAEL, id, 'assume');
    await expect(consoleService.act(JULIANA, id, 'assume')).rejects.toMatchObject({ code: 'not_assigned' });
    expect((await consoleService.snapshot(id)).conversation.assignedAnalystId).toBe(RAFAEL.employeeId);
  });

  it('painel lateral: o analista vê os chamados do funcionário, abertos primeiro', async () => {
    const id = await transferAna();
    const { tickets } = await consoleService.tickets(RAFAEL, id);
    const ids = tickets.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['INC-20311', 'INC-20298', 'REQ-10442']));
    expect(tickets.find((t) => t.id === 'INC-20311')?.overdue).toBe(true);
    const firstClosed = tickets.findIndex((t) => t.status === 'resolvido' || t.status === 'fechado');
    if (firstClosed >= 0) {
      expect(tickets.slice(firstClosed).every((t) => t.status === 'resolvido' || t.status === 'fechado')).toBe(true);
    }
  });

  it('conversa inexistente: 404', async () => {
    await expect(consoleService.snapshot('c_nao_existe')).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });
});
