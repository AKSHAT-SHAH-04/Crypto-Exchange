-- CreateEnum
CREATE TYPE "TimeInForce" AS ENUM ('GTC', 'IOC', 'FOK');

-- CreateEnum
CREATE TYPE "EarnType" AS ENUM ('FLEXIBLE', 'LOCKED');

-- CreateEnum
CREATE TYPE "EarnStatus" AS ENUM ('ACTIVE', 'REDEEMED');

-- CreateEnum
CREATE TYPE "AutoInvestFrequency" AS ENUM ('HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "AutoInvestStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TxType" ADD VALUE 'EARN';
ALTER TYPE "TxType" ADD VALUE 'REFERRAL';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "postOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timeInForce" "TimeInForce" NOT NULL DEFAULT 'GTC';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredById" TEXT;

-- CreateTable
CREATE TABLE "ReferralReward" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "usdValue" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "tradeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarnProduct" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "type" "EarnType" NOT NULL,
    "durationDays" INTEGER NOT NULL DEFAULT 0,
    "apr" DECIMAL(10,6) NOT NULL,
    "minAmount" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "capacity" DECIMAL(36,18),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EarnProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarnPosition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "apr" DECIMAL(10,6) NOT NULL,
    "status" "EarnStatus" NOT NULL DEFAULT 'ACTIVE',
    "earned" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "lastAccrualAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maturesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),

    CONSTRAINT "EarnPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoInvestPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceAsset" TEXT NOT NULL,
    "targetAsset" TEXT NOT NULL,
    "amountPerRun" DECIMAL(36,18) NOT NULL,
    "frequency" "AutoInvestFrequency" NOT NULL,
    "status" "AutoInvestStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "totalInvested" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "totalBought" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "failedRuns" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoInvestPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoInvestRun" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "spent" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "bought" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "price" DECIMAL(36,18),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutoInvestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReferralReward_referrerId_createdAt_idx" ON "ReferralReward"("referrerId", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralReward_refereeId_idx" ON "ReferralReward"("refereeId");

-- CreateIndex
CREATE INDEX "EarnProduct_enabled_asset_idx" ON "EarnProduct"("enabled", "asset");

-- CreateIndex
CREATE INDEX "EarnPosition_status_lastAccrualAt_idx" ON "EarnPosition"("status", "lastAccrualAt");

-- CreateIndex
CREATE INDEX "EarnPosition_userId_status_idx" ON "EarnPosition"("userId", "status");

-- CreateIndex
CREATE INDEX "AutoInvestPlan_status_nextRunAt_idx" ON "AutoInvestPlan"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "AutoInvestPlan_userId_idx" ON "AutoInvestPlan"("userId");

-- CreateIndex
CREATE INDEX "AutoInvestRun_planId_createdAt_idx" ON "AutoInvestRun"("planId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- AddForeignKey
ALTER TABLE "EarnPosition" ADD CONSTRAINT "EarnPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarnPosition" ADD CONSTRAINT "EarnPosition_productId_fkey" FOREIGN KEY ("productId") REFERENCES "EarnProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoInvestPlan" ADD CONSTRAINT "AutoInvestPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoInvestRun" ADD CONSTRAINT "AutoInvestRun_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AutoInvestPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

