'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { PairingDto, Platform } from '@tradeos/shared';
import { useLiveData } from '@/lib/live-data';
import { Alert, Button, Card, cx } from './ui';

/**
 * Guided setup for connecting a MetaTrader terminal.
 *
 * This is the one point where the user has to leave the browser and do
 * something in another application, so it is built as a wizard rather than a
 * page of instructions: one step visible at a time, the two values they must
 * copy each one click away, and — most importantly — it watches for the
 * terminal and tells them the moment it connects, so they never have to guess
 * whether it worked.
 */
export function ConnectWizard({
  pairing,
  platform,
  accountName,
  onDone,
}: {
  pairing: PairingDto;
  platform: Platform;
  accountName?: string;
  onDone?: () => void;
}) {
  const { accounts } = useLiveData();
  const [step, setStep] = useState(0);

  const account = accounts.find((a) => a.id === pairing.accountId);
  const connected = account?.status === 'CONNECTED';

  // Jump to the confirmation the moment the agent checks in, wherever the user
  // happens to be in the instructions.
  useEffect(() => {
    if (connected) setStep(3);
  }, [connected]);

  const folder = platform === 'MT5' ? 'MQL5' : 'MQL4';
  const fileName = platform === 'MT5' ? 'TradeOsAgent.mq5' : 'TradeOsAgent.mq4';

  const expiresIn = useExpiry(pairing.expiresAt);

  const steps = useMemo(
    () => [
      {
        title: 'Install the agent',
        body: (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              TradeOS talks to {platform} through a small program that runs inside your own
              terminal. Nothing here asks for your broker password.
            </p>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-900">Automatic (recommended)</p>
              <p className="mt-1 text-sm text-slate-600">
                Close MetaTrader, then run this from PowerShell in the folder where you unzipped
                TradeOS. It copies the agent in and allows TradeOS through MetaTrader&rsquo;s
                security settings — the step people most often get wrong.
              </p>
              <CopyField
                label="PowerShell"
                value={`powershell -ExecutionPolicy Bypass -File connector\\install-windows.ps1`}
                mono
              />
            </div>

            <details className="rounded-lg border border-slate-200 p-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-900">
                Or do it manually
              </summary>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600">
                <li>
                  In MetaTrader: <Code>File &rsaquo; Open Data Folder</Code>
                </li>
                <li>
                  Copy <Code>{fileName}</Code> into <Code>{folder}/Experts/</Code> and{' '}
                  <Code>JsonLite.mqh</Code> into <Code>{folder}/Include/TradeOS/</Code>
                </li>
                <li>
                  Open <Code>Tools &rsaquo; Options &rsaquo; Expert Advisors</Code>, tick{' '}
                  <Code>Allow WebRequest for listed URL</Code> and add:
                </li>
              </ol>
              <CopyField label="Allow this URL" value={new URL(pairing.apiUrl).origin} mono />
            </details>
          </div>
        ),
      },
      {
        title: 'Attach it to a chart',
        body: (
          <div className="space-y-4">
            <ol className="list-decimal space-y-2.5 pl-5 text-sm text-slate-600">
              <li>
                Open MetaTrader and make sure you are logged in to{' '}
                <strong className="font-medium text-slate-900">
                  the account you are connecting
                </strong>
                {account?.accountNumber ? (
                  <>
                    {' '}
                    (login <Code>{account.accountNumber}</Code>)
                  </>
                ) : null}
                . Attaching it to the wrong terminal is rejected, so nothing can go to an account
                you did not intend.
              </li>
              <li>
                Turn on <Code>Algo Trading</Code> in the toolbar.
              </li>
              <li>
                In the <Code>Navigator</Code> panel, open <Code>Expert Advisors</Code>. If
                TradeOsAgent is missing, right-click and choose <Code>Refresh</Code>.
              </li>
              <li>Drag TradeOsAgent onto any chart.</li>
            </ol>
          </div>
        ),
      },
      {
        title: 'Paste the pairing code',
        body: (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              In the window that opens, go to the <Code>Inputs</Code> tab, paste this into{' '}
              <Code>PairingCode</Code>, and press OK.
            </p>

            <CopyField label="Pairing code" value={pairing.pairingCode} mono large />

            <Alert tone={expiresIn.expired ? 'error' : 'warning'}>
              {expiresIn.expired ? (
                <>This code has expired. Close this and generate a new one — nothing else is lost.</>
              ) : (
                <>
                  Single use, expires in {expiresIn.label}. If it runs out, generate a new one from
                  the account page.
                </>
              )}
            </Alert>

            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-500" />
              <p className="text-sm text-slate-700">
                Waiting for your terminal to check in&hellip; this page updates on its own.
              </p>
            </div>
          </div>
        ),
      },
      {
        title: 'Connected',
        body: (
          <div className="space-y-4">
            <Alert tone="success" title={`${accountName ?? 'Your account'} is connected`}>
              TradeOS is receiving live data from this terminal. Balance, equity and open positions
              now update on their own.
            </Alert>
            <p className="text-sm text-slate-600">
              Leave MetaTrader running. While it is closed this account reports nothing and copies
              nothing — the dashboard will tell you if that happens.
            </p>
          </div>
        ),
      },
    ],
    [platform, folder, fileName, pairing, account, expiresIn, accountName],
  );

  return (
    <div className="max-w-2xl">
      {/* Progress */}
      <ol className="mb-6 flex items-center gap-2">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-1 items-center gap-2">
            <span
              className={cx(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                i < step || connected
                  ? 'bg-emerald-600 text-white'
                  : i === step
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-200 text-slate-500',
              )}
            >
              {i < step || (connected && i < 3) ? '✓' : i + 1}
            </span>
            {i < steps.length - 1 ? (
              <span
                className={cx(
                  'h-0.5 flex-1 rounded',
                  i < step || connected ? 'bg-emerald-600' : 'bg-slate-200',
                )}
              />
            ) : null}
          </li>
        ))}
      </ol>

      <Card>
        <h2 className="text-lg font-semibold text-slate-900">
          Step {Math.min(step + 1, steps.length)} of {steps.length} — {steps[step]!.title}
        </h2>
        <div className="mt-4">{steps[step]!.body}</div>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
          {step > 0 && step < 3 ? (
            <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          ) : null}

          {step < 2 ? (
            <Button onClick={() => setStep((s) => s + 1)}>Next</Button>
          ) : null}

          {step === 3 ? (
            <>
              <Link href={`/accounts/${pairing.accountId}`}>
                <Button>View account</Button>
              </Link>
              {onDone ? (
                <Button variant="secondary" onClick={onDone}>
                  Add another
                </Button>
              ) : null}
            </>
          ) : null}

          {step === 2 && !connected ? (
            <span className="text-sm text-slate-500">
              This step completes itself once the agent connects.
            </span>
          ) : null}
        </div>
      </Card>

      <p className="mt-4 text-xs text-slate-500">
        Stuck? The account stays here whatever happens — you can close this and pick it up from the
        account page at any time.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function useExpiry(iso: string) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const ms = new Date(iso).getTime() - now;
  const minutes = Math.max(0, Math.round(ms / 60_000));

  return {
    expired: ms <= 0,
    label: minutes >= 1 ? `${minutes} minute${minutes === 1 ? '' : 's'}` : 'under a minute',
  };
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-800">
      {children}
    </code>
  );
}

function CopyField({
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

  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          {label}
        </div>
        <div
          className={cx(
            'truncate text-slate-900',
            mono && 'font-mono',
            large ? 'text-lg font-semibold tracking-wider' : 'text-sm',
          )}
        >
          {value}
        </div>
      </div>
      <Button
        variant="secondary"
        className="shrink-0"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard can be blocked; the value is selectable regardless.
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
