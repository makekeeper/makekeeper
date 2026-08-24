-- CreateTable
CREATE TABLE "PluginConfig" (
    "pluginId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginConfig_pkey" PRIMARY KEY ("pluginId")
);
