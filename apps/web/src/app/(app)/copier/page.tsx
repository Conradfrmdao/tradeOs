'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CopierSettingsDto, RiskMode } from '@tradeos/shared';
import { get, patch, post } from '@/lib/api';
import { useLiveData } from '@/lib/live-data';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Spinner,
  Toggle,
  cx,
  inputClass,
} from '@/components/ui';
import { CopyEventFeed } from '@/components/copy-event-feed';

export default function CopierPage() {
  const { events, accounts, reload } = useLiveData();

  const [copiers, setCopiers] = useState<CopierSettingsDto[]>([]);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [emergencyStopAt, setEmergencyStopAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await get<{
      copiers: CopierSettingsDto[];
      globalCopyingEnabled: boolean;
      emergencyStopAt: string | null;
    }>('/copier');
    setCopiers(data.copiers);
    setGlobalEnabled(data.globalCopyingEnabled);
    setEmergencyStopAt(data.emergencyStopAt);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleGlobal(enabled: boolean) {
    setBusy(true);
    setGlobalEnabled(enabled); // optimistic — the switch must feel instant
    try {
      await post('/copier/global', { enabled });
      await Promise.all([load(), reload()]);
    } catch {
      setGlobalEnabled(!enabled);
    } finally {
      setBusy(false);
    }
  }

  async function emergencyStop() {
    const ok = window.confirm(
      'Stop all copying?\n\n' +
        'New master trades will not be copied and anything already queued is cancelled.\n' +
        'Open positions are NOT closed — use Close All separately if that is what you want.',
    );
    if (!ok) return;

    setBusy(true);
    try {
      await post('/copier/emergency-stop');
      await Promise.all([load(), reload()]);
    } finally {
      setBusy(false);
    }
  }

  async function closeAll() {
    const ok = window.confirm(
      'CLOSE ALL OPEN TRADES\n\n' +
        'This attempts to close every open position on every connected account, at market.\n\n' +
        'This cannot be undone. Continue?',
    );
    if (!ok) return;

    setBusy(true);
    try {
      const result = await post<{ queued: number }>('/copier/close-all', { confirm: 'CLOSE ALL' });
      window.alert(`${result.queued} position(s) queued to close.`);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading copier settings" />;

  const master = accounts.find((a) => a.role === 'MASTER');

  return (
    <>
      <PageHeader
        title="Copier"
        description={master ? `Copying from ${master.name}.` : 'No master account connected yet.'}
      />

      {/* PRD 25 / 27: the switches that stop everything */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <Toggle
                checked={globalEnabled}
                onChange={(next) => void toggleGlobal(next)}
                label="Master copying"
                disabled={busy}
              />
              <span className="text-lg font-semibold">
                Master copying{' '}
                <span className={globalEnabled ? 'text-emerald-700' : 'text-slate-500'}>
                  {globalEnabled ? 'ON' : 'OFF'}
                </span>
              </span>
            </div>
            <p className="mt-2 max-w-xl text-sm text-slate-600">
              {globalEnabled
                ? 'New master trades are copied to every follower that has copying switched on.'
                : 'No master trades are being copied. Existing open positions are unaffected.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => void emergencyStop()} disabled={busy}>
              Stop all copying
            </Button>
            <Button
              variant="secondary"
              onClick={() => void closeAll()}
              disabled={busy}
              className="border-red-300 text-red-700 hover:bg-red-50"
            >
              Close all open trades
            </Button>
          </div>
        </div>

        {emergencyStopAt ? (
          <div className="mt-4">
            <Alert tone="error" title="Emergency stop is active">
              Triggered {new Date(emergencyStopAt).toLocaleString()}. Every follower switch was turned
              off. Turn copying back on above, then re-enable the followers you want.
            </Alert>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Followers ({copiers.length})
          </h2>

          {copiers.length === 0 ? (
            <EmptyState
              title="No followers configured"
              description="Add a follower account and it will appear here with its own risk settings."
            />
          ) : (
            copiers.map((copier) => (
              <CopierCard
                key={copier.id}
                copier={copier}
                globalEnabled={globalEnabled}
                onSaved={load}
              />
            ))
          )}
        </div>

        <div>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Copy activity
          </h2>
          <CopyEventFeed events={events.slice(0, 40)} />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function CopierCard({
  copier,
  globalEnabled,
  onSaved,
}: {
  copier: CopierSettingsDto;
  globalEnabled: boolean;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState(copier);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(enabled: boolean) {
    setForm((prev) => ({ ...prev, enabled }));
    setBusy(true);
    try {
      await post(`/copier/${copier.id}/toggle`, { enabled });
      await onSaved();
    } catch {
      setForm((prev) => ({ ...prev, enabled: !enabled }));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await patch(`/copier/${copier.id}`, {
        riskMode: form.riskMode,
        lotMultiplier: Number(form.lotMultiplier),
        fixedLot: Number(form.fixedLot),
        minLot: form.minLot == null ? null : Number(form.minLot),
        maxLot: form.maxLot == null ? null : Number(form.maxLot),
        copyStopLoss: form.copyStopLoss,
        copyTakeProfit: form.copyTakeProfit,
        reverseTrades: form.reverseTrades,
        maxSlippagePoints: Number(form.maxSlippagePoints),
        symbolMappings: form.symbolMappings.map((m) => ({
          masterSymbol: m.masterSymbol,
          followerSymbol: m.followerSymbol,
        })),
      });
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save these settings.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-900">{copier.followerName}</div>
          <div className="text-sm text-slate-600">{describeRisk(form)}</div>
        </div>

        <div className="flex items-center gap-3">
          <span className={cx('text-sm font-medium', form.enabled ? 'text-emerald-700' : 'text-slate-500')}>
            {form.enabled ? 'COPY ON' : 'COPY OFF'}
          </span>
          <Toggle
            checked={form.enabled}
            onChange={(next) => void toggle(next)}
            label={`Copying for ${copier.followerName}`}
            disabled={busy}
          />
          <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
            {open ? 'Close' : 'Settings'}
          </Button>
        </div>
      </div>

      {form.enabled && !globalEnabled ? (
        <p className="mt-3 text-sm text-amber-700">
          This follower is switched on, but master copying is off — nothing will be copied.
        </p>
      ) : null}

      {open ? (
        <div className="mt-5 space-y-4 border-t border-slate-100 pt-5">
          {error ? <Alert tone="error">{error}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Risk mode">
              <select
                className={inputClass}
                value={form.riskMode}
                onChange={(e) => setForm({ ...form, riskMode: e.target.value as RiskMode })}
              >
                <option value="SAME_LOT">Same lot as master</option>
                <option value="LOT_MULTIPLIER">Lot multiplier</option>
                <option value="FIXED_LOT">Fixed lot</option>
              </select>
            </Field>

            {form.riskMode === 'LOT_MULTIPLIER' ? (
              <Field label="Multiplier" hint="Master lot × this value.">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className={inputClass}
                  value={form.lotMultiplier}
                  onChange={(e) => setForm({ ...form, lotMultiplier: Number(e.target.value) })}
                />
              </Field>
            ) : null}

            {form.riskMode === 'FIXED_LOT' ? (
              <Field label="Fixed lot" hint="Always trade this size, whatever the master does.">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className={inputClass}
                  value={form.fixedLot}
                  onChange={(e) => setForm({ ...form, fixedLot: Number(e.target.value) })}
                />
              </Field>
            ) : null}

            <Field label="Max slippage (points)">
              <input
                type="number"
                min="0"
                className={inputClass}
                value={form.maxSlippagePoints}
                onChange={(e) => setForm({ ...form, maxSlippagePoints: Number(e.target.value) })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Minimum lot (optional)" hint="Never trade smaller than this.">
              <input
                type="number"
                step="0.01"
                min="0"
                className={inputClass}
                value={form.minLot ?? ''}
                onChange={(e) =>
                  setForm({ ...form, minLot: e.target.value === '' ? null : Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Maximum lot (optional)" hint="A hard cap, applied after the risk rule.">
              <input
                type="number"
                step="0.01"
                min="0"
                className={inputClass}
                value={form.maxLot ?? ''}
                onChange={(e) =>
                  setForm({ ...form, maxLot: e.target.value === '' ? null : Number(e.target.value) })
                }
              />
            </Field>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">What to copy</legend>
            <CheckRow
              label="Copy stop loss"
              checked={form.copyStopLoss}
              onChange={(v) => setForm({ ...form, copyStopLoss: v })}
            />
            <CheckRow
              label="Copy take profit"
              checked={form.copyTakeProfit}
              onChange={(v) => setForm({ ...form, copyTakeProfit: v })}
            />
            <CheckRow
              label="Reverse trades (master BUY becomes SELL here)"
              checked={form.reverseTrades}
              onChange={(v) => setForm({ ...form, reverseTrades: v })}
            />
          </fieldset>

          <SymbolMappings
            mappings={form.symbolMappings}
            onChange={(symbolMappings) => setForm({ ...form, symbolMappings })}
          />

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : 'Save settings'}
            </Button>
            {saved ? <span className="text-sm text-emerald-700">Saved</span> : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
      />
      {label}
    </label>
  );
}

/** Symbol mapping table (PRD 15) — manual pairs are enough for V1. */
function SymbolMappings({
  mappings,
  onChange,
}: {
  mappings: CopierSettingsDto['symbolMappings'];
  onChange: (next: CopierSettingsDto['symbolMappings']) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700">Symbol mapping</legend>
      <p className="mb-2 text-xs text-slate-500">
        Only needed when this broker names an instrument differently, e.g. XAUUSD → GOLD.
      </p>

      <div className="space-y-2">
        {mappings.map((mapping, index) => (
          <div key={mapping.id || index} className="flex items-center gap-2">
            <input
              className={inputClass}
              placeholder="Master symbol"
              value={mapping.masterSymbol}
              onChange={(e) => {
                const next = [...mappings];
                next[index] = { ...mapping, masterSymbol: e.target.value.toUpperCase() };
                onChange(next);
              }}
            />
            <span className="shrink-0 text-slate-400">→</span>
            <input
              className={inputClass}
              placeholder="Symbol on this broker"
              value={mapping.followerSymbol}
              onChange={(e) => {
                const next = [...mappings];
                next[index] = { ...mapping, followerSymbol: e.target.value };
                onChange(next);
              }}
            />
            <Button
              variant="ghost"
              onClick={() => onChange(mappings.filter((_, i) => i !== index))}
              className="shrink-0 text-red-600"
              aria-label={`Remove mapping for ${mapping.masterSymbol}`}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      <Button
        variant="secondary"
        className="mt-2"
        onClick={() => onChange([...mappings, { id: '', masterSymbol: '', followerSymbol: '' }])}
      >
        Add mapping
      </Button>
    </fieldset>
  );
}

function describeRisk(copier: CopierSettingsDto): string {
  switch (copier.riskMode) {
    case 'FIXED_LOT':
      return `Fixed ${copier.fixedLot.toFixed(2)} lots per trade`;
    case 'LOT_MULTIPLIER':
      return `Master lot × ${copier.lotMultiplier}`;
    default:
      return 'Same lot size as master';
  }
}
