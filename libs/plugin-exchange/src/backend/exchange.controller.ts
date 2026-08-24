import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream, promises as fsp } from 'fs';
import {
  AdminOnly,
  PluginOwner,
  getErrorMessage,
} from '@makekeeper/backend-core';
import { EXCHANGE_SCOPE_ROOT } from '@makekeeper/plugin-contract';
import { ExchangeService } from './exchange.service';
import {
  ExecuteImportDto,
  ExportRequestDto,
  ExportScopeDto,
} from './exchange.dto';
import type {
  ExchangeCatalog,
  ExchangeImportPreview,
  ExchangeImportResult,
} from '../exchange-types';

// The uploaded archive as multer's disk storage hands it over. Structural on
// purpose — keeps the controller free of the Express.Multer global namespace.
interface UploadedArchiveFile {
  path: string;
  size: number;
}

// Headers-only response surface used to attach the download metadata.
interface DownloadResponseLike {
  setHeader(name: string, value: string): void;
}

const TOKEN_PATTERN = /^imp_[a-f0-9-]{10,64}$/;

function assertToken(token: string): void {
  if (!TOKEN_PATTERN.test(token)) {
    throw new BadRequestException('exchange.errors.importNotFound');
  }
}

@PluginOwner('exchange')
@Controller('exchange')
@ApiTags('exchange')
@ApiBearerAuth()
@ApiOAuth2([])
export class ExchangeController {
  constructor(private readonly exchange: ExchangeService) {}

  @Get('catalog')
  getCatalog(): ExchangeCatalog {
    return this.exchange.getCatalog();
  }

  @Post('export')
  async export(
    @Body() dto: ExportRequestDto,
    @Res({ passthrough: true }) res: DownloadResponseLike,
    @Headers('x-locale') locale?: string,
  ): Promise<StreamableFile> {
    const result = await this.exchange.exportArchive(
      dto.rootType,
      dto.rootId ?? null,
      dto.sections,
      dto.includeSecrets ?? false,
      locale ?? 'en',
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    return this.stream(result);
  }

  // Admin-only per-user backup: one scope's data, secrets forced off. Driven by
  // the multiuser users admin view before a force-delete (over HTTP only — no
  // cross-plugin code import). The service also re-asserts admin, so this is
  // safe even with the overlay off (single-user ⇒ allowed).
  @AdminOnly()
  @Post('admin/export-scope')
  async exportScope(
    @Body() dto: ExportScopeDto,
    @Res({ passthrough: true }) res: DownloadResponseLike,
    @Headers('x-locale') locale?: string,
  ): Promise<StreamableFile> {
    const result = await this.exchange.exportArchive(
      EXCHANGE_SCOPE_ROOT,
      dto.scopeId,
      undefined,
      false,
      locale ?? 'en',
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    return this.stream(result);
  }

  private stream(result: {
    path: string;
    cleanup: () => Promise<void>;
  }): StreamableFile {
    const stream = createReadStream(result.path);
    // The staged file is one-shot: drop it as soon as the download ends
    // (or breaks) — the archive is rebuilt on every export.
    stream.on('close', () => void result.cleanup());
    return new StreamableFile(stream);
  }

  @Post('import/inspect')
  @UseInterceptors(FileInterceptor('file'))
  async inspect(
    @UploadedFile() file: UploadedArchiveFile | undefined,
    @Headers('x-locale') locale?: string,
  ): Promise<ExchangeImportPreview> {
    if (!file)
      throw new BadRequestException('exchange.errors.archiveMalformed');
    try {
      return await this.exchange.inspectImport(file.path, locale ?? 'en');
    } finally {
      await fsp.rm(file.path, { force: true }).catch((err) => {
        // Best-effort: an orphaned upload is reclaimed by the tmp sweep.
        void getErrorMessage(err);
      });
    }
  }

  @Post('import/:token/execute')
  async execute(
    @Param('token') token: string,
    @Body() dto: ExecuteImportDto,
    @Headers('x-locale') locale?: string,
  ): Promise<ExchangeImportResult> {
    assertToken(token);
    return this.exchange.executeImport(
      token,
      dto.sections,
      dto.options ?? {},
      locale ?? 'en',
    );
  }

  @Delete('import/:token')
  async discard(@Param('token') token: string): Promise<{ ok: true }> {
    assertToken(token);
    await this.exchange.discardImport(token);
    return { ok: true };
  }
}
