import { NEXO_CALENDAR, type BusinessCalendar } from './business-time';
import { canReopen } from './reopen';
import { computeSla } from './sla';
import type { Ticket, TicketView } from './types';

/** Acrescenta ao chamado os campos derivados (prazo e possibilidade de reabrir). */
export function toTicketView(ticket: Ticket, now: Date, cal: BusinessCalendar = NEXO_CALENDAR): TicketView {
  return { ...ticket, sla: computeSla(ticket, now, cal), canReopen: canReopen(ticket, now) };
}
