import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Keep this union in sync with the frontend ProviderType and the per-provider
// field rules in ProviderService.validateProviderConfig.
export const PROVIDER_TYPES = [
  'gemini',
  'openai',
  'anthropic',
  'ollama',
  'custom',
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

// The vendor's own endpoint per provider — used when the user leaves the field
// blank, and as the reference the proxy-label gate compares against: a `baseUrl`
// that DIFFERS from this is the only signal MakeKeeper has that something of the
// operator's own sits in front of the vendor (#228). `custom` has no vendor, so
// any endpoint at all counts.
export function isProviderType(value: string): value is ProviderType {
  return (PROVIDER_TYPES as readonly string[]).includes(value);
}

// The vendor endpoint for a provider string that may not be a known type at all
// (ProviderConfig carries a plain `string`). Undefined means "no vendor of its
// own", which the proxy gate reads as "any address is the operator's".
export function vendorBaseUrl(provider: string): string | undefined {
  return isProviderType(provider) ? DEFAULT_BASE_URLS[provider] : undefined;
}

export const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  gemini: 'https://generativelanguage.googleapis.com',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  ollama: 'http://localhost:11434',
  custom: '',
};

// OpenAI vision fidelity: how much the API is allowed to downscale an image.
// "high" is needed to read small component markings; keep in sync with the
// frontend option list.
export const IMAGE_DETAILS = ['auto', 'high'] as const;
export type ImageDetail = (typeof IMAGE_DETAILS)[number];

// OpenAI reasoning budget for reasoning-capable models. "default" is the
// sentinel for "send nothing" (use the model's own default effort).
export const REASONING_EFFORTS = ['default', 'low', 'medium', 'high'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

// Owner-controlled credential sharing (see AIProviderConfig.sharedWith).
export const PROVIDER_SHARING = [
  'none',
  'workspace-guests',
  'everyone',
] as const;

export class CreateProviderDto {
  @ApiPropertyOptional({ maxLength: 20, enum: PROVIDER_SHARING })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @IsIn(PROVIDER_SHARING)
  sharedWith?: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: PROVIDER_TYPES })
  @IsIn(PROVIDER_TYPES)
  provider!: ProviderType;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  baseUrl?: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  modelName!: string;

  // OpenAI only — sent as the OpenAI-Organization header.
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  organizationId?: string;

  // Anthropic only — sent as the anthropic-version header.
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  apiVersion?: string;

  // OpenAI only — image_url.detail for vision requests.
  @ApiPropertyOptional({ enum: IMAGE_DETAILS })
  @IsOptional()
  @IsIn(IMAGE_DETAILS)
  imageDetail?: ImageDetail;

  // OpenAI only — reasoning_effort for reasoning-capable models.
  @ApiPropertyOptional({ enum: REASONING_EFFORTS })
  @IsOptional()
  @IsIn(REASONING_EFFORTS)
  reasoningEffort?: ReasoningEffort;

  // Proxy request labelling (#230): the operator's own text, the ordered segment
  // list, and an optional extra header name.
  @ApiPropertyOptional({
    maxLength: 64,
    description: 'i18n:providerSettings.proxyLabel.label',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  proxyLabel?: string;

  @ApiPropertyOptional({
    maxLength: 40,
    description: 'i18n:providerSettings.proxyLabel.segments',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  proxyLabelSegments?: string;

  @ApiPropertyOptional({
    maxLength: 64,
    description: 'i18n:providerSettings.proxyLabel.headerName',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  proxyHeaderName?: string;
}

// Payload for a minimal "test connection" check. All value fields are optional
// so the frontend can test whatever the user has entered so far. When `apiKey`
// is blank and `id` refers to an existing provider, the stored key is used.
export class TestProviderDto {
  @ApiProperty({ enum: PROVIDER_TYPES })
  @IsIn(PROVIDER_TYPES)
  provider!: ProviderType;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  baseUrl?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  organizationId?: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  apiVersion?: string;
}

// Update carries the same fields as create. The API key is special-cased in the
// service: an omitted/blank apiKey means "keep the stored secret" so the raw key
// never has to round-trip back to the client. Removing a stored key therefore
// needs its own signal — an explicit null (#220).
export class UpdateProviderDto {
  @ApiPropertyOptional({ maxLength: 20, enum: PROVIDER_SHARING })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @IsIn(PROVIDER_SHARING)
  sharedWith?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: PROVIDER_TYPES })
  @IsOptional()
  @IsIn(PROVIDER_TYPES)
  provider?: ProviderType;

  // Omitted/blank keeps the stored secret; an explicit null removes it.
  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string | null;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  baseUrl?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  modelName?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  organizationId?: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  apiVersion?: string;

  @ApiPropertyOptional({ enum: IMAGE_DETAILS })
  @IsOptional()
  @IsIn(IMAGE_DETAILS)
  imageDetail?: ImageDetail;

  @ApiPropertyOptional({ enum: REASONING_EFFORTS })
  @IsOptional()
  @IsIn(REASONING_EFFORTS)
  reasoningEffort?: ReasoningEffort;

  @ApiPropertyOptional({
    maxLength: 64,
    description: 'i18n:providerSettings.proxyLabel.label',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  proxyLabel?: string;

  @ApiPropertyOptional({
    maxLength: 40,
    description: 'i18n:providerSettings.proxyLabel.segments',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  proxyLabelSegments?: string;

  @ApiPropertyOptional({
    maxLength: 64,
    description: 'i18n:providerSettings.proxyLabel.headerName',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  proxyHeaderName?: string;
}

// Raw values the connection form wants normalised for its proxy-label preview
// (#230). Small and bounded: one value per label segment, never user content.
export class NormalizeProxyLabelDto {
  @ApiProperty({
    maxLength: 200,
    isArray: true,
    type: String,
    description: 'i18n:providerSettings.proxyLabel.preview',
  })
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  values!: string[];
}
