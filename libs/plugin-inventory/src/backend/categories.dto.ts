import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CATEGORY_NAME_MAX,
  CATEGORY_PROPERTY_TYPES,
  PROPERTY_ID_MAX,
  PROPERTY_NAME_MAX,
  PROPERTY_OPTION_MAX,
  PROPERTY_UNIT_MAX,
  PROPERTY_VALUE_MAX,
  MAX_PROPERTY_VALUES,
  type CategoryPropertyType,
} from '../categories';

// A category with many hundreds of options in one property is a list nobody can
// use — the cap is a usability guard, not a storage one.
const MAX_OPTIONS = 200;

// More siblings than a hand-curated vocabulary level can hold — a reorder
// payload above this is not a person dragging a node.
const MAX_REORDER_IDS = 500;

// `propertyValues` is a `{ propertyId: value }` map, so there is no per-key
// field to hang a @MaxLength on. This constraint bounds the map itself — entry
// count, key length, and each value — the way `IsShortStringRecord` does for
// chat's page context (§5.2: every string that reaches a column is bounded).
export function IsPropertyValueMap(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isPropertyValueMap',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (
            typeof value !== 'object' ||
            value === null ||
            Array.isArray(value)
          ) {
            return false;
          }
          const entries = Object.entries(value as Record<string, unknown>);
          if (entries.length > MAX_PROPERTY_VALUES) return false;
          return entries.every(
            ([key, val]) =>
              key.length <= PROPERTY_ID_MAX &&
              (val === null ||
                (typeof val === 'number' && Number.isFinite(val)) ||
                (typeof val === 'string' && val.length <= PROPERTY_VALUE_MAX)),
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a map of property ids to bounded strings, numbers or null`;
        },
      },
    });
  };
}

export class CreateCategoryDto {
  @ApiProperty({ maxLength: CATEGORY_NAME_MAX })
  @IsString()
  @MaxLength(CATEGORY_NAME_MAX)
  name!: string;

  @ApiPropertyOptional({ maxLength: 64, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentId?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  inheritProperties?: boolean;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ maxLength: CATEGORY_NAME_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(CATEGORY_NAME_MAX)
  name?: string;

  // Null detaches the category to the root.
  @ApiPropertyOptional({ maxLength: 64, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  inheritProperties?: boolean;
}

// A drop in the tree: the final sibling order under one parent. `movedId` names
// the node that changed parents (if any), so the service can run the full
// re-parent validation — cycle, name-collision rehearsal, spill — exactly once.
export class ReorderCategoriesDto {
  @ApiPropertyOptional({ maxLength: 64, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentId?: string | null;

  @ApiProperty({ type: [String], maxItems: MAX_REORDER_IDS })
  @IsArray()
  @ArrayMaxSize(MAX_REORDER_IDS)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  orderedIds!: string[];

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  movedId?: string;
}

// The final order of a category's OWN properties after a drag.
export class ReorderPropertiesDto {
  @ApiProperty({ type: [String], maxItems: MAX_REORDER_IDS })
  @IsArray()
  @ArrayMaxSize(MAX_REORDER_IDS)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  orderedIds!: string[];
}

export class CreatePropertyDto {
  @ApiProperty({ maxLength: PROPERTY_NAME_MAX })
  @IsString()
  @MaxLength(PROPERTY_NAME_MAX)
  name!: string;

  @ApiProperty({ enum: CATEGORY_PROPERTY_TYPES })
  @IsIn(CATEGORY_PROPERTY_TYPES)
  type!: CategoryPropertyType;

  // Display-only, and only for `number`. The service drops it for other types.
  @ApiPropertyOptional({ maxLength: PROPERTY_UNIT_MAX, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(PROPERTY_UNIT_MAX)
  unit?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_OPTIONS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_OPTIONS)
  @IsString({ each: true })
  @MaxLength(PROPERTY_OPTION_MAX, { each: true })
  options?: string[];
}

export class UpdatePropertyDto {
  @ApiPropertyOptional({ maxLength: PROPERTY_NAME_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(PROPERTY_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ enum: CATEGORY_PROPERTY_TYPES })
  @IsOptional()
  @IsIn(CATEGORY_PROPERTY_TYPES)
  type?: CategoryPropertyType;

  @ApiPropertyOptional({ maxLength: PROPERTY_UNIT_MAX, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(PROPERTY_UNIT_MAX)
  unit?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_OPTIONS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_OPTIONS)
  @IsString({ each: true })
  @MaxLength(PROPERTY_OPTION_MAX, { each: true })
  options?: string[];

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
