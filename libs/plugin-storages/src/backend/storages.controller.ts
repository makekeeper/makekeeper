import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import { PluginOwner } from '@makekeeper/backend-core';
import { StoragesService } from './storages.service';
import { CreateStorageDto, UpdateStorageDto } from './storages.dto';

@PluginOwner('storages')
@Controller('storages')
@ApiTags('storages')
@ApiBearerAuth()
@ApiOAuth2([])
export class StoragesController {
  constructor(private readonly storagesService: StoragesService) {}

  @Get()
  async findAll() {
    return this.storagesService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.storagesService.findOne(id);
  }

  @Post()
  async create(@Body() body: CreateStorageDto) {
    return this.storagesService.create(body);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateStorageDto) {
    return this.storagesService.update(id, body);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.storagesService.delete(id);
  }

  @Get(':id/components')
  async getComponents(@Param('id') id: string) {
    return this.storagesService.getComponents(id);
  }
}
