import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

/** Barra superior com trilha ("Service desk de TI › Atendimento") e ações à direita. */
export function TopBar({ here, children }: { here: string; children?: ReactNode }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-rule px-5 sm:px-8">
      <nav aria-label="Trilha" className="flex min-w-0 flex-1 items-center gap-2 text-[13.5px]">
        <span className="hidden text-ink-3 sm:inline">Service desk de TI</span>
        <ChevronRight className="hidden size-3.5 text-ink-3 sm:block" aria-hidden="true" />
        <span className="font-semibold text-ink">{here}</span>
      </nav>
      {children}
    </header>
  );
}
