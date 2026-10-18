-- Print settings belong to the printer, not to the route that carried the job (#366).
--
-- Density and label stock describe how the head burns and what roll is loaded;
-- neither depends on whether the job came from a browser's Bluetooth or from the
-- server through Home Assistant. They move out of the Home Assistant row into one
-- the whole instance reads, carrying across whatever was already configured.
CREATE TABLE "NiimbotPrintSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "density" INTEGER NOT NULL DEFAULT 3,
    "labelType" TEXT NOT NULL DEFAULT 'withGaps',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NiimbotPrintSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "NiimbotPrintSettings" ("id", "density", "labelType", "updatedAt")
SELECT "id", "density", "labelType", CURRENT_TIMESTAMP FROM "NiimbotHaSettings";

ALTER TABLE "NiimbotHaSettings" DROP COLUMN "density";
ALTER TABLE "NiimbotHaSettings" DROP COLUMN "labelType";
