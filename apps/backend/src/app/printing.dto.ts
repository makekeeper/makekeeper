import {
  IsBase64,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PrintRasterPayload } from '@makekeeper/plugin-contract';

// A page submitted to a SERVER-SIDE print driver (#362): the contract's own
// wire shape for a page (`PrintRasterPayload`) plus which printer to print it
// on. The validators say only what this endpoint will accept of it.
export class SubmitPrintJobDto implements PrintRasterPayload {
  @ApiProperty({ description: 'i18n:core.printing.params.driverId' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  driverId!: string;

  @ApiProperty({ description: 'i18n:core.printing.params.widthDots' })
  @IsInt()
  @Min(1)
  @Max(4096)
  widthDots!: number;

  @ApiProperty({ description: 'i18n:core.printing.params.heightDots' })
  @IsInt()
  @Min(1)
  @Max(4096)
  heightDots!: number;

  @ApiProperty({ description: 'i18n:core.printing.params.rows' })
  @IsBase64()
  @MaxLength(262144)
  rows!: string;

  @ApiPropertyOptional({ description: 'i18n:core.printing.params.copies' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  copies = 1;
}
