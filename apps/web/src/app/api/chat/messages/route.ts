import { NextResponse } from 'next/server';
import { SendMessageInputSchema } from '@/lib/chat';
import { container } from '@/server/container';
import { readJson, withUser } from '@/server/http';

/** POST /api/chat/messages: envia uma mensagem do funcionário e devolve as mensagens novas. */
export const POST = withUser('employee', async (user, req) => {
  const { text } = SendMessageInputSchema.parse(await readJson(req));
  const { conversations } = await container();
  return NextResponse.json(await conversations.sendEmployeeMessage(user, text));
});
