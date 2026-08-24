-- AlterTable
ALTER TABLE "LogisticsSettings" ADD COLUMN     "authMode" TEXT NOT NULL DEFAULT 'apikey',
ADD COLUMN     "trackingLogin" TEXT,
ADD COLUMN     "trackingPassword" TEXT;
