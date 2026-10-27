import { NextResponse } from 'next/server';
import { container } from '@/server/container';
import { withUser } from '@/server/http';

/** POST /api/chat/new: encerra a conversa atual e começa outra. */
export const POST = withUser('employee', async (user) => {
  const { conversations } = await container();
  return NextResponse.json(await conversations.startNew(user));
});
