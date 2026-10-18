-- Aim a Home Assistant print job at the PRINTER, not at one of its sensors (#364).
--
-- hass-niimbot gives one B1 a dozen entities — cover, paper, RFID tag,
-- connectivity — and the first cut of this screen listed them as if each were a
-- printer. The target is now the integration's device by default, with an
-- entity still allowed because hass-niimbot accepts one.
ALTER TABLE "NiimbotHaSettings" RENAME COLUMN "entityId" TO "targetId";
ALTER TABLE "NiimbotHaSettings" ADD COLUMN "targetKind" TEXT NOT NULL DEFAULT 'device';
