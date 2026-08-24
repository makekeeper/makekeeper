import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Query params for GET /api/stats/series. `metric` is bounded and validated
// against the registry in the service; `days` is optional (defaults there).
export class StatsSeriesQueryDto {
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MaxLength(128)
  metric!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  // Optional breakdown filter, e.g. dimensionKey=projectId & dimensionValue=<id>
  // to read one project's series. Both must be present to take effect.
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  dimensionKey?: string;

  @ApiPropertyOptional({ maxLength: 190 })
  @IsOptional()
  @IsString()
  @MaxLength(190)
  dimensionValue?: string;
}

// Query params for GET /api/stats/series-grouped (one series per dimension value).
export class StatsGroupedQueryDto {
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MaxLength(128)
  metric!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

// Query params for GET /api/stats/graph (a relational graph over one window).
export class StatsGraphQueryDto {
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MaxLength(128)
  key!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}
