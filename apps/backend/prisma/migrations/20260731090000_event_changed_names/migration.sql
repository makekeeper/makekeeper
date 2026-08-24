-- #189 decision 7: the event envelope carries the names of changed fields,
-- never their values. Stored diffs are values — dropped, not migrated: the
-- outbox retention window is days and the column was metadata for deliveries,
-- not data.
ALTER TABLE "ExternalEventDelivery" DROP COLUMN "diffJson";
ALTER TABLE "ExternalEventDelivery" ADD COLUMN "changedJson" TEXT;
