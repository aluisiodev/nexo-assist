import { z } from 'zod';
import { ChatMessageSchema, ChatSnapshotSchema, ConversationViewSchema, type ChatSnapshot } from './chat';

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
const SendResultSchema = z.object({ conversation: ConversationViewSchema, messages: z.array(ChatMessageSchema) });

async function call<T extends z.ZodType>(schema: T, url: string, init?: RequestInit): Promise<z.output<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
      cache: 'no-store',
    });
  } catch {
    throw new ChatApiError('network', 'Sem conexão. Verifique a internet e tente de novo.', 0);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ErrorSchema.safeParse(body);
    if (res.status === 401) window.location.assign('/login');
    throw new ChatApiError(
      parsed.success ? parsed.data.error.code : 'http_error',
      parsed.success ? parsed.data.error.message : 'Algo deu errado. Tente de novo.',
      res.status,
    );
  }
  return schema.parse(body);
}

export const fetchSnapshot = (after = 0): Promise<ChatSnapshot> => call(ChatSnapshotSchema, `/api/chat?after=${after}`);

export const sendMessage = (text: string) =>
  call(SendResultSchema, '/api/chat/messages', { method: 'POST', body: JSON.stringify({ text }) });

export const startNewConversation = (): Promise<ChatSnapshot> =>
  call(ChatSnapshotSchema, '/api/chat/new', { method: 'POST' });
