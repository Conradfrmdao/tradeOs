'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { UserDto } from '@tradeos/shared';
import { AuthShell } from '@/components/auth-shell';
import { Alert, Button, Field, inputClass } from '@/components/ui';
import { ApiError, post } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function SignupPage() {
  const router = useRouter();
  const { setUser } = useSession();

  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFields({});
    setBusy(true);

    try {
      const data = await post<{ user: UserDto }>('/auth/signup', form);
      setUser(data.user);
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        setFields(err.fields ?? {});
        // Field-level messages are shown inline; only show a banner when the
        // failure is not attributable to a specific input.
        if (!err.fields) setError(err.message);
      } else {
        setError('Could not create your account. Try again.');
      }
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Connect a master account and up to ten followers."
      footer={
        <>
          Already registered?{' '}
          <Link href="/login" className="font-medium text-slate-900 underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error ? <Alert tone="error">{error}</Alert> : null}

        <Field label="Name" error={fields.name}>
          <input required autoComplete="name" className={inputClass} value={form.name} onChange={update('name')} />
        </Field>

        <Field label="Email" error={fields.email}>
          <input
            type="email"
            required
            autoComplete="email"
            className={inputClass}
            value={form.email}
            onChange={update('email')}
          />
        </Field>

        <Field
          label="Password"
          error={fields.password}
          hint="At least 10 characters. A passphrase is easier to remember and harder to guess."
        >
          <input
            type="password"
            required
            autoComplete="new-password"
            className={inputClass}
            value={form.password}
            onChange={update('password')}
          />
        </Field>

        <Field label="Confirm password" error={fields.confirmPassword}>
          <input
            type="password"
            required
            autoComplete="new-password"
            className={inputClass}
            value={form.confirmPassword}
            onChange={update('confirmPassword')}
          />
        </Field>

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  );
}
