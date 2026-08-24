import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Headers,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import { PluginOwner, AdminOnly } from '@makekeeper/backend-core';
import { LogisticsService } from './logistics.service';
import { LogisticsSettingsService } from './logistics-settings.service';
import { LogisticsTrackingService } from './logistics-tracking.service';
import { LogisticsImportService } from './logistics-import.service';
import {
  CreateOrderDto,
  UpdateOrderDto,
  UpdateOrderStatusDto,
  CreateSupplierDto,
  UpdateSupplierDto,
  UpdateLogisticsSettingsDto,
  TestTrackingDto,
  ReceiveOrderDto,
  CreateReturnDto,
  UpdateReturnStatusDto,
  ImportOrderImageDto,
} from './logistics.dto';

@PluginOwner('logistics')
@Controller('logistics')
@ApiTags('logistics')
@ApiBearerAuth()
@ApiOAuth2([])
export class LogisticsController {
  constructor(
    private readonly logisticsService: LogisticsService,
    private readonly settingsService: LogisticsSettingsService,
    private readonly trackingService: LogisticsTrackingService,
    private readonly importService: LogisticsImportService,
  ) {}

  @Get('orders')
  async findAllOrders(@Query('projectId') projectId?: string) {
    return this.logisticsService.findAllOrders(projectId);
  }

  @Get('shopping-list')
  async getShoppingList() {
    return this.logisticsService.getShoppingList();
  }

  @Get('orders/:id')
  async getOrder(@Param('id') id: string) {
    return this.logisticsService.getOrder(id);
  }

  @Post('orders')
  async createOrder(@Body() body: CreateOrderDto) {
    return this.logisticsService.createOrder(body);
  }

  // Extracts a reviewable order draft from a screenshot — never persists an
  // order; the client reviews and creates it through the normal flow.
  @Post('orders/import-image')
  async importFromImage(
    @Body() body: ImportOrderImageDto,
    @Headers('x-locale') locale?: string,
  ) {
    return this.importService.importOrderFromImage(body, locale);
  }

  @Put('orders/:id')
  async updateOrder(@Param('id') id: string, @Body() body: UpdateOrderDto) {
    return this.logisticsService.updateOrder(id, body);
  }

  @Delete('orders/:id')
  async deleteOrder(@Param('id') id: string) {
    return this.logisticsService.deleteOrder(id);
  }

  @Patch('orders/:id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateOrderStatusDto,
  ) {
    return this.logisticsService.updateStatus(id, body.status);
  }

  @Patch('orders/:id/receive')
  async receiveOrder(@Param('id') id: string, @Body() body: ReceiveOrderDto) {
    return this.logisticsService.receiveOrder(id, body.lines);
  }

  @Get('orders/:id/returns')
  async getReturns(@Param('id') id: string) {
    return this.logisticsService.findReturns(id);
  }

  @Post('returns')
  async createReturn(@Body() body: CreateReturnDto) {
    return this.logisticsService.createReturn(body);
  }

  @Patch('returns/:id/status')
  async updateReturnStatus(
    @Param('id') id: string,
    @Body() body: UpdateReturnStatusDto,
  ) {
    return this.logisticsService.updateReturnStatus(id, body.status);
  }

  @Get('suppliers')
  async findAllSuppliers() {
    return this.logisticsService.findAllSuppliers();
  }

  @Post('suppliers')
  async createSupplier(@Body() body: CreateSupplierDto) {
    return this.logisticsService.createSupplier(body);
  }

  @Put('suppliers/:id')
  async updateSupplier(
    @Param('id') id: string,
    @Body() body: UpdateSupplierDto,
  ) {
    return this.logisticsService.updateSupplier(id, body);
  }

  @Delete('suppliers/:id')
  async deleteSupplier(@Param('id') id: string) {
    return this.logisticsService.deleteSupplier(id);
  }

  @Get('orders/:id/tracking')
  async getTracking(@Param('id') id: string) {
    return this.trackingService.getEvents(id);
  }

  @Post('orders/:id/tracking/refresh')
  async refreshTracking(@Param('id') id: string) {
    return this.trackingService.refreshOrder(id);
  }

  // Tracking-provider credentials are instance administration.
  @Get('settings')
  @AdminOnly()
  async getSettings() {
    return this.settingsService.get();
  }

  @Put('settings')
  @AdminOnly()
  async updateSettings(@Body() body: UpdateLogisticsSettingsDto) {
    return this.settingsService.update(body);
  }

  @Post('settings/test-tracking')
  @AdminOnly()
  async testTracking(@Body() body: TestTrackingDto) {
    return this.trackingService.testConnection(body);
  }
}
