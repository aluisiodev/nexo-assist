import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentContext, AgentReply, AgentResponder } from '@/server/agent/types';
import type { ConversationRepository } from '@/server/conversations/repository';
import { ConversationService } from '@/server/conversations/service';
import { ANA, createConversationRepo, createServiceDesk, draftsFor, JULIANA, NOW, RAFAEL } from './helpers';

/** Responder de teste: devolve o que mandarmos e registra as chamadas. */
class FakeResponder implements AgentResponder {
  readonly name = 'fake';
  calls: AgentContext[] = [];
  next: AgentReply | Error = { messages: [{ text: 'ok', trace: { engine: 'fake', steps: [] } }] };
  async respond(ctx: AgentContext): Promise<AgentReply> {
    this.calls.push(ctx);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

let repo: ConversationRepository;
let responder: FakeResponder;
let service: ConversationService;

beforeEach(async () => {
  repo = await createConversationRepo();
  responder = new FakeResponder();
  const sd = await createServiceDesk();
  service = new ConversationService({
    repo,
    responder,
    serviceDesk: sd.access,
    drafts: draftsFor(repo),
    clock: () => NOW,
    log: () => {},
  });
});

describe('conversa do funcionário', () => {
  it('cria a conversa na primeira visita e a retoma depois ("continuar de onde parei")', async () => {
    const first = await service.getOrStart(ANA);
    await service.sendEmployeeMessage(ANA, 'oi');
    const again = await service.getOrStart(ANA);
    expect(again.id).toBe(first.id);
    const snap = await service.snapshotFor(ANA);
    expect(snap.messages.map((m) => m.role)).toEqual(['employee', 'agent']);
  });

  it('guarda a mensagem, chama o agent e conta só as mensagens do funcionário', async () => {
    const { conversation, messages } = await service.sendEmployeeMessage(ANA, 'Minha VPN não conecta');
    expect(messages.map((m) => m.role)).toEqual(['employee', 'agent']);
    expect(conversation.employeeMessageCount).toBe(1);
    expect(responder.calls[0]?.history.at(-1)?.text).toBe('Minha VPN não conecta');
  });

  it('falha do agent vira resposta honesta com opção de analista (o chat não quebra)', async () => {
    responder.next = new Error('provedor fora do ar');
    const { messages } = await service.sendEmployeeMessage(ANA, 'oi');
    const reply = messages.at(-1)!;
    expect(reply.role).toBe('agent');
    expect(reply.trace?.steps[0]?.status).toBe('error');
    expect(reply.blocks[0]).toMatchObject({ type: 'quick_replies' });
  });

  it('limite de 30 mensagens com o assistente: avisa, depois chama um analista (sem travar o chat)', async () => {
    for (let i = 0; i < 30; i++) await service.sendEmployeeMessage(ANA, `mensagem ${i}`);
    const conv = await service.getOrStart(ANA);
    expect(conv.employeeMessageCount).toBe(30);
    const last = (await service.snapshotFor(ANA)).messages.at(-1);
    expect(last).toMatchObject({ role: 'system' });
    expect(last?.text).toMatch(/próxima mensagem vai para um analista/);

    responder.calls = [];
    const over = await service.sendEmployeeMessage(ANA, 'mais uma');
    expect(responder.calls).toHaveLength(0); // não gastou IA
    expect(over.conversation).toMatchObject({ status: 'waiting_analyst', handoffReason: 'message_limit' });
    expect(over.messages.map((m) => m.role)).toEqual(['employee', 'system', 'system']);

    const snap = await service.startNew(ANA);
    expect(snap.conversation.employeeMessageCount).toBe(0);
  });

  it('mensagens para o analista não contam no limite', async () => {
    const conv = await service.getOrStart(ANA);
    await service.assume(RAFAEL, conv.id);
    for (let i = 0; i < 35; i++) await service.sendEmployeeMessage(ANA, `para o analista ${i}`);
    const after = await service.getOrStart(ANA);
    expect(after).toMatchObject({ status: 'with_analyst', employeeMessageCount: 0 });
  });
});

describe('transferência e atendimento pelo analista', () => {
  const handoffReply: AgentReply = {
    messages: [{ text: 'Encaminhei para o Suporte N2.', trace: { engine: 'fake', steps: [] } }],
    handoff: {
      reason: 'overdue',
      group: 'N2',
      summary: 'INC-20311 vencido; Ana pediu analista.',
      ticketId: 'INC-20311',
      confidence: 0.9,
    },
  };

  it('transfere, avisa na conversa e deixa o agent mudo', async () => {
    responder.next = handoffReply;
    const { conversation, messages } = await service.sendEmployeeMessage(ANA, 'Quero falar com um analista');
    expect(conversation.status).toBe('waiting_analyst');
    expect(messages.at(-1)).toMatchObject({ role: 'system' });
    expect(messages.at(-1)?.text).toMatch(/Transferida para Suporte N2/);

    const stored = await service.getOrStart(ANA);
    expect(stored).toMatchObject({ handoffReason: 'overdue', handoffGroup: 'N2', handoffTicketId: 'INC-20311' });

    responder.calls = [];
    const later = await service.sendEmployeeMessage(ANA, 'Alguém aí?');
    expect(later.messages.map((m) => m.role)).toEqual(['employee']);
    expect(responder.calls).toHaveLength(0);
  });

  it('também transfere o chamado no service desk', async () => {
    const sd = await createServiceDesk();
    service = new ConversationService({
      repo,
      responder,
      serviceDesk: sd.access,
      drafts: draftsFor(repo),
      clock: () => NOW,
      log: () => {},
    });
    responder.next = handoffReply;
    await service.sendEmployeeMessage(ANA, 'Quero falar com um analista');
    const ticket = await sd.client.forActor('emp-ana').getTicket('INC-20311');
    expect(ticket.assignedGroup).toBe('N2');
  });

  it('analista assume (agent pausado), responde, e só ele pode devolver ou encerrar', async () => {
    responder.next = handoffReply;
    await service.sendEmployeeMessage(ANA, 'Quero falar com um analista');
    const conv = await service.getOrStart(ANA);

    const taken = await service.assume(RAFAEL, conv.id);
    expect(taken).toMatchObject({
      status: 'with_analyst',
      assignedAnalystId: RAFAEL.employeeId,
      assignedAnalystName: 'Rafael Lima',
    });

    await expect(service.assume(JULIANA, conv.id)).rejects.toMatchObject({ code: 'not_assigned' });
    await expect(service.sendAnalystMessage(JULIANA, conv.id, 'oi')).rejects.toMatchObject({ code: 'not_assigned' });

    const reply = await service.sendAnalystMessage(RAFAEL, conv.id, 'Oi, Ana! Aqui é o Rafael.');
    expect(reply).toMatchObject({ role: 'analyst', authorName: 'Rafael Lima' });

    const back = await service.returnToAgent(RAFAEL, conv.id);
    expect(back.status).toBe('agent');

    responder.next = { messages: [{ text: 'De nada!', trace: { engine: 'fake', steps: [] } }] };
    const { messages } = await service.sendEmployeeMessage(ANA, 'obrigada');
    expect(messages.map((m) => m.role)).toEqual(['employee', 'agent']);
  });

  it('controle de concorrência: uma versão desatualizada não sobrescreve a mudança de outro', async () => {
    const conv = await service.getOrStart(ANA);
    const updated = await repo.update(conv, { status: 'with_analyst', assignedAnalystId: 'x' }, NOW);
    expect(updated?.version).toBe(conv.version + 1);
    expect(await repo.update(conv, { status: 'closed' }, NOW)).toBeNull();
  });

  it('analista encerra; funcionário recebe uma conversa nova na próxima visita', async () => {
    const conv = await service.getOrStart(ANA);
    await service.assume(RAFAEL, conv.id);
    const closed = await service.closeByAnalyst(RAFAEL, conv.id);
    expect(closed).toMatchObject({ status: 'closed', closedBy: 'analyst' });
    const next = await service.getOrStart(ANA);
    expect(next.id).not.toBe(conv.id);
  });

  it('o chat aberto acompanha a conversa até o encerramento (e só se for do funcionário)', async () => {
    const conv = await service.getOrStart(ANA);
    await service.sendEmployeeMessage(ANA, 'oi');
    await service.assume(RAFAEL, conv.id);
    await service.closeByAnalyst(RAFAEL, conv.id);

    const followed = await service.snapshotFor(ANA, 0, conv.id);
    expect(followed.conversation).toMatchObject({ id: conv.id, status: 'closed' });
    expect(followed.messages.at(-1)?.text).toMatch(/Atendimento encerrado por Rafael Lima/);

    const other = { ...ANA, employeeId: 'emp-bruno', name: 'Bruno Tavares', email: 'bruno.tavares@nexo.com.br' };
    const stranger = await service.snapshotFor(other, 0, conv.id);
    expect(stranger.conversation.id).not.toBe(conv.id);
    expect(stranger.messages).toHaveLength(0);
  });
});
