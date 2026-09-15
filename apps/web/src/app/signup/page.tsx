import { redirect } from 'next/navigation';

/** Clerk owns sign-up now; keep the old path working for existing links. */
export default function SignupRedirect() {
  redirect('/sign-up');
}
