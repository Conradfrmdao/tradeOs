import { redirect } from 'next/navigation';

/** Clerk owns sign-in now; keep the old path working for existing links. */
export default function LoginRedirect() {
  redirect('/sign-in');
}
