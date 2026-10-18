-- One-time print handoff tokens (#361).
--
-- A browser without Web Bluetooth parks the rendered page here and hands out a
-- short-lived link; a Chromium browser near the printer opens it and prints.
-- The row carries the raster and nothing about the object it names.
CREATE TABLE "PrintHandoff" (
    "token" TEXT NOT NULL,
    "scopeId" TEXT,
    "widthDots" INTEGER NOT NULL,
    "heightDots" INTEGER NOT NULL,
    "rows" BYTEA NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "printedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintHandoff_pkey" PRIMARY KEY ("token")
);

CREATE INDEX "PrintHandoff_scopeId_idx" ON "PrintHandoff"("scopeId");
CREATE INDEX "PrintHandoff_expiresAt_idx" ON "PrintHandoff"("expiresAt");
