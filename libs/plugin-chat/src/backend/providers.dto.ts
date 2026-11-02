import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DEFAULT_BASE_URLS,
  IMAGE_DETAILS,
  PROVIDER_TYPES,
  REASONING_EFFORTS,
  isProviderType,
  type ImageDetail,
  type ProviderType,
  type ReasoningEffort,
} from '../providers-shared';

// The type list, endpoints and option lists live in `providers-shared.ts`,
// which the connection form imports too (#374). Re-exported so the backend
// keeps one import site.
export {
  DEFAULT_BASE_URLS,
  IMAGE_DETAILS,
  PROVIDER_TYPES,
  REASONING_EFFORTS,
  isProviderType,
  type ImageDetail,
  type ProviderType,
  type ReasoningEffort,
};

// The vendor endpoint for a provider string that may not be a known type at all
// (ProviderConfig carries a plain `string`). Undefined means "no vendor of its
// own", which the proxy gate reads as "any address is the operator's".
export function vendorBaseUrl(provider: string): string | undefined {
  return isProviderType(provider) ? DEFAULT_BASE_URLS[provider] : undefined;
}

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

// Payload for the connection test and for the model list (#374). All value
// fields are optional so the form can probe whatever has been entered so far.
// When `apiKey` is blank and `id` refers to an existing connection, the stored
// key is used, so a saved connection never needs its secret typed again.
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

  // The model to try a real turn with (#374). Without it the test can only
  // say whether the credentials list models, which is not the same as "the
  // chat works".
  @ApiPropertyOptional({
    maxLength: 120,
    description: 'i18n:providerSettings.modelName',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  modelName?: string;
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
