import { z } from 'zod';
import {
  ChatActionResultSchema,
  ChatSnapshotSchema,
  ChatStreamEventSchema,
  type AgentStep,
  type ChatActionResult,
  type ChatMessage,
  type ChatSnapshot,
} from './chat';

/** Chamadas do navegador para as rotas /api/chat, com validação da resposta. */

export class ChatApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const ErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const NETWORK_ERROR = 'Sem conexão. Verifique a internet e tente de novo.';

async function request(url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
      cache: 'no-store',
    });
  } catch {
    throw new ChatApiError('network', NETWORK_ERROR, 0);
  }
  if (!res.ok) {
    const parsed = ErrorSchema.safeParse(await res.json().catch(() => null));
    if (res.status === 401) window.location.assign('/login');
    throw new ChatApiError(
      parsed.success ? parsed.data.error.code : 'http_error',
      parsed.success ? parsed.data.error.message : 'Algo deu errado. Tente de novo.',
      res.status,
    );
  }
  return res;
}

async function call<T extends z.ZodType>(schema: T, url: string, init?: RequestInit): Promise<z.output<T>> {
  const res = await request(url, init);
  return schema.parse(await res.json());
}

export const fetchSnapshot = (after = 0): Promise<ChatSnapshot> => call(ChatSnapshotSchema, `/api/chat?after=${after}`);

export const startNewConversation = (): Promise<ChatSnapshot> =>
  call(ChatSnapshotSchema, '/api/chat/new', { method: 'POST' });

export const draftAction = (draftId: string, action: 'confirm' | 'cancel'): Promise<ChatActionResult> =>
  call(ChatActionResultSchema, `/api/chat/drafts/${encodeURIComponent(draftId)}/${action}`, { method: 'POST' });

export interface SendCallbacks {
  /** A mensagem do funcionário foi gravada. */
  onMessage?: (message: ChatMessage) => void;
  /** O agent executou uma ação ("consultou seus chamados"). */
  onStep?: (step: AgentStep) => void;
}

/** Envia uma mensagem e acompanha a resposta em tempo real (NDJSON). */
export async function sendMessage(text: string, callbacks: SendCallbacks = {}): Promise<ChatActionResult> {
  const res = await request('/api/chat/messages', { method: 'POST', body: JSON.stringify({ text }) });
  if (!res.body) throw new ChatApiError('http_error', 'Resposta vazia do servidor.', res.status);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let result: ChatActionResult | null = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line) continue;
        const event = ChatStreamEventSchema.parse(JSON.parse(line));
        if (event.type === 'message') callbacks.onMessage?.(event.message);
        else if (event.type === 'step') callbacks.onStep?.(event.step);
        else if (event.type === 'done') result = { conversation: event.conversation, messages: event.messages };
        else if (event.type === 'error') throw new ChatApiError(event.error.code, event.error.message, 200);
      }
    }
  } catch (err) {
    if (err instanceof ChatApiError) throw err;
    throw new ChatApiError('network', NETWORK_ERROR, 0);
  }
  if (!result) throw new ChatApiError('network', 'A conexão caiu antes da resposta terminar. Atualize a página.', 0);
  return result;
}
