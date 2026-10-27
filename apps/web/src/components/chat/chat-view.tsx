'use client';

import { CONVERSATION_STATUS_LABELS } from '@nexo/domain';
import { Bot, Hand, Headset, LoaderCircle, RotateCcw, SendHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ChatMessage, ChatSnapshot, ConversationView } from '@/lib/chat';
import { ChatApiError, fetchSnapshot, sendMessage, startNewConversation } from '@/lib/chat-api';
import { TopBar } from '../top-bar';
import { MessageItem } from './message-item';

/** Com analista na conversa, buscamos mensagens novas a cada poucos segundos. */
const POLL_MS_WITH_TEAM = 3_000;
const POLL_MS_IDLE = 15_000;

function mergeMessages(current: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

export function ChatView({ initial, engine }: { initial: ChatSnapshot; engine: string }) {
  const [conversation, setConversation] = useState<ConversationView>(initial.conversation);
  const [messages, setMessages] = useState<ChatMessage[]>(initial.messages);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sending = pendingText !== null;
  const lastSeq = messages.at(-1)?.seq ?? 0;
  const limitReached = conversation.employeeMessageCount >= conversation.messageLimit;
  const closed = conversation.status === 'closed';
  const canWrite = !sending && !limitReached && !closed;

  // Rola para o fim quando chegam mensagens.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, pendingText]);

  // Busca mensagens novas (respostas do analista, mudanças de estado).
  useEffect(() => {
    if (sending) return undefined;
    const withTeam = conversation.status === 'waiting_analyst' || conversation.status === 'with_analyst';
    const timer = setInterval(
      async () => {
        try {
          const snap = await fetchSnapshot(lastSeq);
          setConversation(snap.conversation);
          if (snap.conversation.id !== conversation.id) setMessages(snap.messages);
          else if (snap.messages.length) setMessages((cur) => mergeMessages(cur, snap.messages));
        } catch {
          // Polling silencioso: a próxima tentativa resolve quedas rápidas.
        }
      },
      withTeam ? POLL_MS_WITH_TEAM : POLL_MS_IDLE,
    );
    return () => clearInterval(timer);
  }, [conversation.status, conversation.id, lastSeq, sending]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || !canWrite) return;
      setError(null);
      setPendingText(text);
      setInput('');
      try {
        const result = await sendMessage(text);
        setConversation(result.conversation);
        setMessages((cur) => mergeMessages(cur, result.messages));
      } catch (err) {
        setInput(text);
        setError(err instanceof ChatApiError ? err.message : 'Não foi possível enviar. Tente de novo.');
      } finally {
        setPendingText(null);
        inputRef.current?.focus();
      }
    },
    [canWrite],
  );

  const newConversation = async () => {
    setError(null);
    try {
      const snap = await startNewConversation();
      setConversation(snap.conversation);
      setMessages(snap.messages);
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof ChatApiError ? err.message : 'Não foi possível iniciar uma nova conversa.');
    }
  };

  // Atalhos 1–4 para as opções rápidas da última resposta (com o campo vazio).
  const lastQuickReplies = useMemo(() => {
    const last = messages.at(-1);
    const block = last?.role === 'agent' ? last.blocks.find((b) => b.type === 'quick_replies') : undefined;
    return block?.type === 'quick_replies' ? block.options : [];
  }, [messages]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
      return;
    }
    if (input === '' && /^[1-9]$/.test(e.key)) {
      const option = lastQuickReplies[Number(e.key) - 1];
      if (option) {
        e.preventDefault();
        void send(option.value ?? option.label);
      }
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const pendingMessage: ChatMessage | null = pendingText
    ? {
        id: 'pending',
        seq: lastSeq + 1,
        role: 'employee',
        authorName: null,
        text: pendingText,
        blocks: [],
        trace: null,
        createdAt: new Date().toISOString(),
      }
    : null;

  return (
    <>
      <TopBar here="Atendimento">
        <StatusPill conversation={conversation} engine={engine} />
        <button
          type="button"
          onClick={newConversation}
          disabled={sending}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-ink/12 px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-desk disabled:opacity-50"
          title="Encerrar esta conversa e começar outra"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Nova conversa</span>
        </button>
      </TopBar>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto" aria-live="polite" aria-relevant="additions">
          <div className="mx-auto flex min-h-full w-full max-w-[808px] flex-col justify-end gap-5 px-5 pb-1 pt-7 sm:px-8">
            {messages.length === 0 && !pendingMessage && <EmptyState onSend={send} />}
            {messages.map((m, i) => (
              <MessageItem key={m.id} message={m} isLast={i === messages.length - 1 && canWrite} onSend={send} />
            ))}
            {pendingMessage && <MessageItem message={pendingMessage} isLast={false} pending onSend={send} />}
            {sending && conversation.status === 'agent' && (
              <p className="flex items-center gap-2 text-[12.5px] text-ink-3" role="status">
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                Nexo Assist está verificando…
              </p>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="mx-auto flex w-full max-w-[808px] flex-col gap-1.5 px-5 pb-[18px] pt-2.5 sm:px-8"
        >
          <TeamBanner conversation={conversation} />
          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2 text-[13px] text-danger-text">
              {error}
            </p>
          )}
          <div className="flex min-h-12 items-end gap-2 rounded-xl border border-ink/12 bg-paper py-1.5 pl-4 pr-1.5 focus-within:border-cta">
            <label htmlFor="composer" className="sr-only">
              Mensagem
            </label>
            <textarea
              id="composer"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              maxLength={2000}
              disabled={limitReached || closed}
              placeholder={
                limitReached
                  ? 'Limite de mensagens atingido. Inicie uma nova conversa.'
                  : conversation.status === 'agent'
                    ? 'Escreva para o Nexo…'
                    : 'Escreva para o analista…'
              }
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[14.5px] text-ink outline-none focus-visible:outline-none placeholder:text-ink-3 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={!canWrite || input.trim() === ''}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-cta px-3 text-[13.5px] font-semibold text-white hover:bg-cta-hover disabled:opacity-50"
            >
              {sending ? (
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <SendHorizontal className="size-3.5" aria-hidden="true" />
              )}
              Enviar
            </button>
          </div>
          <p className={`text-right text-[12.5px] ${limitReached ? 'text-danger-text' : 'text-ink-3'}`}>
            {conversation.employeeMessageCount}/{conversation.messageLimit} mensagens nesta sessão
          </p>
        </form>
      </div>
    </>
  );
}

