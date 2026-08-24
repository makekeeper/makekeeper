import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  PREVIEW_VARIANTS,
  PREWARM_MAX_ATTACHMENTS,
  type PrewarmRequest,
  type PreviewVariant,
} from '@makekeeper/plugin-contract';

// Which renditions to have ready (#128). Ids only — the server decides what
// each one is and whether it is a picture at all, so a client cannot talk it
// into resizing a 200 MB STL by asking nicely.
//
// `implements PrewarmRequest` is the point of the shared type: the frontend
// helper builds that same shape, so a field renamed on either side stops the
// build instead of quietly validating to an empty request.
export class PrewarmUploadsDto implements PrewarmRequest {
  @ApiProperty({
    type: [String],
    maxItems: PREWARM_MAX_ATTACHMENTS,
    description: 'i18n:core.uploads.prewarmIdsDescription',
  })
  @IsArray()
  @ArrayMaxSize(PREWARM_MAX_ATTACHMENTS)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  ids!: string[];

  @ApiProperty({
    enum: PREVIEW_VARIANTS,
    description: 'i18n:core.uploads.prewarmVariantDescription',
  })
  @IsIn(PREVIEW_VARIANTS)
  variant!: PreviewVariant;
}
