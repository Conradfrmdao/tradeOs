'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AccountRole, PairingDto, Platform } from '@tradeos/shared';
import { Alert, Button, Card, Field, PageHeader, Spinner, inputClass } from '@/components/ui';
import { ApiError, post } from '@/lib/api';
import { useLiveData } from '@/lib/live-data';
import { PairingInstructions } from '@/components/pairing-instructions';

function NewAccountForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { accounts, reload } = useLiveData();

  const hasMaster = accounts.some((a) => a.role === 'MASTER');

  const [form, setForm] = useState({
    name: '',
    platform: (params.get('platform') as Platform) ?? 'MT5',
    // Without a master there is nothing to follow, so the first account must
    // be the master regardless of what the link asked for.
    role: (!hasMaster ? 'MASTER' : ((params.get('role') as AccountRole) ?? 'FOLLOWER')) as AccountRole,
    broker: '',
    accountNumber: '',
    server: '',
  });

  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState<PairingDto | null>(null);

  const update =
    (key: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFields({});
    setBusy(true);

    try {
      const data = await post<{ accountId: string; pairing: PairingDto }>('/accounts', {
        name: form.name,
        platform: form.platform,
        role: form.role,
        broker: form.broker || undefined,
        accountNumber: form.accountNumber,
        server: form.server || undefined,
      });

      await reload();
      setPairing(data.pairing);
    } catch (err) {
      if (err instanceof ApiError) {
        setFields(err.fields ?? {});
        if (!err.fields) setError(err.message);
      } else {
        setError('Could not create the account. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (pairing) {
    return (
      <>
        <PageHeader
          title="Connect your terminal"
          description="One more step: link the MetaTrader terminal to this account."
        />
        <PairingInstructions pairing={pairing} platform={form.platform} />
        <div className="mt-6 flex gap-3">
          <Button onClick={() => router.push(`/accounts/${pairing.accountId}`)}>
            Done — view account
          </Button>
          <Link href="/accounts/new">
            <Button variant="secondary">Add another account</Button>
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={form.role === 'MASTER' ? 'Connect master account' : 'Add follower account'}
        description={
          form.role === 'MASTER'
            ? 'Trades are detected on this account and copied to your followers.'
            : 'This account receives copies of the master account’s trades.'
        }
      />

      <div className="max-w-xl">
        <Alert tone="info" title="Your trading password is not required">
          TradeOS connects through a small agent that runs inside your own MetaTrader terminal. It
          reports what it sees and executes what you configure here — your broker password never
          leaves your machine.
        </Alert>

        <Card className="mt-6">
          <form onSubmit={onSubmit} className="space-y-4">
            {error ? <Alert tone="error">{error}</Alert> : null}

            <Field label="Account name" error={fields.name} hint="Anything you'll recognise, e.g. “Funded Account 01”.">
              <input
                required
                autoFocus
                className={inputClass}
                value={form.name}
                onChange={update('name')}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Platform" error={fields.platform}>
                <select className={inputClass} value={form.platform} onChange={update('platform')}>
                  <option value="MT5">MetaTrader 5</option>
                  <option value="MT4">MetaTrader 4</option>
                </select>
              </Field>

              <Field
                label="Role"
                error={fields.role}
                hint={!hasMaster ? 'Your first account must be the master.' : undefined}
              >
                <select
                  className={inputClass}
                  value={form.role}
                  onChange={update('role')}
                  disabled={!hasMaster}
                >
                  <option value="MASTER">Master — trades originate here</option>
                  <option value="FOLLOWER">Follower — receives copied trades</option>
                </select>
              </Field>
            </div>

            <Field
              label="Account login number"
              error={fields.accountNumber}
              hint="The login shown in MetaTrader. Used to confirm you attach the agent to the right terminal."
            >
              <input
                required
                inputMode="numeric"
                className={inputClass}
                value={form.accountNumber}
                onChange={update('accountNumber')}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Broker" error={fields.broker} hint="Optional — filled in automatically on connect.">
                <input className={inputClass} value={form.broker} onChange={update('broker')} />
              </Field>

              <Field label="Server" error={fields.server} hint="Optional, e.g. “Broker-Live01”.">
                <input className={inputClass} value={form.server} onChange={update('server')} />
              </Field>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create and get pairing code'}
              </Button>
              <Link href="/accounts">
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}

export default function NewAccountPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <NewAccountForm />
    </Suspense>
  );
}
