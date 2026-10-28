import { NextResponse } from 'next/server';
import type { Queue } from '@/lib/console';
import { container } from '@/server/container';
import { withUser } from '@/server/http';

/** GET /api/console/queue: fila de conversas do console (usado no polling). */
export const GET = withUser('analyst', async () => {
  const { console: consoleService } = await container();
  return NextResponse.json<Queue>(await consoleService.queue(), { headers: { 'cache-control': 'no-store' } });
});
