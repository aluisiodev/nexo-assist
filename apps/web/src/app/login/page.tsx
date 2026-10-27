import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { NexoMark } from '@/components/nexo-mark';
import { currentUser, homeFor } from '@/server/auth/session';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Entrar' };

/** Tela 1 do protótipo: apresentação à esquerda, formulário à direita. */
export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(homeFor(user));

  return (
    <main className="flex min-h-screen bg-paper">
      <Showcase />
      <section className="flex min-h-screen flex-1 flex-col justify-between px-6 py-8 sm:px-14 sm:py-10">
        <div className="flex items-center justify-end gap-1.5 text-[13.5px]">
          <span className="text-ink-3">Problema para entrar?</span>
          <a href="tel:4000" className="font-semibold text-primary-text hover:underline">
            Ligue no ramal 4000
          </a>
        </div>

        <div className="flex justify-center py-10">
          <div className="flex w-full max-w-[380px] flex-col gap-7">
            <div className="flex items-center gap-2.5 lg:hidden">
              <NexoMark className="size-6" />
              <span className="text-[17px] font-bold tracking-[-0.2px] text-ink">Nexo Assist</span>
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="font-display text-[40px] leading-[1.1] tracking-[-0.8px] text-ink">Entrar</h1>
              <p className="text-[15.5px] leading-normal text-ink-3">
                Use seu e-mail corporativo e a senha da rede Nexo.
              </p>
            </div>
            <LoginForm />
          </div>
        </div>

        <footer className="flex justify-between gap-4 text-[12.5px] text-ink-3">
          <span>© 2026 Nexo · Service desk de TI</span>
          <span>Privacidade e uso de dados</span>
        </footer>
      </section>
    </main>
  );
}

function Showcase() {
  return (
    <aside className="hidden w-[800px] max-w-[55vw] shrink-0 flex-col justify-between bg-ink px-16 pb-12 pt-10 lg:flex">
      <div className="flex items-center gap-2.5">
        <NexoMark className="size-6" color="#FFFFFF" />
        <span className="text-[17px] font-bold tracking-[-0.2px] text-white">Nexo Assist</span>
      </div>

      <div className="flex flex-col gap-9">
        <div className="flex flex-col gap-[18px]">
          <p className="text-[13.5px] font-medium text-white/55">Service desk de TI da Nexo</p>
          <h2 className="font-display text-[54px] leading-[1.04] tracking-[-1.2px] text-white">
            Seu problema de TI, resolvido em uma conversa.
          </h2>
          <p className="max-w-[520px] text-base leading-[1.55] text-white/65">
            Descreva o que está acontecendo. O assistente consulta seus chamados, busca na central de ajuda e chama um
            analista quando precisa.
          </p>
        </div>

        {/* Exemplo ilustrativo de conversa (como no protótipo). */}
        <div className="pl-24" aria-hidden="true">
          <div className="flex w-[500px] max-w-full flex-col gap-2.5 rounded-2xl border border-white/8 bg-white/[0.04] p-[18px]">
            <div className="flex justify-end">
              <p className="rounded-[12px_12px_4px_12px] bg-paper px-3.5 py-[9px] text-[13.5px] text-ink">
                Meu notebook não conecta na VPN. Erro 809.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="flex gap-1.5 text-[12.5px]">
                <span className="font-semibold text-white/80">Nexo Assist</span>
                <span className="text-white/45">consultou seus chamados · criou um chamado</span>
              </p>
              <p className="w-[380px] max-w-full rounded-[4px_12px_12px_12px] bg-white/8 px-3.5 py-2.5 text-[13.5px] leading-normal text-white">
                Pronto: abri o chamado com prioridade alta. Um analista fala com você em até 4 h úteis.
              </p>
              <p className="flex w-fit items-center gap-2 rounded-xl bg-paper px-3 py-[7px] text-[12.5px]">
                <span className="size-[7px] rounded-full bg-warning" />
                <span className="font-semibold text-ink">INC-20517</span>
                <span className="text-ink-3">Rede e VPN · Alta · em até 4 h</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Fatos das regras do service desk (Anexo A), no lugar das métricas ilustrativas do protótipo. */}
      <dl className="grid grid-cols-3 border-t border-white/10 pt-6">
        {[
          { value: '24 h', label: 'plantão para chamados críticos', live: false },
          { value: '4 h', label: 'úteis de prazo para prioridade alta', live: false },
          { value: '8h–18h', label: 'analistas em dias úteis', live: true },
        ].map((s, i) => (
          <div key={s.label} className={`flex flex-col gap-1.5 ${i > 0 ? 'border-l border-white/10 pl-6' : ''}`}>
            <dt className="order-2 text-[13.5px] text-white/55">{s.label}</dt>
            <dd className="flex items-center gap-2 font-display text-[34px] tracking-[-0.6px] text-white">
              {s.value}
              {s.live && <span className="size-2 rounded-full bg-success" />}
            </dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
