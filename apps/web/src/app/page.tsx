'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { Spinner } from '@/components/ui';

/** Entry point: straight to the dashboard when signed in, else to login. */
export default function Home() {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/dashboard' : '/sign-in');
  }, [user, loading, router]);

  return <Spinner label="Starting TradeOS" />;
}
