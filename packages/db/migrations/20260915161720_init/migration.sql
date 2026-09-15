-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "VerificationTokenType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('MT4', 'MT5');

-- CreateEnum
CREATE TYPE "AccountRole" AS ENUM ('MASTER', 'FOLLOWER');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'CONNECTING', 'CONNECTED', 'DISCONNECTED', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('AGENT_EA', 'BROKER_API');

-- CreateEnum
CREATE TYPE "RiskMode" AS ENUM ('SAME_LOT', 'LOT_MULTIPLIER', 'FIXED_LOT');

-- CreateEnum
CREATE TYPE "TradeDirection" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CopyAction" AS ENUM ('OPEN', 'CLOSE', 'MODIFY', 'PARTIAL_CLOSE');

-- CreateEnum
CREATE TYPE "CopyTaskStatus" AS ENUM ('PENDING', 'DISPATCHED', 'SUCCESS', 'FAILED', 'SKIPPED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CopyEventType" AS ENUM ('MASTER_OPEN', 'MASTER_CLOSE', 'MASTER_MODIFY', 'COPY_QUEUED', 'COPY_DISPATCHED', 'COPY_EXECUTED', 'COPY_FAILED', 'COPY_SKIPPED', 'COPY_EXPIRED', 'ACCOUNT_CONNECTED', 'ACCOUNT_DISCONNECTED', 'COPIER_TOGGLED', 'EMERGENCY_STOP');

-- CreateEnum
CREATE TYPE "CopyEventStatus" AS ENUM ('INFO', 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'ADMIN', 'AGENT', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "copyingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emergencyStopAt" TIMESTAMP(3),
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnCopyOk" BOOLEAN NOT NULL DEFAULT false,
    "notifyOnCopyFail" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnConnect" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnDisconnect" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "VerificationTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "broker" TEXT,
    "accountNumber" TEXT NOT NULL,
    "server" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "leverage" INTEGER,
    "role" "AccountRole" NOT NULL,
    "connectorType" "ConnectorType" NOT NULL DEFAULT 'AGENT_EA',
    "status" "AccountStatus" NOT NULL DEFAULT 'PENDING',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "balance" DECIMAL(20,8),
    "equity" DECIMAL(20,8),
    "margin" DECIMAL(20,8),
    "freeMargin" DECIMAL(20,8),
    "marginLevel" DECIMAL(20,8),
    "credit" DECIMAL(20,8),
    "floatingPl" DECIMAL(20,8),
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "agentVersion" TEXT,
    "terminalBuild" TEXT,
    "encryptedCredentials" JSONB,
    "historyCursor" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "trading_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tokens" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "pairingCodeHash" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "pairedAt" TIMESTAMP(3),
    "tokenHash" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastIp" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copier_settings" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "masterAccountId" UUID NOT NULL,
    "followerAccountId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "riskMode" "RiskMode" NOT NULL DEFAULT 'SAME_LOT',
    "lotMultiplier" DECIMAL(10,4) NOT NULL DEFAULT 1.0,
    "fixedLot" DECIMAL(12,4) NOT NULL DEFAULT 0.10,
    "minLot" DECIMAL(12,4),
    "maxLot" DECIMAL(12,4),
    "copyStopLoss" BOOLEAN NOT NULL DEFAULT true,
    "copyTakeProfit" BOOLEAN NOT NULL DEFAULT true,
    "copyPendingOrders" BOOLEAN NOT NULL DEFAULT false,
    "reverseTrades" BOOLEAN NOT NULL DEFAULT false,
    "maxSlippagePoints" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copier_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "symbol_mappings" (
    "id" UUID NOT NULL,
    "copierSettingsId" UUID NOT NULL,
    "masterSymbol" TEXT NOT NULL,
    "followerSymbol" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "symbol_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "ticket" TEXT NOT NULL,
    "positionId" TEXT,
    "magic" TEXT,
    "symbol" TEXT NOT NULL,
    "direction" "TradeDirection" NOT NULL,
    "volume" DECIMAL(12,4) NOT NULL,
    "openPrice" DECIMAL(20,8) NOT NULL,
    "closePrice" DECIMAL(20,8),
    "currentPrice" DECIMAL(20,8),
    "stopLoss" DECIMAL(20,8),
    "takeProfit" DECIMAL(20,8),
    "profit" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "swap" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "commission" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "netProfit" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "openTime" TIMESTAMP(3) NOT NULL,
    "closeTime" TIMESTAMP(3),
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "comment" TEXT,
    "masterPositionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copy_tasks" (
    "id" UUID NOT NULL,
    "masterAccountId" UUID NOT NULL,
    "followerAccountId" UUID NOT NULL,
    "masterPositionId" UUID,
    "action" "CopyAction" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "CopyTaskStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "payload" JSONB NOT NULL,
    "followerTicket" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copy_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copy_events" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "masterAccountId" UUID,
    "followerAccountId" UUID,
    "copyTaskId" UUID,
    "masterPositionId" UUID,
    "followerPositionId" UUID,
    "eventType" "CopyEventType" NOT NULL,
    "status" "CopyEventStatus" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "errorCode" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "copy_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equity_snapshots" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "balance" DECIMAL(20,8) NOT NULL,
    "equity" DECIMAL(20,8) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equity_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "meta" JSONB,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "actorType" "ActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_userId_key" ON "user_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_tokenHash_key" ON "verification_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "verification_tokens_userId_type_idx" ON "verification_tokens"("userId", "type");

-- CreateIndex
CREATE INDEX "trading_accounts_userId_role_idx" ON "trading_accounts"("userId", "role");

-- CreateIndex
CREATE INDEX "trading_accounts_status_idx" ON "trading_accounts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "trading_accounts_userId_platform_accountNumber_server_key" ON "trading_accounts"("userId", "platform", "accountNumber", "server");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tokens_accountId_key" ON "agent_tokens"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tokens_pairingCodeHash_key" ON "agent_tokens"("pairingCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tokens_tokenHash_key" ON "agent_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "copier_settings_followerAccountId_key" ON "copier_settings"("followerAccountId");

-- CreateIndex
CREATE INDEX "copier_settings_masterAccountId_idx" ON "copier_settings"("masterAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "symbol_mappings_copierSettingsId_masterSymbol_key" ON "symbol_mappings"("copierSettingsId", "masterSymbol");

-- CreateIndex
CREATE INDEX "positions_accountId_status_idx" ON "positions"("accountId", "status");

-- CreateIndex
CREATE INDEX "positions_accountId_closeTime_idx" ON "positions"("accountId", "closeTime");

-- CreateIndex
CREATE INDEX "positions_masterPositionId_idx" ON "positions"("masterPositionId");

-- CreateIndex
CREATE INDEX "positions_symbol_idx" ON "positions"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "positions_accountId_ticket_key" ON "positions"("accountId", "ticket");

-- CreateIndex
CREATE INDEX "copy_tasks_followerAccountId_status_idx" ON "copy_tasks"("followerAccountId", "status");

-- CreateIndex
CREATE INDEX "copy_tasks_masterPositionId_idx" ON "copy_tasks"("masterPositionId");

-- CreateIndex
CREATE INDEX "copy_tasks_status_expiresAt_idx" ON "copy_tasks"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "copy_tasks_followerAccountId_dedupeKey_key" ON "copy_tasks"("followerAccountId", "dedupeKey");

-- CreateIndex
CREATE INDEX "copy_events_userId_createdAt_idx" ON "copy_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "copy_events_copyTaskId_idx" ON "copy_events"("copyTaskId");

-- CreateIndex
CREATE INDEX "copy_events_followerAccountId_createdAt_idx" ON "copy_events"("followerAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "equity_snapshots_accountId_at_idx" ON "equity_snapshots"("accountId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "equity_snapshots_accountId_at_key" ON "equity_snapshots"("accountId", "at");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_accounts" ADD CONSTRAINT "trading_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "trading_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copier_settings" ADD CONSTRAINT "copier_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copier_settings" ADD CONSTRAINT "copier_settings_masterAccountId_fkey" FOREIGN KEY ("masterAccountId") REFERENCES "trading_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copier_settings" ADD CONSTRAINT "copier_settings_followerAccountId_fkey" FOREIGN KEY ("followerAccountId") REFERENCES "trading_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "symbol_mappings" ADD CONSTRAINT "symbol_mappings_copierSettingsId_fkey" FOREIGN KEY ("copierSettingsId") REFERENCES "copier_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "trading_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_masterPositionId_fkey" FOREIGN KEY ("masterPositionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_tasks" ADD CONSTRAINT "copy_tasks_masterAccountId_fkey" FOREIGN KEY ("masterAccountId") REFERENCES "trading_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_tasks" ADD CONSTRAINT "copy_tasks_followerAccountId_fkey" FOREIGN KEY ("followerAccountId") REFERENCES "trading_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_tasks" ADD CONSTRAINT "copy_tasks_masterPositionId_fkey" FOREIGN KEY ("masterPositionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_events" ADD CONSTRAINT "copy_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_events" ADD CONSTRAINT "copy_events_masterAccountId_fkey" FOREIGN KEY ("masterAccountId") REFERENCES "trading_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_events" ADD CONSTRAINT "copy_events_followerAccountId_fkey" FOREIGN KEY ("followerAccountId") REFERENCES "trading_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_events" ADD CONSTRAINT "copy_events_copyTaskId_fkey" FOREIGN KEY ("copyTaskId") REFERENCES "copy_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_snapshots" ADD CONSTRAINT "equity_snapshots_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "trading_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
