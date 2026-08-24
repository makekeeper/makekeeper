-- AlterTable
ALTER TABLE "Component" ADD COLUMN     "storageCol" INTEGER,
ADD COLUMN     "storageRow" INTEGER;

-- AlterTable
ALTER TABLE "Storage" ADD COLUMN     "gridCols" INTEGER,
ADD COLUMN     "gridRows" INTEGER;
