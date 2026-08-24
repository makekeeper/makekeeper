import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  ArrayMaxSize,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PageContext,
  type ChatCancelToolCommandData,
  type ChatConfirmToolCommandData,
  type ChatRetryCommandData,
  type ChatSendCommandData,
} from '@makekeeper/plugin-contract';

// Route params/query are flat maps of short strings. There is no per-key field to
// hang a @MaxLength on, so this constraint bounds the map itself: entry count plus
// each key and value length (§5.2 — every string is bounded).
const MAX_CONTEXT_ENTRIES = 30;
const MAX_CONTEXT_KEY_LENGTH = 100;
const MAX_CONTEXT_VALUE_LENGTH = 500;

function IsShortStringRecord(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isShortStringRecord',
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
          if (entries.length > MAX_CONTEXT_ENTRIES) return false;
          return entries.every(
            ([key, val]) =>
              key.length <= MAX_CONTEXT_KEY_LENGTH &&
              typeof val === 'string' &&
              val.length <= MAX_CONTEXT_VALUE_LENGTH,
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a flat map of short strings`;
        },
      },
    });
  };
}

// The current-page context sent alongside a chat message. Nested inside
// ChatSendCommandDto and validated (transform + whitelist) via
// validateRealtimeData, so unknown fields are stripped and every string is
// length-bounded.
export class PageContextDto implements PageContext {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  routeName?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  path?: string;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  pluginId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @IsShortStringRecord()
  params?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @IsShortStringRecord()
  query?: Record<string, string>;

  @ApiPropertyOptional({ maxLength: 600 })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  summary?: string;

  // Canonical ORef strings for the active selection (see PageContext.refs). Bounded
  // like every other context field: a handful of short URIs, never unbounded.
  @ApiPropertyOptional({ type: String, isArray: true, maxLength: 512 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(512, { each: true })
  refs?: string[];
}

// The chat turn transport is the socket (#61): the four turn-entry actions are
// client→server realtime commands, not HTTP endpoints. Each command's `data`
// payload is validated against the matching DTO below via `validateRealtimeData`
// (backend-core) inside its command handler — the same `@MaxLength`/shape checks
// the REST controllers get from the global ValidationPipe (§5.2). `sessionId`
// travels in the payload where the HTTP path carried it as a route param.
export class ChatSendCommandDto implements ChatSendCommandData {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  sessionId!: string;

  @ApiProperty({ maxLength: 10000 })
  @IsString()
  @MaxLength(10000)
  message!: string;

  // Optional attachments: base64 data URLs (typed/pasted pictures, uploaded at
  // their original size since #113 removed the client-side downscale) and/or
  // already-stored "/api/uploads/:id" URLs — a phone-capture photo (#6) or any
  // project file dragged onto the composer (#109), image or not.
  //
  // Which of them may actually be attached is decided by the attachment rules
  // (#112), re-checked in `sendMessage`; the cap below is only the transport
  // ceiling for one element.
  @ApiPropertyOptional({ type: String, isArray: true, maxLength: 16_000_000 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(16_000_000, { each: true })
  images?: string[];

  // Current-page context (route, active plugin, identifiers) captured when the
  // message was sent — an additional per-message layer, separate from the
  // session's projectId. Forwarded into the agent's system prompt (see issue #3).
  @ApiPropertyOptional({ type: () => PageContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PageContextDto)
  pageContext?: PageContextDto;

  // The project scope the client has in force (#130). A claim, not an
  // authority: the server reads it through the caller's scoped client before
  // the turn uses it for anything.
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectId?: string;
}

export class ChatConfirmToolCommandDto implements ChatConfirmToolCommandData {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  sessionId!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  messageId!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  toolName!: string;

  @ApiProperty()
  @IsObject()
  args!: Record<string, unknown>;
}

export class ChatCancelToolCommandDto implements ChatCancelToolCommandData {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  sessionId!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  messageId!: string;
}

export class ChatRetryCommandDto implements ChatRetryCommandData {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  sessionId!: string;
}

// Rename / pin a session from the project AI-history list (#59). An empty title
// clears the override so the list falls back to the derived first-message title.
export class UpdateSessionDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

// Paginated session list for the AI-history panel (#59).
export class PagedSessionsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

// What the chat is working on (#129). Every input is optional: a screen that
// publishes nothing, with no project in scope, is a legitimate question
// ("nothing in particular"), and the answer is the same shape.
//
// `refs` is comma-separated rather than a repeated query key: an ORef contains
// `/` and `#` but never a comma, so the split is unambiguous, and the server —
// not the client — stays the one that decides WHICH ref names the object and
// which project is in force.
export class FilingContextQueryDto {
  // The client's sticky project scope (#130) — the same value a turn would
  // carry, so the line describes the turn that is about to happen.
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectId?: string;

  @ApiPropertyOptional({
    maxLength: 2000,
    description: 'i18n:chat.api.filingContextRefs',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  refs?: string;
}

// Full-text message search within a project (#59). Numeric params are coerced by
// the global transforming ValidationPipe.
export class SearchMessagesQueryDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  q!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
