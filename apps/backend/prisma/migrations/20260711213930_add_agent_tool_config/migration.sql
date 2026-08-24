-- CreateTable
CREATE TABLE "AgentToolConfig" (
    "toolName" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "confirmationPolicy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentToolConfig_pkey" PRIMARY KEY ("toolName")
);
