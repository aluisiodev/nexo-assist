import { NextResponse } from 'next/server';
import type { ConsoleSnapshot } from '@/lib/console';
import { container } from '@/server/container';
import { withUser } from '@/server/http';

/** GET /api/console/conversations/:id?after=<seq>: conversa e mensagens novas (polling). */
export const GET = withUser<{ params: Promise<{ id: string }> }>('analyst', async (_user, req, ctx) => {
  const { id } = await ctx.params;
  const after = Number(new URL(req.url).searchParams.get('after') ?? 0);
  const { console: consoleService } = await container();
  const snapshot = await consoleService.snapshot(id, Number.isFinite(after) && after > 0 ? after : 0);
  return NextResponse.json<ConsoleSnapshot>(snapshot, { headers: { 'cache-control': 'no-store' } });
});
