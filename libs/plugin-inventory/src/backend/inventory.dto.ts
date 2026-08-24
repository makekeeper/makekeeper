import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsPropertyValueMap } from './categories.dto';
import type { PropertyValueInput } from '../categories';
import { DESCRIPTION_MAX } from '../mobile-intake';
import { MAX_ITEM_PHOTOS } from '../photos';

// Movement types a user may record manually from the stock-change modal.
// RESERVED is managed by the projects plugin and is intentionally excluded here.
export const MANUAL_MOVEMENT_TYPES = [
  'ADJUSTMENT',
  'PURCHASE',
  'USED',
  'RETURN',
] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export class CreateComponentDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sku?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  // Only `name` is required (#53): a home user adds "screws" first and details
  // later. Quantity/minQuantity default to 0 (0 = low-stock tracking off);
  // placement is the structured storage link (storageId/row/col) only.
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string;

  // Typed values for the category's properties, keyed by property id (#205).
  // Values that are not properties of this item's category, or that do not fit
  // the declared type, are dropped by the service rather than coerced.
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsPropertyValueMap()
  propertyValues?: PropertyValueInput;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minQuantity?: number;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({ maxLength: 10000 })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  links?: string;

  @ApiPropertyOptional({ maxLength: 10000 })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  customFields?: string;

  // The item's photographs (#212), ordered; the first entry becomes the cover
  // and the list REPLACES whatever the item has. Entries are either stored
  // "/api/uploads/:id" URLs or fresh base64 data URLs.
  //
  // This is the ONLY way in. The single-photo `imageUrl`/`imageDataUrl` inputs
  // of #73 went with the column: `imageUrl` survives on the way OUT as the
  // derived cover, but a second write shape nobody sent was only a seam for the
  // two to drift along.
  //
  // The element cap is a data-URL's worth, so a set of five full-size camera
  // frames fits without the form silently losing its last picture.
  @ApiPropertyOptional({ type: [String], maxItems: MAX_ITEM_PHOTOS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEM_PHOTOS)
  @IsString({ each: true })
  @MaxLength(20_000_000, { each: true })
  photos?: string[];

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  storageId?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  storageRow?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  storageCol?: number;
}

