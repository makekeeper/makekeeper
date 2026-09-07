-- Instance-level state of the shipped demo dataset (#339).
CREATE TABLE "DemoDataSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "seededAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoDataSettings_pkey" PRIMARY KEY ("id")
);
