import type { ReactNode } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { requireUser } from '@/server/auth/session';

export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const user = await requireUser('employee');
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper md:flex-row">
      <AppSidebar name={user.name} email={user.email} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
