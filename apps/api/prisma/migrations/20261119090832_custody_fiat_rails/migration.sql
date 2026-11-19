-- CreateEnum
CREATE TYPE "RampSide" AS ENUM ('BUY', 'SELL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TxStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "TxStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "isFiat" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerRef" TEXT,
ADD COLUMN     "rail" TEXT NOT NULL DEFAULT 'CRYPTO';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "country" TEXT;

-- CreateTable
CREATE TABLE "DepositAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "tag" TEXT,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepositAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiatDepositRef" (
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiatDepositRef_pkey" PRIMARY KEY ("userId","currency")
);

-- CreateTable
CREATE TABLE "RampOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "side" "RampSide" NOT NULL,
    "fiatCurrency" TEXT NOT NULL,
    "fiatAmount" DECIMAL(36,2),
    "asset" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "cryptoAmount" DECIMAL(36,18),
    "walletAddress" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "providerOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RampOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DepositAddress_userId_asset_network_key" ON "DepositAddress"("userId", "asset", "network");

-- CreateIndex
CREATE UNIQUE INDEX "DepositAddress_provider_network_address_tag_key" ON "DepositAddress"("provider", "network", "address", "tag");

-- CreateIndex
CREATE INDEX "BankAccount_userId_idx" ON "BankAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FiatDepositRef_reference_key" ON "FiatDepositRef"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "RampOrder_providerOrderId_key" ON "RampOrder"("providerOrderId");

-- CreateIndex
CREATE INDEX "RampOrder_userId_createdAt_idx" ON "RampOrder"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_providerRef_key" ON "Transaction"("providerRef");

-- AddForeignKey
ALTER TABLE "DepositAddress" ADD CONSTRAINT "DepositAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RampOrder" ADD CONSTRAINT "RampOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