function StatusPill({ conversation, engine }: { conversation: ConversationView; engine: string }) {
  if (conversation.status === 'agent') {
    const basic = engine.includes('básico');
    return (
      <span
        className={`flex items-center gap-[7px] rounded-full px-2.5 py-[5px] text-[12.5px] font-semibold ${basic ? 'bg-warning-soft text-warning-text' : 'bg-success-soft text-success-text'}`}
        title={`Respondendo: ${engine}`}
      >
        <span className={`size-[7px] rounded-full ${basic ? 'bg-warning' : 'bg-success'}`} />
        {basic ? 'Assistente em modo básico' : 'Assistente online'}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-[7px] rounded-full bg-violet-soft px-2.5 py-[5px] text-[12.5px] font-semibold text-violet-text">
      <span className="size-[7px] rounded-full bg-violet" />
      {CONVERSATION_STATUS_LABELS[conversation.status]}
    </span>
  );
}

function TeamBanner({ conversation }: { conversation: ConversationView }) {
  if (conversation.status === 'waiting_analyst') {
    return (
      <p
        className="flex items-center gap-2 rounded-lg bg-violet-soft px-3.5 py-2 text-[13px] text-violet-text"
        role="status"
      >
        <Hand className="size-4 shrink-0" aria-hidden="true" />
        Aguardando um analista. O Nexo Assist está em pausa; suas mensagens ficam registradas para o atendimento.
      </p>
    );
  }
  if (conversation.status === 'with_analyst') {
    return (
      <p
        className="flex items-center gap-2 rounded-lg bg-violet-soft px-3.5 py-2 text-[13px] text-violet-text"
        role="status"
      >
        <Headset className="size-4 shrink-0" aria-hidden="true" />
        {conversation.assignedAnalystName ?? 'Um analista'} está atendendo você.
      </p>
    );
  }
  return null;
}

function EmptyState({ onSend }: { onSend: (t: string) => void }) {
  const suggestions = ['Qual o status dos meus chamados?', 'Minha VPN dá erro 809', 'Qual o horário do service desk?'];
  return (
    <div className="flex flex-col items-start gap-4 pb-6">
      <span className="grid size-10 place-items-center rounded-full bg-primary-soft">
        <Bot className="size-5 text-primary-text" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-[30px] leading-tight tracking-[-0.5px] text-ink">Como posso ajudar?</h1>
        <p className="text-[14.5px] text-ink-3">
          Descreva o problema com suas palavras. Eu consulto seus chamados e a central de ajuda.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSend(s)}
            className="rounded-lg border border-rule bg-paper px-3 py-[7px] text-[13.5px] font-medium text-ink hover:border-primary hover:bg-primary-soft hover:text-primary-text"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
