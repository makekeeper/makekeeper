import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  TRACKING_PROVIDERS,
  TrackingProvider,
  AUTH_MODES,
  AuthMode,
} from './logistics-settings.service';

// The order lifecycle vocabulary. Single source of truth for status validation;
// keep in sync with the frontend status labels/colours and i18n `logistics.status.*`.
export const ORDER_STATUSES = [
  'CART',
  'ORDERED',
  'SHIPPED',
  'DELIVERED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Supported order currencies — mirrors the inventory component currency set.
export const ORDER_CURRENCIES = ['USD', 'EUR', 'RUB', 'CNY', 'GBP'] as const;
export type OrderCurrency = (typeof ORDER_CURRENCIES)[number];

// Return/RMA lifecycle.
export const RETURN_STATUSES = [
  'INITIATED',
  'SHIPPED_BACK',
  'REFUND_RECEIVED',
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export class OrderItemDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  componentId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0)
  unitPrice!: number;
}

export class CreateOrderDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  storeName!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  trackingNumber?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  trackingUrl?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  estimatedDelivery?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalCost?: number;

  @ApiPropertyOptional({ enum: ORDER_CURRENCIES })
  @IsOptional()
  @IsString()
  @IsIn(ORDER_CURRENCIES)
  currency?: OrderCurrency;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplierId?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectId?: string;

  // Destination root storage the parcel arrives at (#51). Root-only is
  // enforced in the service, not here.
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  storageId?: string;

  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptional()
  @IsString()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  @ApiProperty({ type: () => OrderItemDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}

// Full order edit — same shape as create; status is optional (kept as-is when omitted).
export class UpdateOrderDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  storeName!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  trackingNumber?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  trackingUrl?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  estimatedDelivery?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalCost?: number;

  @ApiPropertyOptional({ enum: ORDER_CURRENCIES })
  @IsOptional()
  @IsString()
  @IsIn(ORDER_CURRENCIES)
  currency?: OrderCurrency;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplierId?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectId?: string;

  // Destination root storage the parcel arrives at (#51). Root-only is
  // enforced in the service, not here.
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  storageId?: string;

  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptional()
  @IsString()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  @ApiProperty({ type: () => OrderItemDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: ORDER_STATUSES })
  @IsString()
  @IsIn(ORDER_STATUSES)
  status!: OrderStatus;
}

export class CreateSupplierDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  url?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  trackingUrlTemplate?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

// Same shape as create — a full replace of the supplier's editable fields.
export class UpdateSupplierDto extends CreateSupplierDto {}

export class UpdateLogisticsSettingsDto {
  @ApiPropertyOptional({ enum: TRACKING_PROVIDERS })
  @IsOptional()
  @IsString()
  @IsIn(TRACKING_PROVIDERS)
  trackingProvider?: TrackingProvider;

  @ApiPropertyOptional({ enum: AUTH_MODES })
  @IsOptional()
  @IsString()
  @IsIn(AUTH_MODES)
  authMode?: AuthMode;

  // Empty string clears the stored secret; omit the field to keep the current one.
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  trackingApiKey?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  trackingLogin?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  trackingPassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoTrackEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 168 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  pollIntervalHours?: number;
}

export class TestTrackingDto {
  @ApiProperty({ enum: TRACKING_PROVIDERS })
  @IsString()
  @IsIn(TRACKING_PROVIDERS)
  provider!: TrackingProvider;

  @ApiProperty({ enum: AUTH_MODES })
  @IsString()
  @IsIn(AUTH_MODES)
  authMode!: AuthMode;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  login?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}

export class ReceiveLineDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  orderComponentId!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  receivedQty!: number;
}

export class ReceiveOrderDto {
  @ApiProperty({ type: () => ReceiveLineDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines!: ReceiveLineDto[];
}

export class CreateReturnDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  orderId!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  componentId?: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  trackingNumber?: string;
}

export class UpdateReturnStatusDto {
  @ApiProperty({ enum: RETURN_STATUSES })
  @IsString()
  @IsIn(RETURN_STATUSES)
  status!: ReturnStatus;
}

export class ImportOrderImageDto {
  // A base64 "data:" URL (uploaded/pasted screenshot). Large by nature — the
  // cap guards against absurd payloads while allowing a full-res phone photo.
  @ApiPropertyOptional({ maxLength: 20_000_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000_000)
  imageDataUrl?: string;

  // An already-stored "/api/uploads/:id" URL (e.g. a phone-capture photo).
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;
}
