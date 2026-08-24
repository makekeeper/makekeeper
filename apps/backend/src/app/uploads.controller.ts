import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  NotFoundException,
  Res,
  StreamableFile,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PREVIEW_VARIANT_PARAM,
  PREVIEW_VARIANTS,
  isPreviewVariant,
  type PrewarmAccepted,
  type PreviewVariant,
} from '@makekeeper/plugin-contract';
import {
  AttachmentStorageService,
  PluginI18nService,
} from '@makekeeper/backend-core';
import { PrewarmUploadsDto } from './uploads.dto';

// Cached for a year. An attachment is immutable: `claim` moves a row between
// owners, but nothing ever rewrites the bytes behind an id.
const IMMUTABLE_CACHE = 'private, max-age=31536000, immutable';

// A fallback is a different animal — it says "no derivative exists *yet*". If it
// were cached immutably, a client that asked for a preview before generation
// would pin the full-size original under the preview URL for a year and never
// look again, permanently defeating the point of previews (#113).
const PROVISIONAL_CACHE = 'private, max-age=300';

// Serves uploaded attachments by opaque id, independent of where/how they are
// stored. Exposed at /api/uploads/:id. App-level (not owned by any plugin) so
// serving survives regardless of which plugin created the attachment — chat
// messages and phone-capture photos alike.
@Controller('uploads')
@ApiTags('core')
export class UploadsController {
  constructor(
    private readonly attachments: AttachmentStorageService,
    private readonly i18n: PluginI18nService,
  ) {}

  // Access model (#123): authenticated like every other route — NOT `@Public`.
  // It was public under #109 because the two surfaces that fetch an attachment
  // are the browser's own and cannot send an Authorization header: `<img src>`
  // and the `DownloadURL` drag-out payload. That left the boundary between
  // users resting on the id being unguessable. Both now authenticate through
  // the session cookie the browser attaches by itself (see session-cookie.ts in
  // plugin-multiuser); `apiDownload` keeps using its bearer token.
  //
  // With the multiuser overlay off the guard passes everything through, exactly
  // as before — this hardening is about multi-user instances.
  //
  // Signed, expiring URLs were weighed here and deliberately NOT built (#123,
  // closing the follow-up #109 left open). Once the cookie authenticates the
  // route, their only remaining job is handing one attachment to someone
  // outside the instance, and this product is self-hosted for a household —
  // there is no outward-sharing feature for them to serve. Revisit only if one
  // is ever added; until then they would be a mechanism with no user.
  //
  // `?variant=` selects a preview rendition (#113); without it the original is
  // served, unchanged. A variant never widens access — it resolves through the
  // same scoped row lookup, so an id invisible to the caller stays invisible in
  // every rendition.
  //
  // `inline` (not `attachment`) keeps <img>/browser viewing intact while still
  // naming the file for "Save as", the `download` attribute, `apiDownload`,
  // and Chromium's DownloadURL drag-out (#109).
  @Get(':id')
  async serve(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
    @Query(PREVIEW_VARIANT_PARAM) variant?: string,
  ): Promise<StreamableFile> {
    const resolved = variant
      ? await this.attachments.resolveVariantFile(
          id,
          this.parseVariant(variant),
        )
      : await this.attachments.resolveFile(id);

    if (!resolved) {
      throw new NotFoundException(
        this.i18n.t('core.errors.attachmentNotFound'),
      );
    }

    // Immutable only when a real derivative came back — see PROVISIONAL_CACHE.
    // The original itself is immutable whether or not a variant was requested.
    const cacheable = 'derived' in resolved ? resolved.derived : true;
    res.setHeader(
      'Cache-Control',
      cacheable ? IMMUTABLE_CACHE : PROVISIONAL_CACHE,
    );

    return new StreamableFile(this.attachments.stream(resolved.path), {
      type: resolved.mimeType,
      disposition: inlineDisposition(resolved.filename, id),
    });
  }

  // Have renditions ready before they are asked for (#128).
  //
  // The Files tab calls this when it loads and does not wait for the answer:
  // by the time a tile is clicked the `lg` its lightbox wants already exists,
  // instead of the first click paying a 2048 px encode. Nothing is served here
  // — the bytes stay on disk until something asks for them by URL — which is
  // what makes prewarming cheaper than having the browser fetch every variant
  // just to discard it.
  //
  // 202, not 200, and the body is a count of ids TAKEN ON rather than rendered:
  // the rendering is queued and outlives this response (see `schedulePrewarm`).
  // Reporting what was rendered would mean holding the connection through a
  // serial run of resizes — seconds of it — for an answer no caller reads.
  //
  // A POST because it is a request to DO something, and because the id list is
  // a body; a GET with the ids in the query string would be a URL-length bet.
  // Placed on a literal segment, which cannot collide with `:id` — the two are
  // different verbs.
  @Post('prewarm')
  @HttpCode(HttpStatus.ACCEPTED)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'i18n:core.uploads.prewarmSummary' })
  prewarm(@Body() dto: PrewarmUploadsDto): PrewarmAccepted {
    return { accepted: this.attachments.schedulePrewarm(dto.ids, dto.variant) };
  }

  // An unknown variant is a programmer error and must be loud: a silent
  // fallback would keep serving originals for years while the network panel
  // says "previews are on".
  private parseVariant(value: string): PreviewVariant {
    if (!isPreviewVariant(value)) {
      throw new BadRequestException(
        this.i18n.t('core.errors.unknownPreviewVariant', {
          variant: value,
          allowed: PREVIEW_VARIANTS.join(', '),
        }),
      );
    }
    return value;
  }
}

// RFC 6266/5987 Content-Disposition: an ASCII-sanitised quoted fallback plus a
// UTF-8 `filename*` so non-Latin originals (Cyrillic and friends) survive.
//
// The sanitising rule is mirrored in `asciiFilename`
// (libs/frontend-core/src/lib/filename.ts), which names the same file in
// Chromium's drag-out payload — the two tiers cannot share code, so the
// character class is kept identical on purpose.
export function inlineDisposition(
  filename: string,
  fallbackId: string,
): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '').replace(/[\\";:]/g, '_');
  const safe = ascii.trim().length > 0 ? ascii : fallbackId;
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `inline; filename="${safe}"; filename*=UTF-8''${encoded}`;
}
