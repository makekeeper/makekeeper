import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TAG_COLOR_PATTERN } from '../tag-colors';
import { TAG_NAME_MAX } from '../tags-types';

// A raw id, a tag name, or a canonical tags ORef — the assign/tool surfaces
// accept any of these (resolved in the service). Bounded generously to cover an
// ORef spelling.
const TAG_INPUT_MAX = 256;
// Canonical ORef strings can grow with percent-encoding; keep a safe ceiling.
const REF_MAX = 512;

export class CreateTagDto {
  @ApiProperty({ maxLength: TAG_NAME_MAX })
  @IsString()
  @MaxLength(TAG_NAME_MAX)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TAG_COLOR_PATTERN)
  color?: string;
}

export class UpdateTagDto {
  @ApiPropertyOptional({ maxLength: TAG_NAME_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(TAG_NAME_MAX)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TAG_COLOR_PATTERN)
  color?: string;
}

export class AssignTagDto {
  // Tag id, name (created on the fly when unknown), or a mk://tags/tag/<id> ORef.
  @ApiProperty({ maxLength: TAG_INPUT_MAX })
  @IsString()
  @MaxLength(TAG_INPUT_MAX)
  tag!: string;

  // Canonical ORef of the object to tag.
  @ApiProperty({ maxLength: REF_MAX })
  @IsString()
  @MaxLength(REF_MAX)
  ref!: string;
}

export class UnassignTagDto {
  @ApiProperty({ maxLength: TAG_INPUT_MAX })
  @IsString()
  @MaxLength(TAG_INPUT_MAX)
  tagId!: string;

  @ApiProperty({ maxLength: REF_MAX })
  @IsString()
  @MaxLength(REF_MAX)
  ref!: string;
}

export class TagsForRefsDto {
  @ApiProperty({ type: String, isArray: true, maxLength: REF_MAX })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(REF_MAX, { each: true })
  refs!: string[];
}

// Marking a field as a tag source (#205). The field is named by ORef, so this
// endpoint takes no interest in which plugin owns it.
export class TagSourceStatusDto {
  @ApiProperty({ type: [String], maxItems: 200 })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(REF_MAX, { each: true })
  refs!: string[];
}

export class SetTagSourceDto {
  @ApiProperty({ maxLength: REF_MAX })
  @IsString()
  @MaxLength(REF_MAX)
  ref!: string;

  @ApiProperty()
  @IsBoolean()
  isSource!: boolean;
}
