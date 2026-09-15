import Link from 'next/link';
import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 text-xl font-bold text-slate-900">
        TradeOS
      </Link>
      <SignIn />
      <p className="mt-8 max-w-sm text-center text-xs text-slate-500">
        Your trading password is never requested or stored. TradeOS connects through an agent that
        runs inside your own MetaTrader terminal.
      </p>
    </main>
  );
}
