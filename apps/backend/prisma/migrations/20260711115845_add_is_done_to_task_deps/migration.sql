-- AlterTable
ALTER TABLE "Component" ADD COLUMN     "currency" TEXT DEFAULT 'USD',
ADD COLUMN     "customFields" TEXT,
ADD COLUMN     "links" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "description" TEXT,
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'MEDIUM';

-- CreateTable
CREATE TABLE "TaskComponent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "isDone" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TaskComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskOrderDependency" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TaskOrderDependency_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TaskComponent" ADD CONSTRAINT "TaskComponent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComponent" ADD CONSTRAINT "TaskComponent_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOrderDependency" ADD CONSTRAINT "TaskOrderDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOrderDependency" ADD CONSTRAINT "TaskOrderDependency_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
