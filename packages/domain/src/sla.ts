import { addBusinessMinutes, businessMinutesPerDay, NEXO_CALENDAR, type BusinessCalendar } from './business-time';
import { SLA_RUNNING_STATUSES, type Priority, type SlaInfo, type Ticket } from './types';

/**
 * Prazos do Anexo A. O prazo vale para a primeira resposta e para cada atualização
 * do suporte; passado o prazo, o chamado está vencido.
 *
 * "Crítica" usa tempo corrido porque há plantão 24 horas para chamados críticos.
 */
export interface SlaRule {
  readonly clock: 'calendar' | 'business';
  readonly minutes: number;
  readonly label: string;
}

export const SLA_POLICY: Record<Priority, SlaRule> = {
  critica: { clock: 'calendar', minutes: 60, label: '1 hora' },
  alta: { clock: 'business', minutes: 4 * 60, label: '4 horas úteis' },
  media: { clock: 'business', minutes: 3 * businessMinutesPerDay(), label: '3 dias úteis' },
  baixa: { clock: 'business', minutes: 5 * businessMinutesPerDay(), label: '5 dias úteis' },
};

/** Quando vence o prazo de um chamado com esta prioridade, contado a partir de `reference`. */
export function computeDueAt(priority: Priority, reference: Date, cal: BusinessCalendar = NEXO_CALENDAR): Date {
  const rule = SLA_POLICY[priority];
  return rule.clock === 'calendar'
    ? new Date(reference.getTime() + rule.minutes * 60_000)
    : addBusinessMinutes(reference, rule.minutes, cal);
}

/** Situação do prazo de um chamado agora. */
export function computeSla(
  ticket: Pick<Ticket, 'priority' | 'status' | 'slaReferenceAt'>,
  now: Date,
  cal: BusinessCalendar = NEXO_CALENDAR,
): SlaInfo {
  const target = SLA_POLICY[ticket.priority].label;
  if (!SLA_RUNNING_STATUSES.includes(ticket.status)) {
    return { dueAt: null, overdue: false, target, paused: true };
  }
  const dueAt = computeDueAt(ticket.priority, new Date(ticket.slaReferenceAt), cal);
  return { dueAt: dueAt.toISOString(), overdue: now.getTime() > dueAt.getTime(), target, paused: false };
}
