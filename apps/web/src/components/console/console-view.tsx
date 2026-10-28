'use client';

import { MessagesSquare } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '@/lib/chat';
import { ChatApiError } from '@/lib/chat-api';
import {
  matchesFilter,
  type ConsoleAction,
  type ConsoleSnapshot,
  type QueueFilter,
  type QueueItem,
  type Viewer,
} from '@/lib/console';
import {
  fetchConversation,
  fetchEmployeeTickets,
  fetchQueue,
  runConsoleAction,
  sendAnalystMessage,
} from '@/lib/console-api';
import { ConversationPane } from './conversation-pane';
import { EmployeePanel, type TicketsState } from './employee-panel';
import { QueuePane } from './queue-pane';

/** A fila e a conversa aberta se atualizam sozinhas (polling, como no chat). */
const QUEUE_POLL_MS = 5_000;
const CONVERSATION_POLL_MS = 3_000;
const TICKETS_POLL_MS = 30_000;

const FILTER_KEY = 'nexo.console.filter';

function mergeMessages(current: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

const messageOf = (err: unknown, fallback: string) => (err instanceof ChatApiError ? err.message : fallback);

interface Props {
  readonly initialItems: readonly QueueItem[];
  readonly initialSnapshot: ConsoleSnapshot | null;
  readonly viewer: Viewer & { readonly name: string };
  /** Hora do servidor na renderização (evita diferença de "há N min" na hidratação). */
  readonly serverNow: string;
}

export function ConsoleView({ initialItems, initialSnapshot, viewer, serverNow }: Props) {
  const [items, setItems] = useState<readonly QueueItem[]>(initialItems);
  const [filter, setFilter] = useState<QueueFilter>(() =>
    initialItems.some((i) => matchesFilter(i, 'para_voce', viewer)) ? 'para_voce' : 'todas',
  );
  const [selectedId, setSelectedId] = useState<string | null>(initialSnapshot?.conversation.id ?? null);
  const [conversation, setConversation] = useState<QueueItem | null>(initialSnapshot?.conversation ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>(initialSnapshot?.messages ?? []);
  const [tickets, setTickets] = useState<TicketsState>({ status: 'loading' });
  const [busy, setBusy] = useState<ConsoleAction | 'reply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [now, setNow] = useState(() => new Date(serverNow));

  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const lastSeq = messages.at(-1)?.seq ?? 0;

  // Filtro escolhido fica lembrado neste navegador (conveniência; falha sem problema).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(FILTER_KEY) as QueueFilter | null;
      if (saved && ['todas', 'para_voce', 'com_agent', 'minhas'].includes(saved)) setFilter(saved);
    } catch {
      // armazenamento indisponível
    }
  }, []);
  const chooseFilter = (f: QueueFilter) => {
    setFilter(f);
    try {
      window.localStorage.setItem(FILTER_KEY, f);
    } catch {
      // armazenamento indisponível
    }
  };

  const refreshQueue = useCallback(async () => {
    try {
      const queue = await fetchQueue();
      setItems(queue.items);
      setNow(new Date());
    } catch {
      // Polling silencioso: a próxima tentativa resolve quedas rápidas.
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refreshQueue(), QUEUE_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshQueue]);

  // Mensagens novas da conversa aberta (funcionário escrevendo, outro analista assumindo…).
  useEffect(() => {
    if (!selectedId || busy) return undefined;
    const timer = setInterval(async () => {
      try {
        const snap = await fetchConversation(selectedId, lastSeq);
        if (selectedRef.current !== selectedId) return;
        setConversation(snap.conversation);
        if (snap.messages.length) setMessages((cur) => mergeMessages(cur, snap.messages));
      } catch {
        // silencioso
      }
    }, CONVERSATION_POLL_MS);
    return () => clearInterval(timer);
  }, [selectedId, lastSeq, busy]);

  const loadTickets = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setTickets({ status: 'loading' });
    try {
      const { tickets: list } = await fetchEmployeeTickets(id);
      if (selectedRef.current === id) setTickets({ status: 'ok', tickets: list });
    } catch (err) {
      if (selectedRef.current === id && !quiet) {
        setTickets({ status: 'error', message: messageOf(err, 'Não foi possível consultar os chamados.') });
      }
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return undefined;
    void loadTickets(selectedId);
    const timer = setInterval(() => void loadTickets(selectedId, true), TICKETS_POLL_MS);
    return () => clearInterval(timer);
  }, [selectedId, loadTickets]);

  // Título da aba mostra quantas conversas esperam o grupo do analista.
  const waitingForMe = useMemo(
    () => items.filter((i) => matchesFilter(i, 'para_voce', viewer)).length,
    [items, viewer],
  );
  useEffect(() => {
    document.title = `${waitingForMe > 0 ? `(${waitingForMe}) ` : ''}Console do analista · Nexo Assist`;
  }, [waitingForMe]);

  const select = useCallback(
    async (id: string) => {
      setError(null);
      setPanelOpen(false);
      setSelectedId(id);
      window.history.replaceState(null, '', `/console/${encodeURIComponent(id)}`);
      const fromQueue = items.find((i) => i.id === id);
      if (fromQueue) setConversation(fromQueue);
      setMessages([]);
      try {
        const snap = await fetchConversation(id);
        if (selectedRef.current !== id) return;
        setConversation(snap.conversation);
        setMessages(snap.messages);
      } catch (err) {
        setError(messageOf(err, 'Não foi possível abrir a conversa.'));
      }
    },
    [items],
  );

  const back = () => {
    setSelectedId(null);
    setConversation(null);
    setMessages([]);
    window.history.replaceState(null, '', '/console');
  };

  const act = async (action: ConsoleAction) => {
    if (!selectedId) return;
    setError(null);
    setBusy(action);
    try {
      const snap = await runConsoleAction(selectedId, action);
      setConversation(snap.conversation);
      setMessages((cur) => mergeMessages(cur, snap.messages));
    } catch (err) {
      setError(messageOf(err, 'Não foi possível concluir a ação.'));
      // Outro analista pode ter mudado a conversa: mostra o estado atual.
      try {
        const snap = await fetchConversation(selectedId);
        setConversation(snap.conversation);
        setMessages(snap.messages);
      } catch {
        // silencioso
      }
    } finally {
      setBusy(null);
      void refreshQueue();
    }
  };

  const reply = async (text: string): Promise<boolean> => {
    if (!selectedId) return false;
    setError(null);
    setBusy('reply');
    try {
      const message = await sendAnalystMessage(selectedId, text);
      setMessages((cur) => mergeMessages(cur, [message]));
      void refreshQueue();
      return true;
    } catch (err) {
      setError(messageOf(err, 'Não foi possível enviar a resposta.'));
      return false;
    } finally {
      setBusy(null);
    }
  };

  // A conversa aberta usa a versão mais nova que tivermos (da fila ou do polling dela).
  const current = conversation && selectedId === conversation.id ? conversation : null;

  return (
    <div className="flex min-h-0 flex-1">
      <QueuePane
        items={items}
        filter={filter}
        onFilter={chooseFilter}
        selectedId={selectedId}
        onSelect={(id) => void select(id)}
        viewer={viewer}
        now={now}
        className={current ? 'hidden lg:flex' : 'flex w-full'}
      />

      {current ? (
        <>
          <ConversationPane
            conversation={current}
            messages={messages}
            viewer={viewer}
            now={now}
            busy={busy}
            error={error}
            onAction={(a) => void act(a)}
            onReply={reply}
            onBack={back}
            onTogglePanel={() => setPanelOpen((v) => !v)}
          />
          <EmployeePanel
            conversation={current}
            tickets={tickets}
            onRetry={() => void loadTickets(current.id)}
            className="hidden min-[1360px]:flex"
          />
          {panelOpen && (
            <div
              className="fixed inset-0 z-20 flex justify-end bg-ink/20 min-[1360px]:hidden"
              onClick={() => setPanelOpen(false)}
            >
              <div onClick={(e) => e.stopPropagation()} className="flex h-full shadow-card">
                <EmployeePanel
                  conversation={current}
                  tickets={tickets}
                  onRetry={() => void loadTickets(current.id)}
                  onClose={() => setPanelOpen(false)}
                  className="flex"
                />
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="hidden flex-1 flex-col items-center justify-center gap-3 bg-desk/40 px-8 text-center lg:flex">
          <MessagesSquare className="size-6 text-ink-3" aria-hidden="true" />
          <p className="max-w-sm text-[14px] text-ink-3">
            Escolha uma conversa na fila. Você vê o histórico completo, o motivo da transferência e cada decisão do
            agent.
          </p>
          {error && <p className="text-[13px] text-danger-text">{error}</p>}
        </div>
      )}
    </div>
  );
}
