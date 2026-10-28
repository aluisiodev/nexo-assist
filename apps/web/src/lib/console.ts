import {
  ClosedBySchema,
  ConversationStatusSchema,
  HANDOFF_REASON_LABELS,
  HandoffReasonSchema,
  SupportGroupSchema,
  type SupportGroup,
} from '@nexo/domain';
import { z } from 'zod';
import { ChatMessageSchema, TicketSummarySchema } from './chat';

/**
 * Contrato do console do analista (Telas 4 e 5), compartilhado entre servidor e
 * navegador. Os rótulos da fila são derivados aqui, por funções puras e testadas.
 */

export const QUEUE_FILTERS = ['todas', 'para_voce', 'com_agent', 'minhas'] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

export const QUEUE_FILTER_LABELS: Record<QueueFilter, string> = {
  todas: 'Todas',
  para_voce: 'Para você',
  com_agent: 'Com o agent',
  minhas: 'Minhas',
};

/** Dados da transferência: por que, para quem, com que segurança e até quando responder. */
export const HandoffInfoSchema = z.object({
  reason: HandoffReasonSchema,
  group: SupportGroupSchema,
  confidence: z.number().nullable(),
  at: z.string(),
  /** Até quando um analista deve falar com o funcionário (1 h no crítico, 2 h úteis no resto). */
  dueAt: z.string(),
  ticketId: z.string().nullable(),
  summary: z.string(),
});
export type HandoffInfo = z.infer<typeof HandoffInfoSchema>;

export const QueueItemSchema = z.object({
  id: z.string(),
  employee: z.object({ id: z.string(), name: z.string(), email: z.string(), department: z.string() }),
  status: ConversationStatusSchema,
  assignedAnalystId: z.string().nullable(),
  assignedAnalystName: z.string().nullable(),
  handoff: HandoffInfoSchema.nullable(),
  closedBy: ClosedBySchema.nullable(),
  closedAt: z.string().nullable(),
  lastMessageAt: z.string(),
  preview: z.string().nullable(),
  employeeMessageCount: z.number().int(),
  messageLimit: z.number().int(),
  createdAt: z.string(),
});
export type QueueItem = z.infer<typeof QueueItemSchema>;

export const QueueSchema = z.object({ items: z.array(QueueItemSchema) });
export type Queue = z.infer<typeof QueueSchema>;

export const ConsoleSnapshotSchema = z.object({
  conversation: QueueItemSchema,
  messages: z.array(ChatMessageSchema),
});
export type ConsoleSnapshot = z.infer<typeof ConsoleSnapshotSchema>;

export const EmployeeTicketsSchema = z.object({ tickets: z.array(TicketSummarySchema) });
export type EmployeeTickets = z.infer<typeof EmployeeTicketsSchema>;

export const CONSOLE_ACTIONS = ['assume', 'return', 'close'] as const;
export type ConsoleAction = (typeof CONSOLE_ACTIONS)[number];

export const AnalystMessageInputSchema = z.object({
  text: z.string().trim().min(1, 'Escreva uma mensagem.').max(2000, 'Mensagem muito longa (máx. 2000 caracteres).'),
});

/** Quem está olhando a fila (os filtros "Para você" e "Minhas" dependem disso). */
export interface Viewer {
  readonly id: string;
  readonly group: SupportGroup | null;
}

export function matchesFilter(item: QueueItem, filter: QueueFilter, viewer: Viewer): boolean {
  switch (filter) {
    case 'todas':
      return true;
    case 'para_voce':
      return item.status === 'waiting_analyst' && (viewer.group === null || item.handoff?.group === viewer.group);
    case 'com_agent':
      return item.status === 'agent';
    case 'minhas':
      return item.status === 'with_analyst' && item.assignedAnalystId === viewer.id;
  }
}

export type BadgeTone = 'danger' | 'warning' | 'violet' | 'primary' | 'success' | 'muted';

export interface QueueBadge {
  readonly label: string;
  readonly tone: BadgeTone;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Rótulo de status de uma conversa na fila, do ponto de vista de quem olha. */
export function queueBadge(item: QueueItem, viewer: Viewer): QueueBadge {
  switch (item.status) {
    case 'waiting_analyst': {
      const h = item.handoff;
      if (h?.reason === 'low_confidence') {
        return {
          label: h.confidence !== null ? `Agent pediu ajuda · confiança ${pct(h.confidence)}` : 'Agent pediu ajuda',
          tone: 'warning',
        };
      }
      if (h?.reason === 'critical') return { label: 'Transferida · caso crítico', tone: 'danger' };
      if (h?.reason === 'overdue') return { label: 'Transferida · chamado vencido', tone: 'violet' };
      return { label: 'Transferida', tone: 'violet' };
    }
    case 'with_analyst':
      return item.assignedAnalystId === viewer.id
        ? { label: 'Com você', tone: 'primary' }
        : { label: `Com ${item.assignedAnalystName ?? 'outro analista'}`, tone: 'muted' };
    case 'agent':
      return item.handoff
        ? { label: 'Com o agent · devolvida', tone: 'success' }
        : { label: 'Com o agent', tone: 'success' };
    case 'closed':
      if (item.closedBy === 'analyst') {
        return { label: `Encerrada por ${item.assignedAnalystName ?? 'analista'}`, tone: 'muted' };
      }
      return item.handoff
        ? { label: 'Encerrada pelo funcionário', tone: 'muted' }
        : { label: 'Resolvida pelo agent', tone: 'success' };
  }
}

export const handoffReasonLabel = (item: QueueItem): string | null =>
  item.handoff ? HANDOFF_REASON_LABELS[item.handoff.reason] : null;

/**
 * Ordem da fila: quem espera um analista vem primeiro (crítico antes, depois o prazo
 * mais curto); depois quem está em atendimento, com o agent e, por fim, as encerradas.
 */
export function compareQueueItems(a: QueueItem, b: QueueItem): number {
  const rank = (i: QueueItem) =>
    i.status === 'waiting_analyst'
      ? i.handoff?.reason === 'critical'
        ? 0
        : 1
      : i.status === 'with_analyst'
        ? 2
        : i.status === 'agent'
          ? 3
          : 4;
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  if (a.status === 'waiting_analyst' && a.handoff && b.handoff) return a.handoff.dueAt.localeCompare(b.handoff.dueAt);
  if (a.status === 'closed') return (b.closedAt ?? '').localeCompare(a.closedAt ?? '');
  return b.lastMessageAt.localeCompare(a.lastMessageAt);
}

/** O analista pode fazer esta ação agora? (A máquina de estados no servidor é quem decide.) */
export function allowedActions(item: QueueItem, viewer: Viewer): Record<ConsoleAction | 'reply', boolean> {
  const mine = item.status === 'with_analyst' && item.assignedAnalystId === viewer.id;
  const free = item.status === 'agent' || item.status === 'waiting_analyst';
  return {
    assume: free,
    return: item.status === 'waiting_analyst' || mine,
    close: free || mine,
    reply: mine,
  };
}
