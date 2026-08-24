import {
  Controller,
  DefaultValuePipe,
  Get,
  Patch,
  ParseIntPipe,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Headers,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import type { ProjectComponent } from '@prisma/client';
import { PluginOwner } from '@makekeeper/backend-core';
import { InventoryService } from './inventory.service';
import { InventoryStockService } from './inventory-stock.service';
import {
  AdjustQtyDto,
  CaptureIntakeDto,
  CommitIntakeDraftDto,
  CreateComponentDto,
  DiscardIntakeDraftsDto,
  DiscardIntakeDraftPhotosDto,
  DiscardIntakePhotosDto,
  ProjectStockDto,
  RecognizeItemDto,
  StoreIntakePhotoDto,
  UpdateComponentDto,
  UpdateIntakeDraftDto,
} from './inventory.dto';
import { InventoryRecognitionService } from './inventory-recognition.service';
import { InventoryIntakeService } from './inventory-intake.service';
import { InventoryCategoriesService } from './categories.service';
import type { ComponentPropertyValueDto } from '../categories';
import type {
  IntakeCommitResult,
  IntakeDraft,
  RecognizedItemDraft,
} from '../mobile-intake';

@PluginOwner('inventory')
@Controller('components')
@ApiTags('inventory')
@ApiBearerAuth()
@ApiOAuth2([])
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly stockService: InventoryStockService,
    private readonly recognition: InventoryRecognitionService,
    private readonly intake: InventoryIntakeService,
    private readonly categories: InventoryCategoriesService,
  ) {}

  @Get()
  async findAll(@Query('q') q?: string) {
    return this.inventoryService.findAll(q);
  }

  // Declared before ':id' so the literal path is not swallowed by the param route.
  @Get('restock')
  async getRestockList() {
    return this.inventoryService.getRestockList();
  }

  // Soft duplicate check (#33 E4): components sharing a SKU with the given one.
  // Read-only, scoped to the caller — the form warns non-blockingly on add.
  @Get('by-sku')
  async findBySku(
    @Query('sku') sku: string,
    @Query('excludeId') excludeId?: string,
  ) {
    return this.inventoryService.findBySku(sku ?? '', excludeId);
  }

  // Mobile intake (#200). Declared before ':id' for the same reason 'restock'
  // is: a literal path must not be swallowed by the param route.
  @Get('intake/recognition')
  recognitionStatus(): { available: boolean } {
    return { available: this.recognition.isAvailable() };
  }

  // One fixed frame of the single-item scenario (#217), stored on its own and
  // parented to nothing yet. Uploading as each frame is fixed — rather than all
  // of them with the recognition call — is what makes a failed recognition cost
  // zero frames: the button can simply be pressed again.
  @Post('intake/photos')
  async storeIntakePhoto(
    @Body() body: StoreIntakePhotoDto,
    @Headers('x-locale') locale?: string,
  ): Promise<{ imageUrl: string }> {
    return {
      imageUrl: await this.recognition.storePhoto(body.imageDataUrl, locale),
    };
  }

  // Frames the person dropped, or abandoned by leaving the collecting mode.
  @Post('intake/photos/discard')
  async discardIntakePhotos(
    @Body() body: DiscardIntakePhotosDto,
  ): Promise<{ deleted: number }> {
    return this.recognition.discardFrames(body.imageUrls);
  }

  // Frames in, prefilled form out. Writes nothing — the phone posts the ordinary
  // create route afterwards, with whatever the human corrected.
  @Post('intake/recognize')
  async recognize(
    @Body() body: RecognizeItemDto,
    @Headers('x-locale') locale?: string,
  ): Promise<RecognizedItemDraft> {
    return this.recognition.recognizeStored(body.imageUrls, locale);
  }

  // The conveyor (#201). Returns as soon as the photo is stored — recognition
  // runs afterwards and lands on the draft.
  @Post('intake/drafts')
  async captureIntake(
    @Body() body: CaptureIntakeDto,
    @Headers('x-locale') locale?: string,
  ): Promise<IntakeDraft> {
    return this.intake.capture(body, locale);
  }

  @Get('intake/drafts')
  async listIntakeDrafts(): Promise<IntakeDraft[]> {
    return this.intake.list();
  }

  @Patch('intake/drafts/:id')
  async updateIntakeDraft(
    @Param('id') id: string,
    @Body() body: UpdateIntakeDraftDto,
  ): Promise<IntakeDraft> {
    return this.intake.update(id, body);
  }

  // Recognition is asked for per shot (#201): a conveyor run is dozens of
  // photographs and most of them do not need a model at all.
  @Post('intake/drafts/:id/recognize')
  async recognizeIntakeDraft(
    @Param('id') id: string,
    @Headers('x-locale') locale?: string,
  ): Promise<IntakeDraft> {
    return this.intake.recognize(id, locale);
  }

  @Post('intake/drafts/:id/commit')
  async commitIntakeDraft(
    @Param('id') id: string,
    @Body() body: CommitIntakeDraftDto,
  ): Promise<IntakeCommitResult> {
    return this.intake.commit(id, body.targetComponentId, body.attachPhotos);
  }

  // One frame off a draft that already exists: a blurred angle spotted on the
  // strip, or a shot of the wrong part. The draft itself SURVIVES with no
  // frames — somebody may have typed a name into it already, and losing that to
  // a dropped photograph would be the worse trade. Discarding the draft is a
  // separate, deliberate act.
  @Post('intake/drafts/:id/photos/discard')
  async discardIntakeDraftPhotos(
    @Param('id') id: string,
    @Body() body: DiscardIntakeDraftPhotosDto,
  ): Promise<IntakeDraft> {
    return this.intake.discardFramesOf(id, {
      imageUrls: body.imageUrls ?? [],
      clientOpIds: body.clientOpIds ?? [],
    });
  }

  // Manual cleanup only — abandoned drafts are never deleted on a timer (#120).
  @Post('intake/drafts/discard')
  async discardIntakeDrafts(
    @Body() body: DiscardIntakeDraftsDto,
  ): Promise<{ deleted: number }> {
    return this.intake.discard(body.ids);
  }

  // Declared before ':id' so the literal segment is not read as an id.
  @Get(':id/property-values')
  async propertyValues(
    @Param('id') id: string,
  ): Promise<ComponentPropertyValueDto[]> {
    return this.categories.valuesFor(id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.inventoryService.getOne(id);
  }

  // Project-stock operations (#58) — inventory owns reserving/consuming/
  // returning physical stock; disabling inventory 404s these (the guard).
  @Patch(':id/reserve')
  async reserveForProject(
    @Param('id') id: string,
    @Body() body: ProjectStockDto,
  ): Promise<ProjectComponent> {
    return this.stockService.reserveForProject(body.projectId, id, body.qty);
  }

  @Patch(':id/consume')
  async consumeForProject(
    @Param('id') id: string,
    @Body() body: ProjectStockDto,
  ): Promise<ProjectComponent> {
    return this.stockService.consumeForProject(body.projectId, id, body.qty);
  }

  @Patch(':id/return')
  async returnForProject(
    @Param('id') id: string,
    @Body() body: ProjectStockDto,
  ): Promise<ProjectComponent> {
    return this.stockService.returnForProject(body.projectId, id, body.qty);
  }

  @Patch(':id/adjust')
  async adjustQty(@Param('id') id: string, @Body() body: AdjustQtyDto) {
    return this.inventoryService.adjustQty(
      id,
      body.amount,
      body.type,
      body.note,
      body.clientOpId,
    );
  }

  @Post()
  async create(@Body() body: CreateComponentDto) {
    return this.inventoryService.create(body);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateComponentDto) {
    return this.inventoryService.update(id, body);
  }

  @Get(':id/movements')
  async findMovements(@Param('id') id: string) {
    return this.inventoryService.findMovements(id);
  }

  @Get(':id/orders')
  async findComponentOrders(@Param('id') id: string) {
    return this.inventoryService.findComponentOrders(id);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.inventoryService.delete(id);
  }
}
