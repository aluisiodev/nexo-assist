import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/lib/chat';
import { BasicResponder } from '@/server/agent/basic-responder';
import type { AgentContext } from '@/server/agent/types';
import type { Conversation } from '@/server/conversations/repository';
import { ANA, createServiceDesk, NOW } from './helpers';

const conversation = { id: 'c_test', employeeId: ANA.employeeId, status: 'agent' } as Conversation;

function ctx(text: string, history: Partial<ChatMessage>[] = []): AgentContext {
  const msgs = [...history, { role: 'employee' as const, text }].map((m, i): ChatMessage => ({
    id: `m${i}`,
    seq: i + 1,
    role: 'employee',
    authorName: null,
    text: '',
    blocks: [],
    trace: null,
    createdAt: NOW.toISOString(),
    ...m,
  }));
  return { conversation, user: ANA, history: msgs, text, messageId: `m-${text.length}`, now: NOW };
}

async function responder(opts?: { down?: boolean }) {
  const sd = await createServiceDesk(opts);
  return { r: new BasicResponder(sd.access), sd };
}

describe('modo básico (sem IA)', () => {
  it('lista os chamados abertos para escolher, com a ação visível', async () => {
    const { r } = await responder();
    const reply = await r.respond(ctx('Qual o status do meu chamado?'));
    const m = reply.messages[0]!;
    expect(m.text).toMatch(/3 chamados abertos/);
    expect(m.blocks?.[0]).toMatchObject({ type: 'ticket_list', selectable: true });
    expect(m.trace.steps.map((s) => s.label)).toContain('consultou seus chamados');
  });

  it('mostra o chamado escolhido e oferece analista quando está vencido', async () => {
    const { r } = await responder();
    const m = (await r.respond(ctx('INC-20311 · Notebook lento após atualização'))).messages[0]!;
    expect(m.blocks?.[0]).toMatchObject({ type: 'ticket_card', ticket: { id: 'INC-20311', overdue: true } });
    expect(m.blocks?.[1]).toMatchObject({ type: 'quick_replies' });
    expect(m.trace.steps.map((s) => s.label)).toEqual(['consultou o INC-20311', 'calculou o prazo']);
  });

  it('não mostra chamado de outra pessoa', async () => {
    const { r } = await responder();
    const m = (await r.respond(ctx('E o INC-20330?'))).messages[0]!;
    expect(m.text).toMatch(/Não encontrei/);
    expect(m.blocks ?? []).toEqual([]);
  });

  it('transfere com resumo e leva o chamado vencido para o N2', async () => {
    const { r } = await responder();
    const reply = await r.respond(
      ctx('Falar com um analista', [
        { role: 'agent', text: 'Está vencido', blocks: [] },
        { role: 'employee', text: 'INC-20311 · Notebook lento' },
      ]),
    );
    expect(reply.handoff).toMatchObject({ reason: 'overdue', group: 'N2', ticketId: 'INC-20311' });
    expect(reply.handoff?.summary).toMatch(/INC-20311/);
  });

  it('busca na central de ajuda', async () => {
    const { r } = await responder();
    const m = (await r.respond(ctx('Meu notebook não conecta na VPN. Aparece o erro 809.'))).messages[0]!;
    expect(m.blocks?.[0]).toMatchObject({ type: 'article', id: 'kb-vpn-809' });
  });

  it('complementa um chamado no formato "número: informação"', async () => {
    const { r, sd } = await responder();
    const m = (await r.respond(ctx('INC-20311: agora também trava ao abrir o Excel'))).messages[0]!;
    expect(m.text).toMatch(/adicionei a informação/);
    const events = await sd.client.forActor('emp-ana').getTicketEvents('INC-20311');
    expect(events.at(-1)).toMatchObject({
      kind: 'comment',
      actorType: 'agent',
      body: 'agora também trava ao abrir o Excel',
    });
  });

  it('redireciona assuntos fora de TI', async () => {
    const { r } = await responder();
    const m = (await r.respond(ctx('Quando cai o vale refeição?'))).messages[0]!;
    expect(m.trace.intent).toBe('fora_do_escopo');
  });

  it('com o sistema de chamados fora do ar, explica e registra as tentativas', async () => {
    const { r } = await responder({ down: true });
    const m = (await r.respond(ctx('Qual o status do meu chamado?'))).messages[0]!;
    expect(m.text).toMatch(/fora do ar/);
    expect(m.trace.steps.filter((s) => s.status === 'error').length).toBeGreaterThanOrEqual(3);
  });
});
