import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import { PluginOwner } from '@makekeeper/backend-core';
import { InventoryCategoriesService } from './categories.service';
import {
  CreateCategoryDto,
  CreatePropertyDto,
  ReorderCategoriesDto,
  ReorderPropertiesDto,
  UpdateCategoryDto,
  UpdatePropertyDto,
} from './categories.dto';
import type {
  CategoryPropertyDto,
  EffectiveProperty,
  ItemCategoryDto,
} from '../categories';

// The item-category vocabulary and the property sets it owns (#205).
//
// Deliberately NOT under the settings plugin: categories are warehouse data a
// scope owner curates, not instance administration — so no @AdminOnly here.
@PluginOwner('inventory')
@Controller('item-categories')
@ApiTags('inventory')
@ApiBearerAuth()
@ApiOAuth2([])
export class InventoryCategoriesController {
  constructor(private readonly categories: InventoryCategoriesService) {}

  @Get()
  async list(): Promise<ItemCategoryDto[]> {
    return this.categories.list();
  }

  // The flat set an item of this category actually carries, ancestors included.
  @Get(':id/effective-properties')
  async effective(@Param('id') id: string): Promise<EffectiveProperty[]> {
    return this.categories.effectiveProperties(id);
  }

  // Values already seen for this property, offered while typing the next one.
  // Only tag sources ask: picking an existing spelling is what keeps one shelf
  // label from becoming four tags.
  @Get('properties/:propertyId/values')
  async suggestions(
    @Param('propertyId') propertyId: string,
  ): Promise<string[]> {
    return this.categories.suggestValues(propertyId);
  }

  @Post()
  async create(@Body() dto: CreateCategoryDto): Promise<ItemCategoryDto> {
    return this.categories.createCategory(dto);
  }

  // Declared before the ':id' patch so 'reorder' cannot be read as an id.
  @Patch('reorder')
  async reorder(@Body() dto: ReorderCategoriesDto): Promise<{ ok: true }> {
    await this.categories.reorderCategories(dto);
    return { ok: true };
  }

  @Patch(':id/properties/reorder')
  async reorderProperties(
    @Param('id') id: string,
    @Body() dto: ReorderPropertiesDto,
  ): Promise<{ ok: true }> {
    await this.categories.reorderProperties(id, dto.orderedIds);
    return { ok: true };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<ItemCategoryDto> {
    return this.categories.updateCategory(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    await this.categories.deleteCategory(id);
    return { ok: true };
  }

  @Post(':id/properties')
  async addProperty(
    @Param('id') id: string,
    @Body() dto: CreatePropertyDto,
  ): Promise<CategoryPropertyDto> {
    return this.categories.addProperty(id, dto);
  }

  @Patch('properties/:propertyId')
  async updateProperty(
    @Param('propertyId') propertyId: string,
    @Body() dto: UpdatePropertyDto,
  ): Promise<CategoryPropertyDto> {
    return this.categories.updateProperty(propertyId, dto);
  }

  @Delete('properties/:propertyId')
  async removeProperty(
    @Param('propertyId') propertyId: string,
  ): Promise<{ ok: true }> {
    await this.categories.deleteProperty(propertyId);
    return { ok: true };
  }
}
