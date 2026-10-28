'use client';

import { HANDOFF_REASON_LABELS } from '@nexo/domain';
import {
  ArrowLeft,
  Bot,
  CircleCheck,
  Hand,
  ListTree,
  LoaderCircle,
  PanelRight,
  SendHorizontal,
  Sparkles,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { ChatMessage } from '@/lib/chat';
import { allowedActions, queueBadge, type ConsoleAction, type QueueItem, type Viewer } from '@/lib/console';
import { formatTime, initials } from '@/lib/format';
import { ChatActionsContext, type ChatActions } from '../chat/chat-actions';
import { StatusBadge } from './badge';
import { ConsoleMessage } from './console-message';
import { HandoffDue } from './handoff-due';

interface Props {
  readonly conversation: QueueItem;
  readonly messages: readonly ChatMessage[];
  readonly viewer: Viewer & { readonly name: string };
  readonly now: Date;
  readonly busy: ConsoleAction | 'reply' | null;
  readonly error: string | null;
  readonly onAction: (action: ConsoleAction) => void;
  readonly onReply: (text: string) => Promise<boolean>;
  readonly onBack: () => void;
  readonly onTogglePanel: () => void;
}

/** O analista só vê os cards: os botões de confirmar rascunho são do funcionário. */
const READ_ONLY_ACTIONS: ChatActions = {
  send: () => {},
  draftAction: () => {},
  editDraft: () => {},
  busy: false,
  readOnly: true,
};

/** Tela 5: conversa completa, com o resumo da transferência, as decisões do agent e as ações. */
export function ConversationPane({
  conversation: c,
  messages,
  viewer,
  now,
  busy,
  error,
  onAction,
  onReply,
  onBack,
  onTogglePanel,
}: Props) {
  const [expandTraces, setExpandTraces] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const allowed = allowedActions(c, viewer);
  const pinnedSummary = c.handoff !== null && (c.status === 'waiting_analyst' || c.status === 'with_analyst');

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [c.id, messages.length]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={`Conversa com ${c.employee.name}`}>
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule px-4 py-2.5 sm:px-6">
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar para a fila"
          className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-desk lg:hidden"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>
        <span className="hidden size-9 shrink-0 place-items-center rounded-full bg-desk text-[12px] font-bold text-ink-2 sm:grid">
          {initials(c.employee.name)}
        </span>
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-[15px] font-semibold text-ink">{c.employee.name}</h2>
          <p className="truncate text-[12px] text-ink-3">{c.employee.department}</p>
        </div>
        <StatusBadge badge={queueBadge(c, viewer)} size="md" />
        <span className="flex-1" />
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setExpandTraces((v) => !v)}
            aria-pressed={expandTraces}
            aria-label="Decisões"
            title="Abrir o registro de decisão de todas as respostas do agent"
            className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium ${
              expandTraces ? 'bg-primary-soft text-primary-text' : 'text-ink-2 hover:bg-desk'
            }`}
          >
            <ListTree className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Decisões</span>
          </button>
          <button
            type="button"
            onClick={onTogglePanel}
            aria-label="Chamados"
            title="Funcionário e chamados"
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-desk min-[1360px]:hidden"
          >
            <PanelRight className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Chamados</span>
          </button>
          {allowed.return && (
            <ActionButton
              label="Devolver ao agent"
              icon={<Bot className="size-3.5" aria-hidden="true" />}
              busy={busy === 'return'}
              disabled={busy !== null}
              onClick={() => onAction('return')}
            />
          )}
          {allowed.close && (
            <ActionButton
              label="Encerrar"
              icon={<CircleCheck className="size-3.5" aria-hidden="true" />}
              busy={busy === 'close'}
              disabled={busy !== null}
              onClick={() => onAction('close')}
            />
          )}
          {allowed.assume && (
            <ActionButton
              primary
              label="Assumir"
              icon={<Hand className="size-3.5" aria-hidden="true" />}
              busy={busy === 'assume'}
              disabled={busy !== null}
              onClick={() => onAction('assume')}
            />
          )}
        </div>
      </header>

      {/* Em atendimento, o resumo fica fixo no topo; depois, vira parte do histórico. */}
      {pinnedSummary && (
        <div className="shrink-0 border-b border-rule bg-paper px-4 py-3 sm:px-6">
          <div className="mx-auto w-full max-w-[860px]">
            <HandoffSummary conversation={c} now={now} pinned />
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto bg-desk/40">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5 px-4 py-6 sm:px-8">
          {c.handoff && c.status === 'closed' && <HandoffSummary conversation={c} now={now} />}
          <ChatActionsContext.Provider value={READ_ONLY_ACTIONS}>
            {messages.map((m) => (
              <ConsoleMessage key={m.id} message={m} viewerName={viewer.name} expandTraces={expandTraces} />
            ))}
          </ChatActionsContext.Provider>
          <div ref={endRef} />
        </div>
      </div>

      <Composer
        conversation={c}
        viewer={viewer}
        allowedReply={allowed.reply}
        busy={busy}
        error={error}
        onReply={onReply}
      />
    </section>
  );
}

function ActionButton({
  label,
  icon,
  busy,
  disabled,
  primary = false,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  busy: boolean;
  disabled: boolean;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold disabled:opacity-60 ${
        primary
          ? 'bg-cta text-white shadow-cta hover:bg-cta-hover'
          : 'border border-ink/12 bg-paper text-ink-2 shadow-field hover:bg-desk'
      }`}
    >
      {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : icon}
      {label}
    </button>
  );
}

