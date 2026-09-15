'use client';

import { useState } from 'react';
import type { PairingDto, Platform } from '@tradeos/shared';
import { Alert, Button, Card } from './ui';

/**
 * The pairing hand-off (PRD 6).
 *
 * This is the one screen where a user has to leave the browser and do
 * something inside MetaTrader, so the steps are numbered, the two values they
 * must copy are each one click away, and the expiry is stated rather than
 * discovered.
 */
export function PairingInstructions({
  pairing,
  platform,
}: {
  pairing: PairingDto;
  platform: Platform;
}) {
  const expiresAt = new Date(pairing.expiresAt);
  const minutes = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 60_000));

  const folder = platform === 'MT5' ? 'MQL5' : 'MQL4';
  const file = platform === 'MT5' ? 'TradeOsAgent.mq5' : 'TradeOsAgent.mq4';

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <ol className="space-y-5">
          <Step n={1} title="Allow TradeOS in MetaTrader">
            In the terminal, open <Code>Tools &rsaquo; Options &rsaquo; Expert Advisors</Code>, tick{' '}
            <Code>Allow WebRequest for listed URL</Code>, and add this address:
            <CopyBox label="API URL" value={pairing.apiUrl} />
          </Step>

          <Step n={2} title="Install the agent">
            Copy <Code>{file}</Code> into <Code>{folder}/Experts/</Code> and{' '}
            <Code>JsonLite.mqh</Code> into <Code>{folder}/Include/TradeOS/</Code>, then compile it in
            MetaEditor (F7).
          </Step>

          <Step n={3} title="Attach it and paste this code">
            Drag the <Code>TradeOsAgent</Code> expert onto any chart on this account, enable{' '}
            <Code>Algo Trading</Code>, and paste the pairing code into the EA&rsquo;s{' '}
            <Code>PairingCode</Code> input.
            <CopyBox label="Pairing code" value={pairing.pairingCode} mono large />
          </Step>
        </ol>
      </Card>

      <Alert tone="warning" title={`This code expires in ${minutes} minutes`}>
        It can be used once. If it expires, generate a new one from the account page — nothing else
        is lost.
      </Alert>

      <p className="text-sm text-slate-600">
        Once the agent connects, the account status changes to{' '}
        <span className="font-medium text-emerald-700">Connected</span> and balances start updating
        on their own.
      </p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-900">{title}</p>
        <div className="mt-1 text-sm text-slate-600">{children}</div>
      </div>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-800">
      {children}
    </code>
  );
}

function CopyBox({
  label,
  value,
  mono,
  large,
}: {
  label: string;
  value: string;
  mono?: boolean;
  large?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; the value is selectable either way.
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
        <div
          className={`truncate ${mono ? 'font-mono' : ''} ${large ? 'text-lg font-semibold tracking-wider' : 'text-sm'} text-slate-900`}
        >
          {value}
        </div>
      </div>
      <Button variant="secondary" onClick={() => void copy()} className="shrink-0">
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
