'use client';

import { CATEGORY_LABELS, PRIORITY_LABELS, TICKET_STATUS_LABELS } from '@nexo/domain';
import { BookOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MessageBlock, QuickReply, TicketSummary } from '@/lib/chat';
import {
  formatDateTime,
  formatDayMonth,
  formatRelative,
  formatTime,
  PRIORITY_DOT,
  TICKET_STATUS_DOT,
  TICKET_STATUS_TEXT,
} from '@/lib/format';

const cardClass = 'overflow-hidden rounded-2xl border border-ink/9 bg-paper shadow-card';

interface BlockProps {
  readonly block: MessageBlock;
  /** Só a última mensagem do agent aceita cliques (opções e seleção). */
  readonly interactive: boolean;
  readonly onSend: (text: string) => void;
}

export function Block({ block, interactive, onSend }: BlockProps) {
  switch (block.type) {
    case 'ticket_list':
      return <TicketSelector tickets={block.tickets} interactive={interactive && block.selectable} onSend={onSend} />;
    case 'ticket_card':
      return <TicketCard ticket={block.ticket} />;
    case 'article':
      return <ArticleCard title={block.title} body={block.body} />;
    case 'quick_replies':
      return null; // renderizado dentro do balão (ver QuickReplies)
  }
}

export function QuickReplies({
  options,
  question,
  interactive,
  onSend,
}: {
  options: readonly QuickReply[];
  question?: string | undefined;
  interactive: boolean;
  onSend: (text: string) => void;
}) {
  const numbered = options.length > 1;
  return (
    <div className="flex flex-col gap-3">
      {question && <p className="text-[14.5px] font-semibold text-ink">{question}</p>}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Opções rápidas">
        {options.map((o, i) => (
          <button
            key={o.label}
            type="button"
            disabled={!interactive}
            onClick={() => onSend(o.value ?? o.label)}
            className="group flex items-center gap-[7px] rounded-lg border border-rule bg-paper px-3 py-[7px] text-[13.5px] font-medium text-ink transition-colors enabled:hover:border-primary enabled:hover:bg-primary-soft enabled:hover:text-primary-text disabled:cursor-default disabled:opacity-60"
          >
            {numbered && interactive && (
              <kbd className="grid size-4 place-items-center rounded-md bg-desk font-ui text-[12.5px] font-normal text-ink-3">
                {i + 1}
              </kbd>
            )}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TicketSelector({
  tickets,
  interactive,
  onSend,
}: {
  tickets: readonly TicketSummary[];
  interactive: boolean;
  onSend: (t: string) => void;
}) {
  return (
    <ul className={cardClass} aria-label="Seus chamados">
      {tickets.map((t, i) => (
        <li key={t.id} className={i > 0 ? 'border-t border-rule' : ''}>
          <button
            type="button"
            disabled={!interactive}
            onClick={() => onSend(`${t.id} · ${t.title}`)}
            className="flex min-h-[46px] w-full items-center gap-3.5 px-4 py-2 text-left transition-colors enabled:hover:bg-cta/[0.04] disabled:cursor-default"
          >
            <span className="size-4 shrink-0 rounded-full border-[1.5px] border-ink/20 bg-paper" aria-hidden="true" />
            <span className="w-[74px] shrink-0 text-[12.5px] font-medium text-ink-3">{t.id}</span>
            <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-ink">{t.title}</span>
            <span className="hidden items-center gap-1.5 text-[12.5px] text-ink-3 sm:flex">
              <span className={`size-1.5 rounded-full ${t.overdue ? 'bg-danger' : TICKET_STATUS_DOT[t.status]}`} />
              {t.overdue ? 'Prazo vencido' : TICKET_STATUS_LABELS[t.status]}
            </span>
            <span className="w-11 shrink-0 text-right text-[12.5px] text-ink-3">{formatDayMonth(t.createdAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function TicketCard({ ticket: t }: { ticket: TicketSummary }) {
  return (
    <article className={cardClass} aria-label={`Chamado ${t.id}`}>
      <div className="flex flex-col gap-1.5 px-[18px] pb-3.5 pt-4">
        <div className="flex items-center gap-2 pb-0.5 text-[12.5px] text-ink-3">
          <span className="font-medium">Chamado</span>
          <span className="size-[3px] rounded-full bg-rule" />
          <span>{t.id}</span>
          <span className="flex-1" />
          <span className={`flex items-center gap-1.5 font-medium ${TICKET_STATUS_TEXT[t.status]}`}>
            <span className={`size-1.5 rounded-full ${TICKET_STATUS_DOT[t.status]}`} />
            {TICKET_STATUS_LABELS[t.status]}
          </span>
        </div>
        <h3 className="text-lg font-semibold leading-tight tracking-[-0.2px] text-ink">{t.title}</h3>
        <p className="text-[13.5px] leading-normal text-ink-2">{t.description}</p>
      </div>
      <dl className="mx-[18px] mb-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-rule pt-3 sm:grid-cols-4">
        <Field label="Categoria">{CATEGORY_LABELS[t.category]}</Field>
        <Field label="Prioridade">
          <span className="flex items-center gap-1.5">
            <span className={`size-1.5 rounded-full ${PRIORITY_DOT[t.priority]}`} />
            {PRIORITY_LABELS[t.priority]}
          </span>
        </Field>
        <Field label="Aberto em">{formatDateTime(t.createdAt)}</Field>
        <Field label="Última atualização">
          <span className={t.overdue ? 'text-warning-text' : ''}>{formatRelative(t.updatedAt)}</span>
          {t.overdue ? (
            <span className="text-[13.5px] font-normal text-ink-3"> · prazo vencido</span>
          ) : t.dueAt ? (
            <span className="block text-[12.5px] font-normal text-ink-3">
              resposta até {formatDayMonth(t.dueAt)}, {formatTime(t.dueAt)}
            </span>
          ) : null}
        </Field>
      </dl>
    </article>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[12.5px] text-ink-3">{label}</dt>
      <dd className="text-[14.5px] font-medium text-ink">{children}</dd>
    </div>
  );
}

function ArticleCard({ title, body }: { title: string; body: string }) {
  return (
    <article className={`${cardClass} px-[18px] py-4`}>
      <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3">
        <BookOpen className="size-3.5" aria-hidden="true" /> Central de ajuda
      </p>
      <h3 className="text-[15.5px] font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-[13.5px] leading-normal text-ink-2">{body}</p>
    </article>
  );
}
