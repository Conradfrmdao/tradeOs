-- Identity moves to Clerk.
--
-- The local user row stays: every trading account, trade, copy event and audit
-- entry hangs off it, and a trader's history must outlive whichever auth
-- provider is in front of it.

-- Link to the Clerk user. Nullable because rows created before this migration
-- have no Clerk identity until their owner signs in through Clerk.
ALTER TABLE "users" ADD COLUMN "clerkUserId" TEXT;

-- Clerk-managed users have no password here at all.
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

CREATE UNIQUE INDEX "users_clerkUserId_key" ON "users"("clerkUserId");
