'use client';

import { Inbox } from 'lucide-react';
import {
  matchesFilter,
  QUEUE_FILTER_LABELS,
  QUEUE_FILTERS,
  queueBadge,
  type QueueFilter,
  type QueueItem,
  type Viewer,
} from '@/lib/console';
import { formatRelative, initials } from '@/lib/format';
import { StatusBadge } from './badge';
import { HandoffDue } from './handoff-due';

interface Props {
  readonly items: readonly QueueItem[];
  readonly filter: QueueFilter;
  readonly onFilter: (f: QueueFilter) => void;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly viewer: Viewer;
  readonly now: Date;
  readonly className?: string;
}

const EMPTY: Record<QueueFilter, string> = {
  todas: 'Nenhuma conversa nas últimas 24 horas.',
  para_voce: 'Nenhuma conversa aguardando o seu grupo. Quando o agent transferir, ela aparece aqui.',
  com_agent: 'Nenhuma conversa com o agent agora.',
  minhas: 'Você não está atendendo nenhuma conversa.',
};

/** Tela 4: fila de conversas com filtros e o status de cada uma. */
export function QueuePane({ items, filter, onFilter, selectedId, onSelect, viewer, now, className = '' }: Props) {
  const counts = Object.fromEntries(
    QUEUE_FILTERS.map((f) => [f, items.filter((i) => matchesFilter(i, f, viewer)).length]),
  ) as Record<QueueFilter, number>;
  const visible = items.filter((i) => matchesFilter(i, filter, viewer));

  return (
    <section className={`min-h-0 flex-col border-rule lg:w-[360px] lg:shrink-0 lg:border-r ${className}`}>
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-rule px-5">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-[15px] font-semibold text-ink">Fila de atendimento</h1>
          <p className="truncate text-[12px] text-ink-3">
            {viewer.group ? `Suporte ${viewer.group}` : 'Service desk'} · atualiza sozinha
          </p>
        </div>
      </header>

      <div className="grid shrink-0 grid-cols-4 gap-1 border-b border-rule px-3 py-2" role="group" aria-label="Filtros">
        {QUEUE_FILTERS.map((f) => {
          const active = f === filter;
          const urgent = f === 'para_voce' && counts[f] > 0;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={active}
              onClick={() => onFilter(f)}
              // Rótulo antes do número no DOM (nome acessível "Para você 2"); na tela, o número fica em cima.
              className={`flex flex-col-reverse items-center gap-1 rounded-lg px-1 py-1.5 text-center ${
                active ? 'bg-primary-soft text-primary-text' : 'text-ink-2 hover:bg-desk'
              }`}
            >
              <span className={`text-[11.5px] leading-tight ${active ? 'font-semibold' : 'font-medium'}`}>
                {QUEUE_FILTER_LABELS[f]}
              </span>
              <span
                className={`text-[16px] font-semibold leading-none ${urgent ? 'text-cta' : active ? '' : 'text-ink'}`}
              >
                {counts[f]}
              </span>
            </button>
          );
        })}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Conversas">
        {visible.length === 0 && (
          <li className="flex flex-col items-center gap-2 px-8 py-12 text-center text-[13px] text-ink-3">
            <Inbox className="size-5" aria-hidden="true" />
            {EMPTY[filter]}
          </li>
        )}
        {visible.map((item) => (
          <li key={item.id} className="border-b border-rule">
            <QueueRow
              item={item}
              viewer={viewer}
              now={now}
              selected={item.id === selectedId}
              onSelect={() => onSelect(item.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function QueueRow({
  item,
  viewer,
  now,
  selected,
  onSelect,
}: {
  item: QueueItem;
  viewer: Viewer;
  now: Date;
  selected: boolean;
  onSelect: () => void;
}) {
  const badge = queueBadge(item, viewer);
  const waiting = item.status === 'waiting_analyst';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`flex w-full gap-3 px-5 py-3.5 text-left transition-colors ${
        selected ? 'bg-primary-soft' : 'hover:bg-desk'
      } ${item.status === 'closed' ? 'opacity-75' : ''}`}
    >
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-full text-[12px] font-bold ${
          waiting ? 'bg-violet-soft text-violet-text' : 'bg-desk text-ink-2'
        }`}
        aria-hidden="true"
      >
        {initials(item.employee.name)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[13.5px] font-semibold text-ink">{item.employee.name}</span>
          <span className="truncate text-[12px] text-ink-3">{item.employee.department}</span>
          <span className="ml-auto shrink-0 text-[11.5px] text-ink-3">{formatRelative(item.lastMessageAt, now)}</span>
        </span>
        <StatusBadge badge={badge} />
        {/* Quem espera um analista mostra o resumo do agent; as demais, a última fala. */}
        {(waiting && item.handoff?.summary) || item.preview ? (
          <span className="line-clamp-2 text-[12.5px] leading-snug text-ink-2">
            {waiting && item.handoff?.summary ? item.handoff.summary : item.preview}
          </span>
        ) : null}
        {waiting && item.handoff && <HandoffDue handoff={item.handoff} now={now} />}
      </span>
    </button>
  );
}
