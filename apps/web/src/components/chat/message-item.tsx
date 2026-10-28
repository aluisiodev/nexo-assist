'use client';

import type { ChatMessage } from '@/lib/chat';
import { formatTime, initials } from '@/lib/format';
import { Block, QuickReplies } from './blocks';
import { AgentStatusLine } from './trace-panel';

interface Props {
  readonly message: ChatMessage;
  /** É a última mensagem da conversa? Só ela aceita cliques em opções. */
  readonly isLast: boolean;
  readonly pending?: boolean;
  readonly onSend: (text: string) => void;
  /** Console do analista: abre o "por quê?" de todas as respostas. */
  readonly expandTraces?: boolean;
}

const bubbleText = 'whitespace-pre-wrap break-words text-[14.5px] leading-normal';

export function MessageItem({ message: m, isLast, pending = false, onSend, expandTraces = false }: Props) {
  if (m.role === 'employee') {
    return (
      <div className="flex justify-end">
        <p
          className={`${bubbleText} max-w-[min(520px,85%)] rounded-[12px_12px_4px_12px] bg-ink px-4 py-[11px] text-white ${pending ? 'opacity-60' : ''}`}
          title={formatTime(m.createdAt)}
        >
          {m.text}
        </p>
      </div>
    );
  }

  if (m.role === 'system') {
    return (
      <p className="flex items-center gap-3 text-[12.5px] text-ink-3" role="status">
        <span className="h-px flex-1 bg-rule" />
        <span className="max-w-[80%] text-center">{m.text}</span>
        <span className="h-px flex-1 bg-rule" />
      </p>
    );
  }

  if (m.role === 'analyst') {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="flex items-center gap-2 text-[12.5px]">
          <span className="grid size-5 place-items-center rounded-full bg-violet-soft text-[10px] font-bold text-violet-text">
            {initials(m.authorName ?? 'A')}
          </span>
          <span className="font-semibold text-ink">{m.authorName}</span>
          <span className="text-ink-3">analista · {formatTime(m.createdAt)}</span>
        </p>
        <p
          className={`${bubbleText} w-fit max-w-[600px] rounded-[4px_12px_12px_12px] border border-violet/30 bg-violet-soft px-4 py-3 text-ink`}
        >
          {m.text}
        </p>
      </div>
    );
  }

  // Agent
  const quick = m.blocks.find((b) => b.type === 'quick_replies');
  // Como no protótipo: o card do chamado vem antes do texto; listas e artigos, depois.
  const before = m.blocks.filter((b) => b.type === 'ticket_card');
  const after = m.blocks.filter((b) => b.type !== 'ticket_card' && b.type !== 'quick_replies');
  return (
    <div className="flex flex-col gap-1.5">
      <AgentStatusLine trace={m.trace} expandAll={expandTraces} />
      {before.map((b, i) => (
        <Block key={`b${i}`} block={b} interactive={isLast} onSend={onSend} />
      ))}
      <div className="flex w-fit max-w-[600px] flex-col gap-3 rounded-[4px_12px_12px_12px] border border-rule bg-paper px-4 py-3">
        <p className={`${bubbleText} text-ink`}>{m.text}</p>
        {quick?.type === 'quick_replies' && (
          <QuickReplies options={quick.options} question={quick.question} interactive={isLast} onSend={onSend} />
        )}
      </div>
      {after.map((b, i) => (
        <Block key={`a${i}`} block={b} interactive={isLast} onSend={onSend} />
      ))}
    </div>
  );
}
