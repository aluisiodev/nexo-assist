import { NextResponse } from 'next/server';
import type { ChatSnapshot } from '@/lib/chat';
import { container } from '@/server/container';
import { withUser } from '@/server/http';

/** GET /api/chat?after=<seq>: conversa atual e mensagens novas (usado no polling). */
export const GET = withUser('employee', async (user, req) => {
  const after = Number(new URL(req.url).searchParams.get('after') ?? 0);
  const { conversations } = await container();
  const snapshot = await conversations.snapshotFor(user, Number.isFinite(after) && after > 0 ? after : 0);
  return NextResponse.json<ChatSnapshot>(snapshot, { headers: { 'cache-control': 'no-store' } });
});
