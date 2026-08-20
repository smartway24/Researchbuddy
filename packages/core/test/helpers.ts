import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Paper } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));

export function fixture(name: string): string {
  // Compiled tests run from dist-test/test, so fixtures live one level up.
  return readFileSync(join(here, '..', '..', 'test', 'fixtures', name), 'utf8');
}

export function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: overrides.id ?? `pubmed:${overrides.externalId ?? '1'}`,
    sourceId: 'pubmed',
    externalId: '1',
    title: 'A study of something',
    authors: ['Doe J'],
    publicationTypes: [],
    meshTerms: [],
    keywords: [],
    ...overrides,
  };
}
