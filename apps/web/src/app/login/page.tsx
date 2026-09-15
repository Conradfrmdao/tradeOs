'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { UserDto } from '@tradeos/shared';
import { AuthShell } from '@/components/auth-shell';
import { Alert, Button, Field, inputClass } from '@/components/ui';
import { ApiError, post } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const data = await post<{ user: UserDto }>('/auth/login', { email, password });
      setUser(data.user);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Try again.');
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Access your trading dashboard."
      footer={
        <>
          No account?{' '}
          <Link href="/signup" className="font-medium text-slate-900 underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error ? <Alert tone="error">{error}</Alert> : null}

        <Field label="Email">
          <input
            type="email"
            required
            autoComplete="email"
            autoFocus
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label="Password">
          <input
            type="password"
            required
            autoComplete="current-password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>

        <div className="text-center">
          <Link href="/forgot-password" className="text-sm text-slate-600 underline">
            Forgot your password?
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
