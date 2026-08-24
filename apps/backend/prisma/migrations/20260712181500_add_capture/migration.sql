-- AlterTable: decouple Attachment from chat (nullable owners + capture link)
ALTER TABLE "Attachment" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "Attachment" ALTER COLUMN "sessionId" DROP NOT NULL;
ALTER TABLE "Attachment" ADD COLUMN "captureSessionId" TEXT;

-- CreateIndex
CREATE INDEX "Attachment_captureSessionId_idx" ON "Attachment"("captureSessionId");

-- CreateTable
CREATE TABLE "CaptureSession" (
    "token" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureSession_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "CaptureSession_expiresAt_idx" ON "CaptureSession"("expiresAt");

-- CreateTable
CREATE TABLE "CaptureSettings" (
    "id" TEXT NOT NULL,
    "tunnelMode" TEXT NOT NULL DEFAULT 'off',
    "cloudflaredPath" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptureSettings_pkey" PRIMARY KEY ("id")
);
