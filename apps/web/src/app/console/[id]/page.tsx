import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConsoleView } from '@/components/console/console-view';
import { requireUser } from '@/server/auth/session';
import { container } from '@/server/container';
import { ConversationError } from '@/server/conversations/service';

export const metadata: Metadata = { title: 'Console do analista' };

/** Tela 5: uma conversa aberta no console (link direto, ex.: /console/c_…). */
export default async function ConsoleConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('analyst');
  const { id } = await params;
  const { console: consoleService } = await container();
  const [{ items }, snapshot] = await Promise.all([
    consoleService.queue(),
    consoleService.snapshot(id).catch((err: unknown) => {
      if (err instanceof ConversationError && err.code === 'not_found') return null;
      throw err;
    }),
  ]);
  if (!snapshot) notFound();
  return (
    <ConsoleView
      initialItems={items}
      initialSnapshot={snapshot}
      viewer={{ id: user.employeeId, name: user.name, group: user.supportGroup }}
      serverNow={new Date().toISOString()}
    />
  );
}
