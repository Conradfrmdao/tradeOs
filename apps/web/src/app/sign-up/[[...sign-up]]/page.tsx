import Link from 'next/link';
import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 text-xl font-bold text-slate-900">
        TradeOS
      </Link>
      <SignUp />
      <p className="mt-8 max-w-sm text-center text-xs text-slate-500">
        Connect one master account and up to ten followers. Your trading password is never
        requested or stored.
      </p>
    </main>
  );
}
