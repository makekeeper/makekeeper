-- Instance-wide settings of the external-plugins host (#187): admin-tunable
-- per-surface time budgets (decision #8 of #131). Singleton row, additive.
CREATE TABLE "ExternalSettings" (
    "id" TEXT NOT NULL,
    "budgetsJson" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalSettings_pkey" PRIMARY KEY ("id")
);
