import { handoffDueAt, isOpenStatus, MAX_EMPLOYEE_MESSAGES_PER_SESSION } from '@nexo/domain';
import type { ServiceDeskClient } from '@nexo/service-desk-client';
import type { ChatMessage } from '../../lib/chat';
import {
  compareQueueItems,
  type ConsoleAction,
  type ConsoleSnapshot,
  type EmployeeTickets,
  type Queue,
  type QueueItem,
} from '../../lib/console';
import { toTicketSummary } from '../agent/ticket-summary';
import type { SessionUser } from '../auth/sessions';
import type { Conversation, ConversationRepository } from '../conversations/repository';
import { ConversationError, type ConversationService } from '../conversations/service';

export interface ConsoleServiceDeps {
  readonly repo: ConversationRepository;
  readonly conversations: ConversationService;
  /** Cliente do service desk sem "via agent": as consultas são feitas pelo analista. */
  readonly serviceDesk: ServiceDeskClient;
  readonly clock?: () => Date;
}

/** Encerradas há até 24 h continuam na fila ("Todas"), para consulta. */
const CLOSED_WINDOW_MS = 24 * 60 * 60_000;
const MAX_TICKETS = 12;

/**
 * Console do analista: fila, conversa com o registro das decisões do agent, chamados
 * do funcionário e as ações (assumir, responder, devolver, encerrar). As regras de
 * estado continuam no ConversationService e na máquina de estados do domínio.
 */
export class ConsoleService {
  private readonly repo: ConversationRepository;
  private readonly conversations: ConversationService;
  private readonly serviceDesk: ServiceDeskClient;
  private readonly clock: () => Date;

  constructor(deps: ConsoleServiceDeps) {
    this.repo = deps.repo;
    this.conversations = deps.conversations;
    this.serviceDesk = deps.serviceDesk;
    this.clock = deps.clock ?? (() => new Date());
  }

  async queue(): Promise<Queue> {
    const since = new Date(this.clock().getTime() - CLOSED_WINDOW_MS);
    const rows = await this.repo.listForConsole(since);
    return { items: rows.map(toQueueItem).sort(compareQueueItems) };
  }

  async snapshot(conversationId: string, afterSeq = 0): Promise<ConsoleSnapshot> {
    const conversation = await this.mustFind(conversationId);
    return {
      conversation: toQueueItem(conversation),
      messages: await this.repo.listMessages(conversation.id, afterSeq),
    };
  }

  /** Chamados do funcionário da conversa (abertos primeiro), vistos pelo analista. */
  async tickets(analyst: SessionUser, conversationId: string): Promise<EmployeeTickets> {
    const conversation = await this.mustFind(conversationId);
    const tickets = await this.serviceDesk
      .forActor(analyst.employeeId)
      .listTickets({ status: 'all', requesterId: conversation.employeeId });
    const sorted = [...tickets].sort(
      (a, b) =>
        Number(isOpenStatus(b.status)) - Number(isOpenStatus(a.status)) || b.updatedAt.localeCompare(a.updatedAt),
    );
    return { tickets: sorted.slice(0, MAX_TICKETS).map(toTicketSummary) };
  }

  async act(analyst: SessionUser, conversationId: string, action: ConsoleAction): Promise<ConsoleSnapshot> {
    if (action === 'assume') await this.conversations.assume(analyst, conversationId);
    else if (action === 'return') await this.conversations.returnToAgent(analyst, conversationId);
    else await this.conversations.closeByAnalyst(analyst, conversationId);
    return this.snapshot(conversationId);
  }

  async reply(analyst: SessionUser, conversationId: string, text: string): Promise<ChatMessage> {
    return this.conversations.sendAnalystMessage(analyst, conversationId, text);
  }

  private async mustFind(id: string): Promise<Conversation> {
    const c = await this.repo.findById(id);
    if (!c) throw new ConversationError('not_found', 'Conversa não encontrada.', 404);
    return c;
  }
}

export function toQueueItem(c: Conversation): QueueItem {
  return {
    id: c.id,
    employee: { id: c.employeeId, name: c.employeeName, email: c.employeeEmail, department: c.employeeDepartment },
    status: c.status,
    assignedAnalystId: c.assignedAnalystId,
    assignedAnalystName: c.assignedAnalystName,
    handoff:
      c.handoffReason && c.handoffAt
        ? {
            reason: c.handoffReason,
            group: c.handoffGroup ?? 'N1',
            confidence: c.handoffConfidence,
            at: c.handoffAt,
            dueAt: handoffDueAt(c.handoffReason, new Date(c.handoffAt)).toISOString(),
            ticketId: c.handoffTicketId,
            summary: c.handoffSummary ?? '',
          }
        : null,
    closedBy: c.closedBy,
    closedAt: c.closedAt,
    lastMessageAt: c.lastMessageAt,
    preview: c.lastMessagePreview,
    employeeMessageCount: c.employeeMessageCount,
    messageLimit: MAX_EMPLOYEE_MESSAGES_PER_SESSION,
    createdAt: c.createdAt,
  };
}
