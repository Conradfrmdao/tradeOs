'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { Alert, Button, Spinner } from '@/components/ui';
import { ApiError, post } from '@/lib/api';
import { useSession } from '@/lib/session';

function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const { refresh } = useSession();

  const [state, setState] = useState<'working' | 'ok' | 'failed'>('working');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (!token) {
      setState('failed');
      setMessage('This verification link is missing its token.');
      return;
    }

    // React 18+ mounts effects twice in development; the token is single-use,
    // so the second call would always fail.
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        await post('/auth/verify-email', { token });
        await refresh();
        setState('ok');
      } catch (err) {
        setState('failed');
        setMessage(
          err instanceof ApiError ? err.message : 'Could not verify this link.',
        );
      }
    })();
  }, [token, refresh]);

  if (state === 'working') return <Spinner label="Verifying your email" />;

  if (state === 'ok') {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Email verified">
          Your account is ready. You can now connect trading accounts.
        </Alert>
        <Link href="/dashboard">
          <Button className="w-full">Go to dashboard</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Alert tone="error" title="Verification failed">
        {message}
      </Alert>
      <Link href="/dashboard">
        <Button variant="secondary" className="w-full">
          Go to dashboard
        </Button>
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthShell title="Email verification">
      <Suspense fallback={<Spinner />}>
        <VerifyEmail />
      </Suspense>
    </AuthShell>
  );
}
