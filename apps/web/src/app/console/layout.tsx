import type { ReactNode } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { requireUser } from '@/server/auth/session';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const user = await requireUser('analyst');
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper md:flex-row">
      <AppSidebar name={user.name} email={user.email} variant="analyst" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
