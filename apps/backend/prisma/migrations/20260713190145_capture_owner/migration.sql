-- AlterTable
ALTER TABLE "CaptureSession" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "CaptureSettings" ALTER COLUMN "id" SET DEFAULT 'default';
