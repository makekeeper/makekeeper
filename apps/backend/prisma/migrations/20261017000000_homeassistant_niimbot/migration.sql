-- Home Assistant as a transport, and printing a Niimbot label through it (#364).
--
-- Two singleton rows, both instance-wide: the HA address and token belong to the
-- household, and the printer reached through them belongs to the instance
-- because the instance is what prints. The token is stored encrypted.
CREATE TABLE "HomeAssistantSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "baseUrl" TEXT,
    "token" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeAssistantSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NiimbotHaSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "entityId" TEXT,
    "printerName" TEXT,
    "soleTarget" BOOLEAN NOT NULL DEFAULT false,
    "density" INTEGER NOT NULL DEFAULT 3,
    "labelType" TEXT NOT NULL DEFAULT 'withGaps',
    "sendSize" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NiimbotHaSettings_pkey" PRIMARY KEY ("id")
);
