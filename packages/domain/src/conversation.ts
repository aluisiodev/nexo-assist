import { z } from 'zod';
import { addBusinessMinutes, NEXO_CALENDAR, type BusinessCalendar } from './business-time';

/**
 * Estados de uma conversa do chat (não confundir com o status de um chamado).
 *
 *   agent ──transfer──▶ waiting_analyst ──assume──▶ with_analyst
 *     ▲                     │                          │
 *     └────────return───────┴──────────return──────────┘
 *   (qualquer estado aberto) ──close──▶ closed
 *
 * Regra do PRD: enquanto a conversa está com um analista (ou aguardando um), o agent
 * não responde.
 */
export const CONVERSATION_STATUSES = ['agent', 'waiting_analyst', 'with_analyst', 'closed'] as const;
export const ConversationStatusSchema = z.enum(CONVERSATION_STATUSES);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  agent: 'Agent atendendo',
  waiting_analyst: 'Aguardando atendente',
  with_analyst: 'Analista atendendo',
  closed: 'Encerrada',
};

/** Por que a conversa foi para um analista (Anexo A: transferência). */
export const HANDOFF_REASONS = ['employee_request', 'critical', 'overdue', 'low_confidence', 'message_limit'] as const;
export const HandoffReasonSchema = z.enum(HANDOFF_REASONS);
export type HandoffReason = z.infer<typeof HandoffReasonSchema>;

export const HANDOFF_REASON_LABELS: Record<HandoffReason, string> = {
  employee_request: 'Funcionário pediu um analista',
  critical: 'Caso crítico',
  overdue: 'Chamado com prazo vencido',
  low_confidence: 'Agent sem segurança para decidir',
  message_limit: 'Limite de mensagens da sessão',
};

export const CLOSED_BY = ['agent', 'analyst', 'employee'] as const;
export const ClosedBySchema = z.enum(CLOSED_BY);
export type ClosedBy = z.infer<typeof ClosedBySchema>;

/**
 * Limite do PRD: 30 mensagens do funcionário por sessão (conversa). Conta só as mensagens
 * respondidas pelo assistente (o que gasta IA); a conversa com um analista não tem limite.
 */
export const MAX_EMPLOYEE_MESSAGES_PER_SESSION = 30;

export interface ConversationState {
  readonly status: ConversationStatus;
  readonly assignedAnalystId: string | null;
}

export type ConversationAction =
  | { readonly type: 'transfer'; readonly reason: HandoffReason; readonly summary: string }
  | { readonly type: 'assume'; readonly analystId: string }
  | { readonly type: 'return_to_agent'; readonly analystId: string }
  | { readonly type: 'close'; readonly by: ClosedBy; readonly analystId?: string };

export type TransitionResult =
  | { readonly ok: true; readonly next: ConversationState }
  | { readonly ok: false; readonly code: TransitionErrorCode; readonly message: string };

export type TransitionErrorCode = 'invalid_transition' | 'not_assigned' | 'already_closed';

const fail = (code: TransitionErrorCode, message: string): TransitionResult => ({ ok: false, code, message });

/** Calcula o próximo estado, ou explica por que a ação não é permitida agora. */
export function transition(state: ConversationState, action: ConversationAction): TransitionResult {
  if (state.status === 'closed') return fail('already_closed', 'A conversa já foi encerrada.');

  switch (action.type) {
    case 'transfer':
      if (state.status !== 'agent') {
        return fail('invalid_transition', 'A conversa já está com a equipe de atendimento.');
      }
      return { ok: true, next: { status: 'waiting_analyst', assignedAnalystId: null } };

    case 'assume':
      if (state.status === 'with_analyst') {
        return state.assignedAnalystId === action.analystId
          ? { ok: true, next: state }
          : fail('not_assigned', 'Outro analista já assumiu esta conversa.');
      }
      // Pode assumir da fila ou direto de uma conversa com o agent.
      return { ok: true, next: { status: 'with_analyst', assignedAnalystId: action.analystId } };

    case 'return_to_agent':
      if (state.status === 'agent') return fail('invalid_transition', 'A conversa já está com o agent.');
      if (state.status === 'with_analyst' && state.assignedAnalystId !== action.analystId) {
        return fail('not_assigned', 'Só o analista que assumiu pode devolver a conversa.');
      }
      return { ok: true, next: { status: 'agent', assignedAnalystId: null } };

    case 'close':
      if (action.by === 'analyst' && state.status === 'with_analyst' && state.assignedAnalystId !== action.analystId) {
        return fail('not_assigned', 'Só o analista que assumiu pode encerrar a conversa.');
      }
      return { ok: true, next: { status: 'closed', assignedAnalystId: state.assignedAnalystId } };
  }
}

/** O agent só responde quando a conversa está com ele. */
export const agentCanRespond = (status: ConversationStatus): boolean => status === 'agent';

/**
 * Pode o funcionário mandar mais uma mensagem? Só não pode em conversa encerrada.
 * O limite de mensagens vale para o assistente (ver `nextRoute`), nunca para a conversa
 * com um analista: ninguém precisa recomeçar a conversa no meio de um atendimento.
 */
export function employeeCanSend(
  status: ConversationStatus,
): { readonly ok: true } | { readonly ok: false; readonly reason: 'closed' } {
  return status === 'closed' ? { ok: false, reason: 'closed' } : { ok: true };
}

/**
 * Para onde vai a próxima mensagem do funcionário:
 * - `agent`: o assistente responde (e a mensagem conta no limite da sessão);
 * - `limit_handoff`: o limite com o assistente acabou, então a conversa vai para um analista;
 * - `team`: a conversa está com (ou aguardando) um analista; não conta no limite.
 */
export function nextRoute(status: ConversationStatus, agentMessageCount: number): 'agent' | 'limit_handoff' | 'team' {
  if (!agentCanRespond(status)) return 'team';
  return agentMessageCount >= MAX_EMPLOYEE_MESSAGES_PER_SESSION ? 'limit_handoff' : 'agent';
}

/**
 * Até quando um analista deve falar com o funcionário depois da transferência.
 * Crítico segue o plantão (1 hora corrida); o resto, 2 horas úteis.
 */
export function handoffDueAt(reason: HandoffReason, at: Date, cal: BusinessCalendar = NEXO_CALENDAR): Date {
  return reason === 'critical' ? new Date(at.getTime() + 60 * 60_000) : addBusinessMinutes(at, 120, cal);
}

export const handoffTargetLabel = (reason: HandoffReason): string =>
  reason === 'critical' ? '1 hora' : '2 horas úteis';

/** Só o analista que assumiu escreve na conversa. */
export const analystCanWrite = (state: ConversationState, analystId: string): boolean =>
  state.status === 'with_analyst' && state.assignedAnalystId === analystId;
