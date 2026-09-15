'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UserDto } from '@tradeos/shared';
import { ApiError, get, post } from './api';

interface SessionValue {
  user: UserDto | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: UserDto | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const data = await get<{ user: UserDto }>('/auth/me');
      setUser(data.user);
    } catch (err) {
      // A 401 here is the normal signed-out state, not an error worth showing.
      if (!(err instanceof ApiError) || err.status !== 401) {
        console.error('Failed to load session', err);
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      setUser(null);
      router.push('/sign-in');
    }
  }, [router]);

  const value = useMemo(
    () => ({ user, loading, refresh, signOut, setUser }),
    [user, loading, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
}

/** Redirects to the login page once it is certain there is no session. */
export function useRequireAuth(): SessionValue {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!session.loading && !session.user) router.replace('/sign-in');
  }, [session.loading, session.user, router]);

  return session;
}
