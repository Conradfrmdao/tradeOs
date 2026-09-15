'use client';

import { useState } from 'react';
import type { UserDto, UserSettingsDto } from '@tradeos/shared';
import { formatDateTime } from '@tradeos/shared';
import { ApiError, patch, post } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLiveData } from '@/lib/live-data';
import { Alert, Button, Card, Field, PageHeader, Spinner, inputClass } from '@/components/ui';

export default function SettingsPage() {
  const { user, refresh } = useSession();
  const { notifications, unreadCount, markNotificationsRead } = useLiveData();

  if (!user) return <Spinner />;

  return (
    <>
      <PageHeader title="Settings" description="Your profile, security and notifications." />

      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileCard user={user} onSaved={refresh} />
        <PasswordCard />
        <NotificationsCard settings={user.settings} onSaved={refresh} />

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Recent notifications</h2>
            {unreadCount > 0 ? (
              <Button variant="secondary" onClick={() => void markNotificationsRead()}>
                Mark all read ({unreadCount})
              </Button>
            ) : null}
          </div>

          {notifications.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Nothing yet.</p>
          ) : (
            <ol className="max-h-80 space-y-3 overflow-y-auto">
              {notifications.slice(0, 20).map((n) => (
                <li key={n.id} className="border-b border-slate-100 pb-3 last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">{n.title}</p>
                    {!n.readAt ? (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-label="Unread" />
                    ) : null}
                  </div>
                  {n.body ? <p className="mt-0.5 text-sm text-slate-600">{n.body}</p> : null}
                  <p className="mt-1 text-xs text-slate-400">{formatDateTime(n.createdAt)}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}

function ProfileCard({ user, onSaved }: { user: UserDto; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(user.name);
  const [timezone, setTimezone] = useState(user.settings.timezone);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Offered as a one-click default because "today's profit" is computed in
  // this timezone, and a wrong one silently shifts the daily figure.
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await patch('/auth/profile', { name, timezone });
      await onSaved();
      setMessage('Saved');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-4 font-semibold text-slate-900">Profile</h2>

      <div className="space-y-4">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Email">
          <input className={inputClass} value={user.email} disabled />
        </Field>

        <Field
          label="Timezone"
          hint={
            timezone === detected
              ? 'Daily profit is calculated against midnight in this timezone.'
              : `Your browser reports ${detected}.`
          }
        >
          <div className="flex gap-2">
            <input
              className={inputClass}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
            {timezone !== detected ? (
              <Button variant="secondary" onClick={() => setTimezone(detected)} className="shrink-0">
                Use {detected}
              </Button>
            ) : null}
          </div>
        </Field>

        <div className="flex items-center gap-3">
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save profile'}
          </Button>
          {message ? <span className="text-sm text-slate-600">{message}</span> : null}
        </div>
      </div>
    </Card>
  );
}

function PasswordCard() {
  const [form, setForm] = useState({ currentPassword: '', password: '', confirmPassword: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFields({});
    setMessage(null);

    try {
      await post('/auth/change-password', form);
      setForm({ currentPassword: '', password: '', confirmPassword: '' });
      setMessage('Password updated. Other devices have been signed out.');
    } catch (err) {
      if (err instanceof ApiError) {
        setFields(err.fields ?? {});
        if (!err.fields) setMessage(err.message);
      } else {
        setMessage('Could not change your password.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-4 font-semibold text-slate-900">Password</h2>

      <form onSubmit={save} className="space-y-4">
        {message ? <Alert tone="info">{message}</Alert> : null}

        <Field label="Current password" error={fields.currentPassword}>
          <input
            type="password"
            required
            autoComplete="current-password"
            className={inputClass}
            value={form.currentPassword}
            onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
          />
        </Field>

        <Field label="New password" error={fields.password} hint="At least 10 characters.">
          <input
            type="password"
            required
            autoComplete="new-password"
            className={inputClass}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>

        <Field label="Confirm new password" error={fields.confirmPassword}>
          <input
            type="password"
            required
            autoComplete="new-password"
            className={inputClass}
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
          />
        </Field>

        <Button type="submit" disabled={busy}>
          {busy ? 'Updating…' : 'Change password'}
        </Button>
      </form>
    </Card>
  );
}

function NotificationsCard({
  settings,
  onSaved,
}: {
  settings: UserSettingsDto;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await patch('/notifications/preferences', {
        notifyEmail: form.notifyEmail,
        notifyOnCopyOk: form.notifyOnCopyOk,
        notifyOnCopyFail: form.notifyOnCopyFail,
        notifyOnConnect: form.notifyOnConnect,
        notifyOnDisconnect: form.notifyOnDisconnect,
      });
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  const rows: Array<[keyof UserSettingsDto, string, string]> = [
    ['notifyEmail', 'Email notifications', 'Master switch for everything below.'],
    ['notifyOnDisconnect', 'Account disconnects', 'Strongly recommended — copying stops while an account is offline.'],
    ['notifyOnConnect', 'Account reconnects', ''],
    ['notifyOnCopyFail', 'Copy failures', 'A trade that could not be placed on a follower.'],
    ['notifyOnCopyOk', 'Every successful copy', 'Noisy if you trade often.'],
  ];

  return (
    <Card>
      <h2 className="mb-4 font-semibold text-slate-900">Notifications</h2>

      <div className="space-y-3">
        {rows.map(([key, label, hint]) => (
          <label key={key} className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={Boolean(form[key])}
              disabled={key !== 'notifyEmail' && !form.notifyEmail}
              onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
            />
            <span>
              <span className="block text-sm text-slate-800">{label}</span>
              {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save preferences'}
        </Button>
        {saved ? <span className="text-sm text-emerald-700">Saved</span> : null}
      </div>
    </Card>
  );
}
