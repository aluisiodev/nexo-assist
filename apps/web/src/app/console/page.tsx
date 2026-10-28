import type { Metadata } from 'next';
import { ConsoleView } from '@/components/console/console-view';
import { requireUser } from '@/server/auth/session';
import { container } from '@/server/container';

export const metadata: Metadata = { title: 'Console do analista' };

/** Tela 4: fila de conversas do analista. */
export default async function ConsolePage() {
  const user = await requireUser('analyst');
  const { console: consoleService } = await container();
  const { items } = await consoleService.queue();
  return (
    <ConsoleView
      initialItems={items}
      initialSnapshot={null}
      viewer={{ id: user.employeeId, name: user.name, group: user.supportGroup }}
      serverNow={new Date().toISOString()}
    />
  );
}
