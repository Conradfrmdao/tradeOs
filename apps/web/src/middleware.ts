import { clerkMiddleware } from '@clerk/nextjs/server';

export default clerkMiddleware();

export const config = {
  matcher: [
    // Pages, excluding Next internals and static assets.
    //
    // `api/agent` is excluded deliberately. The MetaTrader agents authenticate
    // with their own bearer tokens, not a browser session, and every connected
    // terminal calls those routes every few seconds. Running them through
    // Clerk would make it try to verify a token that is not a Clerk token —
    // adding a round trip to the copy path, which is the one place in this
    // system where latency costs money.
    '/((?!_next|api/agent|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',

    // Dashboard API routes, again skipping the agent protocol.
    '/api/((?!agent/).*)',
    '/(trpc)(.*)',

    // Clerk's own auto-proxy path.
    '/__clerk/:path*',
  ],
};
