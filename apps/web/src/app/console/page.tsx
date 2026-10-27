import { Headset, MessageSquare } from 'lucide-react';
import type { Metadata } from 'next';
import { logout } from '@/app/login/actions';
import { NexoMark } from '@/components/nexo-mark';
import { requireUser } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Console do analista' };

/** Console do analista (Telas 4 e 5): próxima etapa. */
export default async function ConsolePage() {
  const user = await requireUser('analyst');
  return (
    <main className="grid min-h-dvh place-items-center bg-desk px-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-ink/9 bg-paper p-8 text-center shadow-card">
        <NexoMark className="size-7" />
        <Headset className="size-6 text-ink-3" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-ink">Olá, {user.name}</h1>
        <p className="text-[14.5px] leading-normal text-ink-3">
          Você entrou como analista do Suporte {user.supportGroup ?? ''}. O console com a fila de conversas está em
          construção.
        </p>
        <p className="flex items-center gap-2 text-[13px] text-ink-3">
          <MessageSquare className="size-4" aria-hidden="true" /> As conversas transferidas já ficam salvas.
        </p>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-lg border border-ink/12 px-4 py-2 text-[13.5px] font-medium text-ink-2 hover:bg-desk"
          >
            Sair
          </button>
        </form>
      </div>
    </main>
  );
}
