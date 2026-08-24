import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_MAX_NON_IMAGE_BYTES,
  MAX_MAX_READ_BYTES,
  MIN_ATTACHMENT_LIMIT_BYTES,
} from '@makekeeper/plugin-contract';

// The attachment ruleset as it travels over the wire (#112). Both lists are
// free text the user edits, so every element is length-capped and the arrays
// are size-capped — a settings form must not become a way to store a novel.
export class AttachmentRulesDto {
  @ApiProperty({
    type: String,
    isArray: true,
    description: 'i18n:chat.attachmentSettings.api.mimeTypes',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  mimeTypes!: string[];

  @ApiProperty({
    type: String,
    isArray: true,
    description: 'i18n:chat.attachmentSettings.api.extensions',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(24, { each: true })
  extensions!: string[];

  // The bounds come from the contract, the same ones the service clamps to —
  // an edge that accepted what the service rewrites would report a saved value
  // the user never chose.
  @ApiProperty({
    description: 'i18n:chat.attachmentSettings.api.maxNonImageBytes',
  })
  @IsInt()
  @Min(MIN_ATTACHMENT_LIMIT_BYTES)
  @Max(MAX_MAX_NON_IMAGE_BYTES)
  maxNonImageBytes!: number;

  @ApiProperty({ description: 'i18n:chat.attachmentSettings.api.maxReadBytes' })
  @IsInt()
  @Min(MIN_ATTACHMENT_LIMIT_BYTES)
  @Max(MAX_MAX_READ_BYTES)
  maxReadBytes!: number;
}
