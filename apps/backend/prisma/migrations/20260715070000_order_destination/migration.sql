-- #51: an order gets an optional destination — the ROOT storage the parcel is
-- headed to. Nullable FK with SET NULL on storage delete. Additive/safe.
ALTER TABLE "Order" ADD COLUMN "storageId" TEXT;
ALTER TABLE "Order" ADD CONSTRAINT "Order_storageId_fkey"
  FOREIGN KEY ("storageId") REFERENCES "Storage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
