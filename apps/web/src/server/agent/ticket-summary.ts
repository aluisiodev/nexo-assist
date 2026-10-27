import type { TicketView } from '@nexo/domain';
import type { TicketSummary } from '../../lib/chat';

/** Converte o chamado do service desk no formato dos cards do chat. */
export function toTicketSummary(t: TicketView): TicketSummary {
  return {
    id: t.id,
    type: t.type,
    title: t.title,
    description: t.description,
    category: t.category,
    priority: t.priority,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    dueAt: t.sla.dueAt,
    overdue: t.sla.overdue,
    slaTarget: t.sla.target,
  };
}
