#!/usr/bin/env node
// Regenerates import.base64 from docker-compose.yml + template.toml.
//
// Dokploy's "Import" (Compose service → Advanced → Import) accepts a base64 of
// { compose, config } — the exact encoding its template site uses
// (app/src/components/TemplateDialog.tsx#getBase64Config in Dokploy/templates).
// Run after editing either file:  node deploy/dokploy/gen-import.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const compose = readFileSync(join(here, 'docker-compose.yml'), 'utf8');
const config = readFileSync(join(here, 'template.toml'), 'utf8');

const json = JSON.stringify({ compose, config }, null, 2);
const base64 = Buffer.from(json, 'utf8').toString('base64');

writeFileSync(join(here, 'import.base64'), base64 + '\n');
console.log(`Wrote import.base64 (${base64.length} chars).`);
