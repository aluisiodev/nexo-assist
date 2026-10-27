import { describe, expect, it } from 'vitest';
import { agentCanRespond, analystCanWrite, employeeCanSend, transition, type ConversationState } from '../src';

const agent: ConversationState = { status: 'agent', assignedAnalystId: null };
const waiting: ConversationState = { status: 'waiting_analyst', assignedAnalystId: null };
const withRafael: ConversationState = { status: 'with_analyst', assignedAnalystId: 'rafael' };
const closed: ConversationState = { status: 'closed', assignedAnalystId: null };

describe('máquina de estados da conversa', () => {
  it('transfere do agent para a fila', () => {
    expect(transition(agent, { type: 'transfer', reason: 'overdue', summary: 'x' })).toEqual({
      ok: true,
      next: { status: 'waiting_analyst', assignedAnalystId: null },
    });
  });

  it('não transfere de novo o que já está com a equipe', () => {
    expect(transition(waiting, { type: 'transfer', reason: 'employee_request', summary: 'x' })).toMatchObject({
      ok: false,
    });
  });

  it('analista assume da fila ou direto do agent', () => {
    expect(transition(waiting, { type: 'assume', analystId: 'rafael' })).toMatchObject({ ok: true, next: withRafael });
    expect(transition(agent, { type: 'assume', analystId: 'rafael' })).toMatchObject({ ok: true, next: withRafael });
  });

  it('dois analistas não assumem a mesma conversa', () => {
    expect(transition(withRafael, { type: 'assume', analystId: 'juliana' })).toMatchObject({
      ok: false,
      code: 'not_assigned',
    });
    expect(transition(withRafael, { type: 'assume', analystId: 'rafael' })).toMatchObject({ ok: true });
  });

  it('só quem assumiu devolve ou encerra', () => {
    expect(transition(withRafael, { type: 'return_to_agent', analystId: 'juliana' })).toMatchObject({ ok: false });
    expect(transition(withRafael, { type: 'return_to_agent', analystId: 'rafael' })).toMatchObject({
      ok: true,
      next: { status: 'agent', assignedAnalystId: null },
    });
    expect(transition(withRafael, { type: 'close', by: 'analyst', analystId: 'juliana' })).toMatchObject({ ok: false });
    expect(transition(withRafael, { type: 'close', by: 'analyst', analystId: 'rafael' })).toMatchObject({ ok: true });
  });

  it('devolver da fila também é permitido (analista decide que o agent resolve)', () => {
    expect(transition(waiting, { type: 'return_to_agent', analystId: 'juliana' })).toMatchObject({ ok: true });
  });

  it('conversa encerrada não muda mais', () => {
    expect(transition(closed, { type: 'assume', analystId: 'rafael' })).toMatchObject({
      ok: false,
      code: 'already_closed',
    });
  });

  it('agent fica mudo fora do estado "agent"', () => {
    expect(agentCanRespond('agent')).toBe(true);
    expect(agentCanRespond('waiting_analyst')).toBe(false);
    expect(agentCanRespond('with_analyst')).toBe(false);
  });

  it('limite de 30 mensagens por sessão', () => {
    expect(employeeCanSend('agent', 29)).toEqual({ ok: true });
    expect(employeeCanSend('agent', 30)).toEqual({ ok: false, reason: 'limit_reached' });
    expect(employeeCanSend('closed', 0)).toEqual({ ok: false, reason: 'closed' });
  });

  it('só o analista que assumiu escreve', () => {
    expect(analystCanWrite(withRafael, 'rafael')).toBe(true);
    expect(analystCanWrite(withRafael, 'juliana')).toBe(false);
    expect(analystCanWrite(waiting, 'rafael')).toBe(false);
  });
});
