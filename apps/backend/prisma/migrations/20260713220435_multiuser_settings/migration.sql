-- CreateTable
CREATE TABLE "MultiuserSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "allowRegistration" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultiuserSettings_pkey" PRIMARY KEY ("id")
);
