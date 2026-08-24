-- CreateTable
CREATE TABLE "ExternalDeferredBlob" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "blob" BYTEA NOT NULL,
    "targetScopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "ExternalDeferredBlob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalDeferredBlob_pluginId_idx" ON "ExternalDeferredBlob"("pluginId");
