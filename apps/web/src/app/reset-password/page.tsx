'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { Alert, Button, Field, Spinner, inputClass } from '@/components/ui';
import { ApiError, post } from '@/lib/api';

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params?.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <Alert tone="error" title="Link incomplete">
        This reset link is missing its token. Request a new one from the{' '}
        <Link href="/forgot-password" className="underline">
          forgot password
        </Link>{' '}
        page.
      </Alert>
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFields({});
    setBusy(true);

    try {
      await post('/auth/reset-password', { token, password, confirmPassword });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setFields(err.fields ?? {});
        if (!err.fields) setError(err.message);
      } else {
        setError('Could not reset your password. Try again.');
      }
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Password updated">
          You have been signed out everywhere else for safety.
        </Alert>
        <Button className="w-full" onClick={() => router.push('/login')}>
          Sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Field label="New password" error={fields.password} hint="At least 10 characters.">
        <input
          type="password"
          required
          autoFocus
          autoComplete="new-password"
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      <Field label="Confirm new password" error={fields.confirmPassword}>
        <input
          type="password"
          required
          autoComplete="new-password"
          className={inputClass}
          value={confirmPassword}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>

      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Updating…' : 'Set new password'}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password">
      <Suspense fallback={<Spinner />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
