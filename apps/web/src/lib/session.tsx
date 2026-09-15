'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { UserDto } from '@tradeos/shared';
import { ApiError, get, post } from './api';

interface SessionValue {
  user: UserDto | null;
  loading: boolean;
  /** Clerk says signed in, but the API will not accept us — after retries. */
  mismatch: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: UserDto | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * How many times to re-ask the API before deciding a Clerk session is genuinely
 * not accepted.
 *
 * Clerk's script can report `isSignedIn` a moment before the session token is
 * retrievable, so the first call can legitimately come back 401. Treating that
 * first answer as final is what made an alarming error flash on every load.
 */
const AUTH_RETRIES = 4;
const RETRY_DELAY_MS = 350;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [mismatch, setMismatch] = useState(false);
  const router = useRouter();

  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();

  // Read inside the retry loop without making it a dependency.
  const signedInRef = useRef(isSignedIn);
  signedInRef.current = isSignedIn;

  const refresh = useCallback(async () => {
    setMismatch(false);

    for (let attempt = 0; attempt <= AUTH_RETRIES; attempt++) {
      try {
        const data = await get<{ user: UserDto }>('/auth/me');
        setUser(data.user);
        setMismatch(false);
        setLoading(false);
        return;
      } catch (err) {
        const unauthorized = err instanceof ApiError && err.status === 401;

        if (!unauthorized) {
          console.error('Failed to load session', err);
          setUser(null);
          setLoading(false);
          return;
        }

        // Genuinely signed out — no point retrying.
        if (!signedInRef.current) {
          setUser(null);
          setLoading(false);
          return;
        }

        // Clerk claims a session; give the token a moment to become available
        // before concluding anything is wrong.
        if (attempt < AUTH_RETRIES) {
          await wait(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }

        setUser(null);
        setMismatch(true);
        setLoading(false);
      }
    }
  }, []);

  // Wait for Clerk before asking, so the first request can carry a token.
  useEffect(() => {
    if (!clerkLoaded) return;
    void refresh();
  }, [clerkLoaded, isSignedIn, refresh]);

  const signOut = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      setUser(null);
      // The landing page, not sign-in: someone who just signed out is more
      // likely to be leaving than to be signing straight back in.
      router.push('/');
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
 * Deliberately does **not** redirect when Clerk reports a session the API
 * rejects: Clerk's sign-in page returns an authenticated user immediately, so
 * that redirect can only loop. The caller renders an explanation instead.
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
