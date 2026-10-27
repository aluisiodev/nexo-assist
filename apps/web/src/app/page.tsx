import { redirect } from 'next/navigation';
import { currentUser, homeFor } from '@/server/auth/session';

export default async function Home() {
  const user = await currentUser();
  redirect(user ? homeFor(user) : '/login');
}
