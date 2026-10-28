'use client';

import type { ChatMessage } from '@/lib/chat';
import { formatTime, initials } from '@/lib/format';
import { MessageItem } from '../chat/message-item';

const bubbleText = 'whitespace-pre-wrap break-words text-[14.5px] leading-normal';
const noop = () => {};

/**
 * Mensagem vista pelo analista. A perspectiva é a do atendimento: o funcionário fala
 * à esquerda e a equipe (o analista) à direita. As respostas do agent usam o mesmo
 * componente do chat, com os cards em modo somente leitura e o "por quê?" disponível.
 */
export function ConsoleMessage({
  message: m,
  viewerName,
  expandTraces,
}: {
  message: ChatMessage;
  viewerName: string;
  expandTraces: boolean;
}) {
  if (m.role === 'employee') {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="flex items-center gap-2 text-[12.5px]">
          <span className="grid size-5 place-items-center rounded-full bg-desk text-[10px] font-bold text-ink-2">
            {initials(m.authorName ?? 'F')}
          </span>
          <span className="font-semibold text-ink">{m.authorName ?? 'Funcionário'}</span>
          <span className="text-ink-3">{formatTime(m.createdAt)}</span>
        </p>
        <p
          className={`${bubbleText} w-fit max-w-[600px] rounded-[4px_12px_12px_12px] bg-ink px-4 py-[11px] text-white`}
        >
          {m.text}
        </p>
      </div>
    );
  }

  if (m.role === 'analyst') {
    const mine = m.authorName === viewerName;
    return (
      <div className="flex flex-col items-end gap-1.5">
        <p className="flex items-center gap-2 text-[12.5px]">
          <span className="text-ink-3">
            {mine ? 'você' : 'analista'} · {formatTime(m.createdAt)}
          </span>
          <span className="font-semibold text-ink">{m.authorName}</span>
          <span className="grid size-5 place-items-center rounded-full bg-violet-soft text-[10px] font-bold text-violet-text">
            {initials(m.authorName ?? 'A')}
          </span>
        </p>
        <p
          className={`${bubbleText} w-fit max-w-[600px] rounded-[12px_4px_12px_12px] border border-violet/30 bg-violet-soft px-4 py-3 text-ink`}
        >
          {m.text}
        </p>
      </div>
    );
  }

  // Agent e avisos do sistema: iguais ao chat do funcionário, sem interação.
  return <MessageItem message={m} isLast={false} onSend={noop} expandTraces={expandTraces} />;
}
