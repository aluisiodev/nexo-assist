import { Info, KeyRound, Lock } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { TopBar } from '@/components/top-bar';
import { requireUser } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Meu perfil' };

export default async function ProfilePage() {
  const user = await requireUser('employee');
  return (
    <>
      <TopBar here="Meu perfil" />
      <main className="flex flex-1 justify-center overflow-y-auto px-5 py-12 sm:px-10">
        <div className="flex w-full max-w-[600px] flex-col gap-8">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-bold tracking-[-0.4px] text-ink">Meu perfil</h1>
            <p className="text-[14.5px] text-ink-3">Seus dados de acesso ao service desk de TI.</p>
          </div>

          <dl className="overflow-hidden rounded-2xl border border-ink/9 bg-paper shadow-card">
            <Row label="Nome">{user.name}</Row>
            <Row label="Departamento">{user.department}</Row>
            <Row label="E-mail corporativo" last note="Gerenciado pela TI">
              {user.email}
            </Row>
          </dl>

          <section className="overflow-hidden rounded-2xl border border-ink/9 bg-paper shadow-card">
            <div className="flex items-center gap-4 p-6">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-desk">
                <KeyRound className="size-[18px] text-ink-2" aria-hidden="true" />
              </span>
              <div className="flex flex-1 flex-col gap-0.5">
                <h2 className="text-[14.5px] font-semibold text-ink">Senha</h2>
                <p className="text-[13.5px] text-ink-3">É a mesma senha da rede Nexo.</p>
              </div>
            </div>
            <p className="flex items-center gap-2 border-t border-rule bg-desk px-6 py-3 text-[13px] text-ink-3">
              <Info className="size-3.5 shrink-0" aria-hidden="true" />
              Para trocar, use o autoatendimento em senha.nexo.com.br ou peça ajuda ao Nexo Assist.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}

function Row({
  label,
  children,
  note,
  last = false,
}: {
  label: string;
  children: ReactNode;
  note?: string;
  last?: boolean;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-4 px-6 py-5 ${last ? '' : 'border-b border-rule'}`}>
      <dt className="w-40 text-[13.5px] text-ink-3">{label}</dt>
      <dd className="flex-1 text-[14.5px] font-medium text-ink">{children}</dd>
      {note && (
        <span className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
          <Lock className="size-[13px]" aria-hidden="true" />
          {note}
        </span>
      )}
    </div>
  );
}
