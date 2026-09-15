import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import type { Metadata } from 'next';
import { CandlesBackdrop } from '@/components/candles-backdrop';

export const metadata: Metadata = {
  title: 'TradeOS — Copy trades between your MT4 and MT5 accounts',
  description:
    'Connect one master MetaTrader account and up to ten followers. Monitor them from one dashboard and mirror every trade, without ever handing over a trading password.',
};

/**
 * Marketing page.
 *
 * Everything here is a claim the product can actually meet today. There are no
 * testimonials, customer counts or performance figures, because inventing them
 * on a product with no users would be a lie — and a lie on a page selling
 * financial software is worse than a plain page.
 */
export default async function LandingPage() {
  // Someone already signed in wants their dashboard, not the pitch.
  const { userId } = await auth();
  if (userId) redirect('/dashboard');

  return (
    <div className="bg-white">
      <SiteHeader />
      <Hero />
      <Credibility />
      <HowItWorks />
      <Security />
      <Features />
      <Honesty />
      <CallToAction />
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight text-slate-900">
          TradeOS
        </Link>
        <nav className="flex items-center gap-1 sm:gap-3">
          <a
            href="#how"
            className="hidden rounded-lg px-3 py-2 text-sm text-slate-600 hover:text-slate-900 sm:block"
          >
            How it works
          </a>
          <a
            href="#security"
            className="hidden rounded-lg px-3 py-2 text-sm text-slate-600 hover:text-slate-900 sm:block"
          >
            Security
          </a>
          <Link
            href="/sign-in"
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-slate-200">
      {/* Faint grid, purely structural — it reads as a trading surface without
          pretending to be data. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.3]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #eef2f7 1px, transparent 1px), linear-gradient(to bottom, #eef2f7 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
        }}
      />

      <CandlesBackdrop />

      <div className="relative mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight text-slate-900 sm:text-6xl">
            One account trades.
            <br />
            <span className="text-slate-400">The rest follow.</span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
            Connect a master MetaTrader account and up to ten followers. Every trade you take is
            mirrored to each one at the size you choose, and the whole portfolio sits on a single
            screen.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/sign-up"
              className="rounded-lg bg-slate-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Create an account
            </Link>
            <a
              href="#how"
              className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              See how it connects
            </a>
          </div>

          <p className="mt-5 text-sm text-slate-500">
            No trading password required — not at signup, not ever.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * Concrete, checkable capabilities rather than adjectives. Each of these is a
 * hard limit or behaviour of the product, not a marketing number.
 */
function Credibility() {
  const facts = [
    { label: 'Accounts per user', value: '1 + 10', note: 'one master, ten followers' },
    { label: 'Platforms', value: 'MT4 · MT5', note: 'mixed freely' },
    { label: 'Sizing modes', value: 'Three', note: 'same lot, multiplier, fixed' },
    { label: 'Passwords stored', value: 'None', note: 'by design' },
  ];

  return (
    <section className="border-b border-slate-200 bg-slate-50">
      <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-px overflow-hidden px-6 py-10 sm:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label} className="px-2 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {f.label}
            </dt>
            <dd className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">
              {f.value}
            </dd>
            <dd className="mt-0.5 text-xs text-slate-500">{f.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Connect your terminal',
      body: 'Add the account in TradeOS and drop the agent onto a chart in your own MetaTrader. A single-use pairing code links the two. The installer handles the settings people usually get wrong.',
    },
    {
      n: '02',
      title: 'Set the rule per follower',
      body: 'Match the master lot for lot, scale it by a multiplier, or trade a fixed size regardless. Copy stops and targets, reverse direction, and map instrument names where brokers disagree.',
    },
    {
      n: '03',
      title: 'Trade the master',
      body: 'Open a position as you always would. TradeOS detects it, applies each follower’s rule, and places the orders — then records exactly what happened on every account.',
    },
  ];

  return (
    <section id="how" className="border-b border-slate-200">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Three steps, then it runs itself
        </h2>

        <div className="mt-14 grid gap-10 sm:grid-cols-3 sm:gap-8">
          {steps.map((s) => (
            <div key={s.n} className="border-t border-slate-900 pt-5">
              <div className="font-mono text-xs text-slate-400">{s.n}</div>
              <h3 className="mt-3 text-lg font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-2.5 text-[15px] leading-relaxed text-slate-600">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Security() {
  return (
    <section id="security" className="border-b border-slate-200 bg-slate-900">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Your broker password never leaves your machine
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-slate-300">
              Most copiers ask for your MetaTrader login and hold it on their servers. TradeOS
              doesn&rsquo;t ask, because it doesn&rsquo;t need to.
            </p>
            <p className="mt-4 leading-relaxed text-slate-400">
              A small agent runs inside the terminal you are already signed in to. It reports what
              it sees and places the orders you configured. Nothing it sends could be used to log
              in to your account — so there is no stored credential to leak, and no password for
              anyone here to misuse.
            </p>
          </div>

          <div className="space-y-5">
            {[
              ['Sessions you can revoke', 'Signing out ends access immediately, everywhere.'],
              [
                'Every copy accounted for',
                'Each operation is logged with its outcome, and a failure states the broker’s reason rather than a generic error.',
              ],
              [
                'Duplicate trades are impossible',
                'A repeated or replayed signal cannot open a second position. The database enforces it, not a retry counter.',
              ],
              [
                'Stop everything at once',
                'One control halts all copying. Open positions are left exactly as they are unless you ask otherwise.',
              ],
            ].map(([title, body]) => (
              <div key={title} className="border-l-2 border-slate-700 pl-5">
                <h3 className="font-medium text-white">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Features() {
  const groups = [
    {
      heading: 'Monitoring',
      items: [
        'Balance, equity, margin and floating P/L per account',
        'Every open position across the portfolio on one screen',
        'Connection status with the time of the last check-in',
        'Alerts when a terminal stops reporting',
      ],
    },
    {
      heading: 'Copying',
      items: [
        'Same lot, multiplier, or fixed size per follower',
        'Copy stop loss and take profit',
        'Reverse direction',
        'Instrument name mapping between brokers',
        'Per-follower and global on/off switches',
      ],
    },
    {
      heading: 'Records',
      items: [
        'Full trade history with search, filters and date ranges',
        'Win rate, profit factor, drawdown and averages',
        'Equity curve per account and across the portfolio',
        'Side-by-side account comparison',
      ],
    },
  ];

  return (
    <section className="border-b border-slate-200">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          What you get
        </h2>

        <div className="mt-14 grid gap-12 sm:grid-cols-3 sm:gap-10">
          {groups.map((g) => (
            <div key={g.heading}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {g.heading}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {g.items.map((item) => (
                  <li key={item} className="flex gap-3 text-[15px] leading-relaxed text-slate-700">
                    <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Stating the constraints plainly. A trader who discovers these after signing
 * up feels misled; one who reads them here trusts the rest of the page.
 */
function Honesty() {
  return (
    <section className="border-b border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          What TradeOS asks of you
        </h2>

        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-slate-700">
          <p>
            <strong className="font-semibold text-slate-900">
              Your MetaTrader terminal has to be running.
            </strong>{' '}
            The agent lives inside it, which is what keeps your password off our servers. While a
            terminal is closed, that account copies nothing — so the dashboard shows you the moment
            one goes quiet, and emails you about it.
          </p>
          <p>
            <strong className="font-semibold text-slate-900">
              A copy is a new order at the current price.
            </strong>{' '}
            It is not the master&rsquo;s fill. Spread, execution speed and your broker&rsquo;s
            conditions all apply, so follower results will differ from the master&rsquo;s. Anyone
            promising identical fills is describing something other than copy trading.
          </p>
          <p>
            <strong className="font-semibold text-slate-900">
              Test on demo accounts first.
            </strong>{' '}
            Run your strategy through TradeOS on demo before connecting anything funded. Brokers
            differ in ways no amount of testing on our side can anticipate.
          </p>
        </div>
      </div>
    </section>
  );
}

function CallToAction() {
  return (
    <section className="border-b border-slate-200">
      <div className="mx-auto max-w-6xl px-6 py-20 text-center sm:py-24">
        <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Connect your first account
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600">
          Set up a master and a follower on demo accounts and watch a trade copy across. It takes a
          few minutes.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link
            href="/sign-up"
            className="rounded-lg bg-slate-900 px-7 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            Create an account
          </Link>
          <Link
            href="/sign-in"
            className="rounded-lg border border-slate-300 px-7 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-semibold tracking-tight text-slate-900">TradeOS</div>
          <p className="mt-1 text-sm text-slate-500">
            Copy trading for MetaTrader 4 and MetaTrader 5.
          </p>
        </div>
        <p className="max-w-md text-xs leading-relaxed text-slate-500">
          Trading foreign exchange and CFDs carries substantial risk and is not suitable for every
          investor. You can lose more than your initial deposit. TradeOS is a tool for managing
          accounts you already hold; it provides no trading advice and makes no claim about results.
        </p>
      </div>
    </footer>
  );
}