/** O que o agent passou para o analista, para ninguém precisar perguntar tudo de novo. */
function HandoffSummary({
  conversation: c,
  now,
  pinned = false,
}: {
  conversation: QueueItem;
  now: Date;
  pinned?: boolean;
}) {
  const h = c.handoff!;
  const [expanded, setExpanded] = useState(false);
  const long = h.summary.length > 180;
  return (
    <article
      className={`flex flex-col gap-2 ${
        pinned ? '' : 'rounded-2xl border border-violet/30 bg-paper px-[18px] py-4 shadow-card'
      }`}
      aria-label="Resumo da transferência"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
        <Sparkles className="size-3.5 text-violet-text" aria-hidden="true" />
        <span className="font-semibold text-violet-text">Resumo da transferência</span>
        <span className="size-[3px] rounded-full bg-rule" />
        <span>Suporte {h.group}</span>
        <span className="size-[3px] rounded-full bg-rule" />
        <span>às {formatTime(h.at)}</span>
        {c.status === 'waiting_analyst' && (
          <>
            <span className="size-[3px] rounded-full bg-rule" />
            <HandoffDue handoff={h} now={now} />
          </>
        )}
      </div>
      <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-ink-3">Motivo</dt>
        <dd className="font-medium text-ink">
          {HANDOFF_REASON_LABELS[h.reason]}
          {h.confidence !== null && h.reason === 'low_confidence' && (
            <span className="font-normal text-ink-3"> · confiança {Math.round(h.confidence * 100)}%</span>
          )}
        </dd>
        {h.ticketId && (
          <>
            <dt className="text-ink-3">Chamado</dt>
            <dd className="font-data text-[12.5px] font-medium text-ink">{h.ticketId}</dd>
          </>
        )}
        <dt className="text-ink-3">Caso</dt>
        <dd className="leading-normal text-ink-2">
          <span className={`whitespace-pre-wrap ${pinned && long && !expanded ? 'line-clamp-2' : ''}`}>
            {h.summary}
          </span>
          {pinned && long && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 text-[12.5px] font-medium text-primary-text hover:underline"
            >
              {expanded ? 'ver menos' : 'ver resumo completo'}
            </button>
          )}
        </dd>
      </dl>
    </article>
  );
}

function Composer({
  conversation: c,
  viewer,
  allowedReply,
  busy,
  error,
  onReply,
}: {
  conversation: QueueItem;
  viewer: Viewer & { readonly name: string };
  allowedReply: boolean;
  busy: ConsoleAction | 'reply' | null;
  error: string | null;
  onReply: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Ao assumir, o cursor já vai para a resposta.
  useEffect(() => {
    if (allowedReply) inputRef.current?.focus();
  }, [allowedReply, c.id]);

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    if (await onReply(value)) setText('');
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const notice =
    c.status === 'closed'
      ? 'Conversa encerrada.'
      : c.status === 'waiting_analyst'
        ? 'Assuma o atendimento para responder. Enquanto isso, o Nexo Assist fica em pausa.'
        : c.status === 'agent'
          ? 'O Nexo Assist está atendendo. Assuma para falar direto com o funcionário.'
          : c.assignedAnalystId !== viewer.id
            ? `${c.assignedAnalystName ?? 'Outro analista'} está atendendo esta conversa.`
            : null;

  return (
    <div className="mx-auto flex w-full max-w-[860px] shrink-0 flex-col gap-1.5 px-4 pb-4 pt-2.5 sm:px-8">
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2 text-[13px] text-danger-text">
          {error}
        </p>
      )}
      {allowedReply ? (
        <form
          onSubmit={onSubmit}
          className="flex min-h-12 items-end gap-2 rounded-xl border border-ink/12 bg-paper py-1.5 pl-4 pr-1.5 focus-within:border-cta"
        >
          <label htmlFor="analyst-composer" className="sr-only">
            Resposta para {c.employee.name}
          </label>
          <textarea
            id="analyst-composer"
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={2000}
            placeholder={`Responder para ${c.employee.name.split(' ')[0]}…`}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[14.5px] text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={busy !== null || text.trim() === ''}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-cta px-3 text-[13.5px] font-semibold text-white hover:bg-cta-hover disabled:opacity-50"
          >
            {busy === 'reply' ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <SendHorizontal className="size-3.5" aria-hidden="true" />
            )}
            Enviar
          </button>
        </form>
      ) : (
        notice && (
          <div className="flex min-h-12 flex-wrap items-center gap-3 rounded-xl border border-dashed border-ink/15 bg-paper px-4 py-2 text-[13px] text-ink-3">
            <span className="flex-1">{notice}</span>
          </div>
        )
      )}
    </div>
  );
}
