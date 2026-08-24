-- CreateTable
CREATE TABLE "Label" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "scopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Label_code_key" ON "Label"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Label_ref_key" ON "Label"("ref");

-- CreateIndex
CREATE INDEX "Label_scopeId_idx" ON "Label"("scopeId");
