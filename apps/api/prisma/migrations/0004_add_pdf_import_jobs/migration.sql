-- CreateEnum
CREATE TYPE "PdfImportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY_FOR_REVIEW', 'APPLIED', 'FAILED');

-- CreateTable
CREATE TABLE "PdfImportJob" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "topicId" UUID,
    "appliedTopicId" UUID,
    "status" "PdfImportStatus" NOT NULL DEFAULT 'QUEUED',
    "currentStage" TEXT NOT NULL DEFAULT 'QUEUED',
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "prePdfKey" TEXT,
    "postPdfKey" TEXT,
    "pageImageKeys" JSONB,
    "topicMetaJson" JSONB,
    "previewJson" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdfImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PdfImportJob_ownerId_createdAt_idx" ON "PdfImportJob"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "PdfImportJob_topicId_idx" ON "PdfImportJob"("topicId");

-- CreateIndex
CREATE INDEX "PdfImportJob_expiresAt_idx" ON "PdfImportJob"("expiresAt");

-- AddForeignKey
ALTER TABLE "PdfImportJob" ADD CONSTRAINT "PdfImportJob_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdfImportJob" ADD CONSTRAINT "PdfImportJob_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