export class UpdateComponentDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sku?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  // Null moves the item out of every category; the values its old category
  // defined spill into `customFields` rather than disappearing (#205).
  @ApiPropertyOptional({ maxLength: 64, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsPropertyValueMap()
  propertyValues?: PropertyValueInput;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minQuantity?: number;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({ maxLength: 10000 })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  links?: string;

  @ApiPropertyOptional({ maxLength: 10000 })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  customFields?: string;

  // The item's photographs (#212): see CreateComponentDto. An EMPTY list is a
  // real instruction and clears them; omitting the field leaves them alone.
  @ApiPropertyOptional({ type: [String], maxItems: MAX_ITEM_PHOTOS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEM_PHOTOS)
  @IsString({ each: true })
  @MaxLength(20_000_000, { each: true })
  photos?: string[];

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  storageId?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  storageRow?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  storageCol?: number;
}

// Project-stock operations (#58) — moved here from the projects plugin: the
// component id rides in the path, the project in the body.
export class ProjectStockDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  projectId!: string;

  // Reserve accepts a negative qty (= release part of the reservation);
  // consume/return validate positivity in the service.
  @ApiProperty()
  @IsNumber()
  qty!: number;
}

export class AdjustQtyDto {
  @ApiProperty()
  @IsNumber()
  amount!: number;

  @ApiPropertyOptional({ enum: MANUAL_MOVEMENT_TYPES })
  @IsOptional()
  @IsIn(MANUAL_MOVEMENT_TYPES)
  type?: ManualMovementType;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  // Idempotency key for a write that was queued while offline (#202). Present
  // only on a drained queue item; a replay of the same key is a no-op rather
  // than a second deduction.
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientOpId?: string;
}

// One photo to recognize (#200). Same large cap as the create form's photo —
// it is the same picture, arriving one step earlier.
// The single-item scenario (#217): the frames were already uploaded one by one
// as they were fixed, so recognition names them rather than carrying bytes. A
// failed recognition — no provider, timeout, rate limit, the most common failure
// — therefore costs zero frames and the button can just be pressed again.
export class RecognizeItemDto {
  @ApiProperty({ type: [String], maxItems: MAX_ITEM_PHOTOS })
  @IsArray()
  @ArrayMaxSize(MAX_ITEM_PHOTOS)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  imageUrls!: string[];
}

// One fixed frame of the single-item scenario, stored on its own (#217).
export class StoreIntakePhotoDto {
  @ApiProperty({ maxLength: 20_000_000 })
  @IsString()
  @MaxLength(20_000_000)
  imageDataUrl!: string;
}

// Frames the person dropped, or abandoned by leaving the collecting mode.
// Deleting them is the whole point: silently keeping them is how a store of
// abandoned frames grows (#120).
export class DiscardIntakePhotosDto {
  @ApiProperty({ type: [String], maxItems: MAX_ITEM_PHOTOS })
  @IsArray()
  @ArrayMaxSize(MAX_ITEM_PHOTOS)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  imageUrls!: string[];
}

// One frame the person dropped from a draft that already exists — a blurred
// angle noticed on the strip, or a shot of the wrong part.
//
// Addressed by IDENTITY, never by position. Both addresses name one attachment
// and name it for good, so a drop replayed by the offline queue deletes the
// same frame twice (a no-op) instead of eating whoever moved into that index:
//
//   * `imageUrls` — what a screen holding the draft's frames has (the batch
//     list). The attachment id is in the url.
//   * `clientOpIds` — what the CAMERA has: the shot that produced the frame was
//     queued under this key, and the stored attachment carries it. The phone
//     never learns the url of a frame it queued offline, which is exactly the
//     case this exists for.
export class DiscardIntakeDraftPhotosDto {
  @ApiPropertyOptional({ type: [String], maxItems: MAX_ITEM_PHOTOS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEM_PHOTOS)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  imageUrls?: string[];

  @ApiPropertyOptional({ type: [String], maxItems: MAX_ITEM_PHOTOS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEM_PHOTOS)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  clientOpIds?: string[];

  // Stamped by the offline queue on every write it carries (#202). Declared so
  // the whitelist keeps it; the drop needs no replay check of its own, because
  // deleting a named frame is already idempotent.
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientOpId?: string;
}

// One shot of the intake conveyor (#201): a photo plus what the person could
// tell from where they stand — how many, and which shelf.
export class CaptureIntakeDto {
  @ApiPropertyOptional({ maxLength: 20_000_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000_000)
  imageDataUrl?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  storageId?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  storageRow?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  storageCol?: number;

  // Idempotency key for THIS FRAME, queued while offline (#202).
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientOpId?: string;

  // The phone's own identity for the ITEM being shot (#216). Every frame of one
  // part carries the same key, and the server appends to the draft holding it —
  // which is what makes multi-frame capture survive being offline: the queue
  // cannot learn a server id, and a client-minted key needs no answer.
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientDraftId?: string;
}

// Corrections a human makes to a draft before committing it.
export class UpdateIntakeDraftDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sku?: string;

  // A category the human picked from the tree, or the one the model chose from
  // it (#206) — never a free-text name.
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string;

  @ApiPropertyOptional({ maxLength: DESCRIPTION_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  description?: string;

  // Guessed-then-edited values for the category's properties, keyed by property
  // id. Same validator the item create/update path uses, so a draft cannot
  // carry a shape the save would reject.
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsPropertyValueMap()
  propertyValues?: PropertyValueInput;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  storageId?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  storageRow?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  storageCol?: number;
}

// Committing a draft: either a new component, or a receipt into the one the
// human recognized as the same part.
export class CommitIntakeDraftDto {
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetComponentId?: string;

  // Whether the draft's frames should be attached when committing into an
  // EXISTING item (#216). Omitted applies the rule — attach only if that item
  // has no photograph yet — which is what the auto-matching path (no screen, no
  // person) gets. A screen that let somebody pick the target sends what they
  // chose, so it is never a silent decision.
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  attachPhotos?: boolean;
}

// Manual cleanup of abandoned drafts — there is no automatic retention (#120).
export class DiscardIntakeDraftsDto {
  @ApiProperty({ type: [String], maxItems: 200 })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  ids!: string[];
}
