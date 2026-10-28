'use client';

import { PRIORITY_LABELS, TICKET_STATUS_LABELS } from '@nexo/domain';
import { LoaderCircle, Mail, RefreshCw, X } from 'lucide-react';
import type { TicketSummary } from '@/lib/chat';
import type { QueueItem } from '@/lib/console';
import {
  formatDayMonth,
  formatTime,
  initials,
  PRIORITY_DOT,
  TICKET_STATUS_DOT,
  TICKET_STATUS_TEXT,
} from '@/lib/format';

export type TicketsState =
  | { readonly status: 'loading' }
  | { readonly status: 'ok'; readonly tickets: readonly TicketSummary[] }
  | { readonly status: 'error'; readonly message: string };

interface Props {
  readonly conversation: QueueItem;
  readonly tickets: TicketsState;
  readonly onRetry: () => void;
  /** Em telas menores o painel abre por cima da conversa e tem botão de fechar. */
  readonly onClose?: () => void;
  readonly className?: string;
}

/** Painel lateral (Tela 5): quem é o funcionário e os chamados dele no service desk. */
export function EmployeePanel({ conversation: c, tickets, onRetry, onClose, className = '' }: Props) {
  const related = c.handoff?.ticketId ?? null;
  return (
    <aside
      className={`min-h-0 w-[300px] shrink-0 flex-col overflow-y-auto border-l border-rule bg-paper ${className}`}
      aria-label="Funcionário e chamados"
    >
      <div className="flex items-start gap-3 border-b border-rule px-5 py-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-desk text-[13px] font-bold text-ink-2">
          {initials(c.employee.name)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="truncate text-[14.5px] font-semibold text-ink">{c.employee.name}</p>
          <p className="truncate text-[12.5px] text-ink-3">{c.employee.department}</p>
          <p className="flex items-center gap-1 truncate text-[12.5px] text-ink-3">
            <Mail className="size-3 shrink-0" aria-hidden="true" />
            {c.employee.email}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar painel"
            className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-desk"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1 border-b border-rule px-5 py-3 text-[12.5px] text-ink-3">
        <span>
          {c.employeeMessageCount}/{c.messageLimit} mensagens com o assistente
        </span>
        <span>
          Conversa iniciada em {formatDayMonth(c.createdAt)}, {formatTime(c.createdAt)}
        </span>
      </div>

      <section className="flex flex-col gap-2.5 px-5 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-ink">
            Chamados{tickets.status === 'ok' ? ` (${tickets.tickets.length})` : ''}
          </h2>
          <button
            type="button"
            onClick={onRetry}
            aria-label="Atualizar chamados"
            className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-desk"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
          </button>
        </div>

        {tickets.status === 'loading' && (
          <p className="flex items-center gap-2 text-[12.5px] text-ink-3">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> Consultando o service desk…
          </p>
        )}
        {tickets.status === 'error' && (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger-text" role="alert">
            {tickets.message}
          </p>
        )}
        {tickets.status === 'ok' && tickets.tickets.length === 0 && (
          <p className="text-[12.5px] text-ink-3">Nenhum chamado deste funcionário.</p>
        )}
        {tickets.status === 'ok' && (
          <ul className="flex flex-col gap-2">
            {tickets.tickets.map((t) => (
              <TicketRow key={t.id} ticket={t} related={t.id === related} />
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

function TicketRow({ ticket: t, related }: { ticket: TicketSummary; related: boolean }) {
  return (
    <li
      className={`flex flex-col gap-1 rounded-xl border px-3 py-2.5 ${
        related ? 'border-violet/40 bg-violet-soft' : 'border-rule bg-paper'
      }`}
    >
      <div className="flex items-center gap-2 text-[11.5px]">
        <span className="font-data font-medium text-ink-2">{t.id}</span>
        <span className="flex-1" />
        <span className={`flex items-center gap-1 font-medium ${TICKET_STATUS_TEXT[t.status]}`}>
          <span className={`size-1.5 rounded-full ${TICKET_STATUS_DOT[t.status]}`} aria-hidden="true" />
          {TICKET_STATUS_LABELS[t.status]}
        </span>
      </div>
      <p className="text-[13px] font-medium leading-snug text-ink">{t.title}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-ink-3">
        <span className="flex items-center gap-1">
          <span className={`size-1.5 rounded-full ${PRIORITY_DOT[t.priority]}`} aria-hidden="true" />
          {PRIORITY_LABELS[t.priority]}
        </span>
        {t.overdue ? (
          <span className="font-semibold text-danger-text">prazo vencido</span>
        ) : t.dueAt ? (
          <span>
            resposta até {formatDayMonth(t.dueAt)}, {formatTime(t.dueAt)}
          </span>
        ) : null}
      </div>
      {related && <p className="text-[11.5px] font-medium text-violet-text">Relacionado à transferência</p>}
    </li>
  );
}
