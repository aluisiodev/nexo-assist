import type { Priority, TicketStatus } from '@nexo/domain';

const TZ = 'America/Sao_Paulo';

const dayMonth = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: TZ });
const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

/** "16 out" */
export const formatDayMonth = (iso: string): string =>
  dayMonth.format(new Date(iso)).replace('.', '').replace(' de ', ' ');

/** "14:20" */
export const formatTime = (iso: string): string => time.format(new Date(iso));

/** "16 out, 14:20" */
export const formatDateTime = (iso: string): string => `${formatDayMonth(iso)}, ${formatTime(iso)}`;

/** "agora", "há 25 min", "há 3 h", "há 5 dias" */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'há 1 dia' : `há ${days} dias`;
}

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

/** Cor do ponto de status (mesmas cores do protótipo). */
export const TICKET_STATUS_DOT: Record<TicketStatus, string> = {
  aguardando_analista: 'bg-warning',
  em_andamento: 'bg-primary',
  aguardando_usuario: 'bg-violet',
  aprovado: 'bg-success',
  resolvido: 'bg-success',
  fechado: 'bg-ink-3/40',
};

export const TICKET_STATUS_TEXT: Record<TicketStatus, string> = {
  aguardando_analista: 'text-warning-text',
  em_andamento: 'text-primary-text',
  aguardando_usuario: 'text-violet-text',
  aprovado: 'text-success-text',
  resolvido: 'text-success-text',
  fechado: 'text-ink-3',
};

export const PRIORITY_DOT: Record<Priority, string> = {
  critica: 'bg-danger',
  alta: 'bg-warning',
  media: 'bg-ink/40',
  baixa: 'bg-ink/20',
};
