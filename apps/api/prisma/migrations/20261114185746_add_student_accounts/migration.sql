/*
  Warnings:

  - A unique constraint covering the columns `[accountId,cohortId]` on the table `Student` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "accountId" UUID;

-- CreateTable
CREATE TABLE "StudentAccount" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "consentAcceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StudentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentRefreshToken" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentAccount_email_key" ON "StudentAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "StudentRefreshToken_tokenHash_key" ON "StudentRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "StudentRefreshToken_accountId_idx" ON "StudentRefreshToken"("accountId");

-- CreateIndex
CREATE INDEX "StudentRefreshToken_familyId_idx" ON "StudentRefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "Student_accountId_idx" ON "Student"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_accountId_cohortId_key" ON "Student"("accountId", "cohortId");

-- AddForeignKey
ALTER TABLE "StudentRefreshToken" ADD CONSTRAINT "StudentRefreshToken_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "StudentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "StudentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
