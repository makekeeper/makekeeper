import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

// The selection an admin ticked in the disk browser (#120). Paths only — the
// server re-derives what each one IS from a fresh analysis, so a client cannot
// talk it into deleting a claimed or reserved file by mislabelling it.
export class DeleteDiskPathsDto {
  @ApiProperty({
    type: [String],
    maxItems: 500,
    description: 'i18n:core.diskUsage.pathsDescription',
  })
  @IsArray()
  // A directory selection expands server-side, so a sane cap here still covers
  // "delete everything from 2025" — it bounds the request, not the deletion.
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  paths!: string[];
}
