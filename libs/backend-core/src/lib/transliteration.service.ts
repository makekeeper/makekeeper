import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTransliterator,
  type TransliterationTable,
  type Transliterator,
} from '@makekeeper/plugin-contract';

// Reads EVERY *.json in the transliteration-tables asset folder once at
// startup and builds the repo's one transliterator from them. Which scripts
// exist is decided by what lies in that folder — no file is named anywhere in
// code, so adding a writing system is dropping a JSON there and nothing else.
//
// Server-side deliberately: a browser bundle cannot list a directory, so
// runtime folder-reading and in-browser use are mutually exclusive. The
// frontend therefore asks the server to normalise (see the chat plugin's
// proxy-label preview endpoint) instead of carrying tables of its own.
@Injectable()
export class TransliterationService {
  private readonly logger = new Logger(TransliterationService.name);

  // Built eagerly in the constructor — i.e. at DI bootstrap. A broken or
  // missing folder must fail the server's start, not the first chat turn.
  readonly transliterate: Transliterator;

  constructor() {
    const dir = this.resolveTablesDir();
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
    const tables = files.map(
      (name) =>
        JSON.parse(
          readFileSync(join(dir, name), 'utf8'),
        ) as TransliterationTable,
    );
    this.transliterate = createTransliterator(tables);
    this.logger.log(`transliteration tables: ${files.length} (${dir})`);
  }

  // The tables live in THIS library, next to the service that owns them —
  // backend-core must not know the app tree's layout (the Apache/FSL split,
  // CLAUDE.md §11). In a bundle they ship as a webpack asset sitting next to
  // the compiled output; under Jest and ts-node this file runs from source,
  // where the folder is a sibling. The candidate paths are logged as data —
  // the throw carries only the key.
  private resolveTablesDir(): string {
    const candidates = [
      join(__dirname, 'assets', 'transliteration-tables'),
      join(__dirname, 'transliteration-tables'),
    ];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) {
      this.logger.error(candidates.join(', '));
      throw new Error('core.errors.transliterationTablesMissing');
    }
    return found;
  }
}
