-- #50: price/currency are not intrinsic to a component (they vary by
-- supplier/order). Removed; "last paid" is derived from OrderComponent history.
ALTER TABLE "Component" DROP COLUMN "price";
ALTER TABLE "Component" DROP COLUMN "currency";
