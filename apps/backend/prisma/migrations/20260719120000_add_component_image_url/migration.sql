-- Component photo (#73, epic #33 E2): an optional picture for a part, stored as
-- a "/api/uploads/:id" URL served by the shared attachment pipeline. Additive,
-- nullable — existing components stay imageless.

-- AlterTable
ALTER TABLE "Component" ADD COLUMN "imageUrl" TEXT;
