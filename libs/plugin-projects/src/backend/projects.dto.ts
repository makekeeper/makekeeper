import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CreateProjectDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  groupId?: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MaxLength(50)
  status!: string;

  // ISO date strings; null explicitly clears the value on update.
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  startDate?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  dueDate?: string | null;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetPlanned?: number;

  @ApiPropertyOptional({ maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  budgetCurrency?: string;
}

export class UpdateProjectDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  groupId?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  startDate?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  dueDate?: string | null;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetPlanned?: number;

  @ApiPropertyOptional({ maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  budgetCurrency?: string;
}

// Reorders (and optionally re-columns) a kanban status column: every id in
// `orderedIds` gets position = its index in the array. When `movedId` is
// present ONLY that project changes status — required by the 3-bucket simple
// board (#53), where a column groups several statuses and a drop must not
// rewrite the untouched cards' statuses. Without `movedId` every id is moved
// into `status` (the classic full-board behavior).
export class ReorderProjectsDto {
  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MaxLength(50)
  status!: string;

  @ApiProperty({ type: String, isArray: true, maxLength: 200 })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  orderedIds!: string[];

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  movedId?: string;
}

export class LinkComponentDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  componentId!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  neededQty!: number;
}

export class TaskComponentRefDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  id!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  quantity!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDone?: boolean;
}

export class TaskOrderRefDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  id!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDone?: boolean;
}

export class UpdateTaskDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  priority?: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  dueDate?: string | null;

  @ApiPropertyOptional({ type: () => TaskComponentRefDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskComponentRefDto)
  componentIds?: TaskComponentRefDto[];

  @ApiPropertyOptional({ type: () => TaskOrderRefDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskOrderRefDto)
  orderIds?: TaskOrderRefDto[];
}

export class AddTaskDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title!: string;
}

// A base64 data URL (data:<mime>;base64,...) for any attached file. Everything
// uploads as-is — images keep their original resolution so a later download
// returns the original bytes (#109).
export class AddFileDto {
  @ApiProperty({ maxLength: 60_000_000 })
  @IsString()
  @MaxLength(60_000_000)
  data!: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string;
}

// Pin an image as the project cover, or null to clear (fall back to first image).
export class SetCoverDto {
  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(200)
  attachmentId?: string | null;
}

export class CreateProjectGroupDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  name!: string;

  // null (or omitted) creates a root group.
  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100)
  parentId?: string | null;
}

export class UpdateProjectGroupDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100)
  parentId?: string | null;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class MoveProjectsToGroupDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  projectIds!: string[];

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  groupId!: string;
}

export class ReorderProjectGroupsDto {
  // null (or omitted) reorders the root level.
  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100)
  parentId?: string | null;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  orderedIds!: string[];

  // The dragged group, when the drag also changed its parent.
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  movedId?: string;
}
