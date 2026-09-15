'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { UserDto } from '@tradeos/shared';
import { ApiError, get, post } from './api';

interface SessionValue {
  user: UserDto | null;
  loading: boolean;
  /** Clerk says signed in, but the API will not accept us. */
  mismatch: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: UserDto | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [mismatch, setMismatch] = useState(false);
  const router = useRouter();

  // Clerk's own view of whether anyone is signed in.
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();

  const refresh = useCallback(async () => {
    try {
      const data = await get<{ user: UserDto }>('/auth/me');
      setUser(data.user);
      setMismatch(false);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) {
        console.error('Failed to load session', err);
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Wait for Clerk before asking the API, so the request carries a token.
  useEffect(() => {
    if (!clerkLoaded) return;
    void refresh();
  }, [clerkLoaded, isSignedIn, refresh]);

  // Clerk is satisfied but the API is not. That combination is what used to
  // bounce the user between /sign-in and /dashboard forever, so it is recorded
  // as a state to show rather than a reason to navigate.
  useEffect(() => {
    if (!clerkLoaded || loading) return;
    setMismatch(Boolean(isSignedIn) && user === null);
  }, [clerkLoaded, loading, isSignedIn, user]);

  const signOut = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      setUser(null);
      router.push('/sign-in');
    }
  }, [router]);

  const value = useMemo(
    () => ({ user, loading, mismatch, refresh, signOut, setUser }),
    [user, loading, mismatch, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
}

/**
 * Sends genuinely signed-out visitors to Clerk.
 *
 * Deliberately does **not** redirect when Clerk reports a session but the API
 * rejects it. Redirecting there produces an infinite loop, because Clerk's
 * sign-in page immediately sends an already-authenticated user back again. The
 * caller renders an explanation instead.
 */
export function useRequireAuth(): SessionValue {
  const session = useSession();
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!clerkLoaded || session.loading) return;
    if (session.user) return;
    if (isSignedIn) return; // mismatch — handled by the caller, never a redirect
    router.replace('/sign-in');
  }, [clerkLoaded, isSignedIn, session.loading, session.user, router]);

  return session;
}
