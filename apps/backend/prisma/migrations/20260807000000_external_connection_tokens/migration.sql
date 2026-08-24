-- Long-lived mkt_ connection tokens with access ceilings for the external
-- data surface (#249).
CREATE TABLE "ExternalConnectionToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ceiling" TEXT NOT NULL,
    "userId" TEXT,
    "grantScopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ExternalConnectionToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalConnectionToken_tokenHash_key" ON "ExternalConnectionToken"("tokenHash");
