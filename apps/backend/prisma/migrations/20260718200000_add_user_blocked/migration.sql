-- Admin user management (#66): let an admin block an account. `blockedAt` is
-- null for active accounts and set to the moment of blocking; login is refused
-- and any live session is rejected while it is non-null. Additive, nullable —
-- existing rows stay active.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "blockedAt" TIMESTAMP(3);
