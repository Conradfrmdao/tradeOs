-- DropIndex
DROP INDEX "trading_accounts_userId_platform_accountNumber_server_key";

-- CreateIndex
CREATE INDEX "trading_accounts_userId_platform_accountNumber_idx" ON "trading_accounts"("userId", "platform", "accountNumber");

-- A trading account may only be connected once *while it is live*.
--
-- This replaces the plain unique constraint, which also counted soft-deleted
-- rows and therefore made a removed account impossible to reconnect: the user
-- saw nothing occupying the slot, but the database refused the insert.
--
-- `server` is nullable and NULLs never compare equal in a unique index, so it
-- is coalesced to '' to make "same account, no server recorded" a real clash.
CREATE UNIQUE INDEX "trading_accounts_live_identity_key"
  ON "trading_accounts" ("userId", "platform", "accountNumber", (COALESCE("server", '')))
  WHERE "deletedAt" IS NULL;
