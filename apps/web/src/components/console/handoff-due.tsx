import { Clock } from 'lucide-react';
import type { HandoffInfo } from '@/lib/console';
import { formatDayMonth, formatTime } from '@/lib/format';

const sameDay = (a: Date, b: Date) => formatDayMonth(a.toISOString()) === formatDayMonth(b.toISOString());

/** "responder até 14:20" ou "atrasada há 12 min" (prazo da transferência, Anexo A). */
export function HandoffDue({ handoff, now, className = '' }: { handoff: HandoffInfo; now: Date; className?: string }) {
  const due = new Date(handoff.dueAt);
  const late = due.getTime() < now.getTime();
  const when = sameDay(due, now)
    ? formatTime(handoff.dueAt)
    : `${formatDayMonth(handoff.dueAt)}, ${formatTime(handoff.dueAt)}`;
  let text = `responder até ${when}`;
  if (late) {
    const minutes = Math.round((now.getTime() - due.getTime()) / 60_000);
    text = minutes < 60 ? `atrasada há ${minutes} min` : `atrasada há ${Math.round(minutes / 60)} h`;
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-[12px] ${late ? 'font-semibold text-danger-text' : 'text-ink-3'} ${className}`}
    >
      <Clock className="size-3" aria-hidden="true" />
      {text}
    </span>
  );
}
