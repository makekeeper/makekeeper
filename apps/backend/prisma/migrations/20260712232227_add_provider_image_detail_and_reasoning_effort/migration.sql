-- OpenAI vision/reasoning knobs for component recognition (see #13).
-- imageDetail  -> image_url.detail ("auto" | "high"); NULL = auto.
-- reasoningEffort -> reasoning_effort ("low" | "medium" | "high"); NULL = omitted.
ALTER TABLE "AIProviderConfig" ADD COLUMN     "imageDetail" TEXT,
ADD COLUMN     "reasoningEffort" TEXT;
