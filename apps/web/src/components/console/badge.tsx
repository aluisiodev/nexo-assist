import type { BadgeTone, QueueBadge } from '@/lib/console';

const TONES: Record<BadgeTone, { pill: string; dot: string }> = {
  danger: { pill: 'bg-danger-soft text-danger-text', dot: 'bg-danger' },
  warning: { pill: 'bg-warning-soft text-warning-text', dot: 'bg-warning' },
  violet: { pill: 'bg-violet-soft text-violet-text', dot: 'bg-violet' },
  primary: { pill: 'bg-primary-soft text-primary-text', dot: 'bg-primary' },
  success: { pill: 'bg-success-soft text-success-text', dot: 'bg-success' },
  muted: { pill: 'bg-desk text-ink-3', dot: 'bg-ink-3/50' },
};

/** Pílula de status de uma conversa ("Transferida", "Agent pediu ajuda · confiança 41%"…). */
export function StatusBadge({ badge, size = 'sm' }: { badge: QueueBadge; size?: 'sm' | 'md' }) {
  const tone = TONES[badge.tone];
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full font-semibold ${tone.pill} ${
        size === 'md' ? 'px-2.5 py-[5px] text-[12.5px]' : 'px-2 py-0.5 text-[11.5px]'
      }`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
      <span className="truncate">{badge.label}</span>
    </span>
  );
}
