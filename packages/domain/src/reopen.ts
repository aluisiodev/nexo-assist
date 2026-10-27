import type { Ticket } from './types';

/** Chamados resolvidos há até 7 dias podem ser reabertos (Anexo A). */
export const REOPEN_WINDOW_DAYS = 7;

export function canReopen(ticket: Pick<Ticket, 'status' | 'resolvedAt'>, now: Date): boolean {
  if (ticket.status !== 'resolvido' || ticket.resolvedAt === null) return false;
  const elapsedMs = now.getTime() - new Date(ticket.resolvedAt).getTime();
  return elapsedMs >= 0 && elapsedMs <= REOPEN_WINDOW_DAYS * 24 * 60 * 60_000;
}
