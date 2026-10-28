'use client';

import { Inbox, LogOut, MessageSquare, UserRound, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/app/login/actions';
import { initials } from '@/lib/format';
import { NexoMark } from './nexo-mark';

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

const NAV: Record<'employee' | 'analyst', readonly NavItem[]> = {
  employee: [
    { href: '/atendimento', label: 'Atendimento', icon: MessageSquare },
    { href: '/perfil', label: 'Meu perfil', icon: UserRound },
  ],
  analyst: [{ href: '/console', label: 'Fila de atendimento', icon: Inbox }],
};

/** Barra lateral: telas do funcionário (Telas 2, 3 e perfil) e console do analista (Telas 4 e 5). */
export function AppSidebar({
  name,
  email,
  variant = 'employee',
}: {
  name: string;
  email: string;
  variant?: 'employee' | 'analyst';
}) {
  const pathname = usePathname();
  const items = NAV[variant];

  return (
    <>
      {/* Celular: barra compacta no topo no lugar da lateral. */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-rule px-3 md:hidden">
        <NexoMark className="mr-1 size-5" />
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={pathname.startsWith(href) ? 'page' : undefined}
            className={`grid size-9 place-items-center rounded-lg ${pathname.startsWith(href) ? 'bg-primary-soft text-primary-text' : 'text-ink-3'}`}
          >
            <Icon className="size-4" aria-hidden="true" />
          </Link>
        ))}
        <span className="flex-1" />
        <form action={logout}>
          <button type="submit" aria-label="Sair" className="grid size-9 place-items-center rounded-lg text-ink-3">
            <LogOut className="size-4" aria-hidden="true" />
          </button>
        </form>
      </div>
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-rule px-3.5 pb-3.5 pt-5 md:flex">
        <div className="flex items-center gap-2.5 px-2">
          <NexoMark className="size-5" />
          <span className="text-base font-bold tracking-[-0.2px] text-ink">Nexo Assist</span>
        </div>

        <nav className="mt-[22px] flex flex-col gap-0.5" aria-label="Principal">
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] ${
                  active ? 'bg-primary-soft font-semibold text-primary-text' : 'font-medium text-ink-2 hover:bg-desk'
                }`}
              >
                <Icon className={`size-4 ${active ? 'text-primary-text' : 'text-ink-3'}`} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <div className="flex items-center gap-2.5 border-t border-rule px-2 pb-1 pt-3.5">
          <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-primary-soft text-[12.5px] font-bold text-primary-text">
            {initials(name)}
          </span>
          <span className="flex min-w-0 flex-col gap-px">
            <span className="truncate text-[13.5px] font-semibold text-ink">{name}</span>
            <span className="truncate text-[11.5px] text-ink-3">{email}</span>
          </span>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium text-ink-2 hover:bg-desk"
          >
            <LogOut className="size-4 text-ink-3" aria-hidden="true" />
            Sair
          </button>
        </form>
      </aside>
    </>
  );
}
