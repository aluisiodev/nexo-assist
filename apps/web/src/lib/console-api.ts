import { z } from 'zod';
import { ChatMessageSchema, type ChatMessage } from './chat';
import { call } from './chat-api';
import {
  ConsoleSnapshotSchema,
  EmployeeTicketsSchema,
  QueueSchema,
  type ConsoleAction,
  type ConsoleSnapshot,
  type EmployeeTickets,
  type Queue,
} from './console';

/** Chamadas do navegador para as rotas /api/console, com validação da resposta. */

const base = (id: string) => `/api/console/conversations/${encodeURIComponent(id)}`;

export const fetchQueue = (): Promise<Queue> => call(QueueSchema, '/api/console/queue');

export const fetchConversation = (id: string, after = 0): Promise<ConsoleSnapshot> =>
  call(ConsoleSnapshotSchema, `${base(id)}?after=${after}`);

export const fetchEmployeeTickets = (id: string): Promise<EmployeeTickets> =>
  call(EmployeeTicketsSchema, `${base(id)}/tickets`);

export const runConsoleAction = (id: string, action: ConsoleAction): Promise<ConsoleSnapshot> =>
  call(ConsoleSnapshotSchema, `${base(id)}/actions/${action}`, { method: 'POST' });

export async function sendAnalystMessage(id: string, text: string): Promise<ChatMessage> {
  const { message } = await call(z.object({ message: ChatMessageSchema }), `${base(id)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
  return message;
}
