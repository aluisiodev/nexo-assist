import type { Metadata } from 'next';
import { ChatView } from '@/components/chat/chat-view';
import { requireUser } from '@/server/auth/session';
import { container } from '@/server/container';

export const metadata: Metadata = { title: 'Atendimento' };

/** Telas 2 e 3: conversa do funcionário com o Nexo Assist. Retoma a conversa em aberto. */
export default async function AttendancePage() {
  const user = await requireUser('employee');
  const { conversations, responder } = await container();
  const snapshot = await conversations.snapshotFor(user);
  return <ChatView initial={snapshot} engine={responder.name} />;
}
