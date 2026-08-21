import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dedupe, searchAll } from '../src/sources/registry.js';
import type { SearchQuery, SourceAdapter } from '../src/sources/types.js';
import { makePaper } from './helpers.js';

test('the same DOI from two sources becomes one paper', () => {
  const merged = dedupe([
    makePaper({ id: 'pubmed:1', doi: '10.1/x', abstract: 'a'.repeat(400), meshTerms: ['Sepsis'] }),
    makePaper({
      id: 'europepmc:MED1',
      sourceId: 'europepmc',
      doi: '10.1/X',
      openAccessUrl: 'https://oa',
    }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, 'pubmed:1', 'the richer record wins');
  assert.equal(merged[0]?.openAccessUrl, 'https://oa', 'but the free link is kept');
});

test('records without a DOI fall back to PMID then title matching', () => {
  assert.equal(
    dedupe([
      makePaper({ id: 'a', pmid: '99' }),
      makePaper({ id: 'b', sourceId: 'europepmc', pmid: '99' }),
    ]).length,
    1,
  );

  assert.equal(
    dedupe([
      makePaper({ id: 'a', title: 'ECMO in ARDS: a trial' }),
      makePaper({ id: 'b', title: 'ECMO in ARDS  a trial!' }),
    ]).length,
    1,
  );
});

test('distinct papers are left alone', () => {
  assert.equal(
    dedupe([makePaper({ id: 'a', doi: '10.1/x' }), makePaper({ id: 'b', doi: '10.1/y' })]).length,
    2,
  );
});

test('a failing source is reported, not fatal', async () => {
  const good: SourceAdapter = {
    id: 'pubmed',
    label: 'Good',
    isPublic: true,
    async search(_query: SearchQuery) {
      return {
        sourceId: 'pubmed' as const,
        papers: [makePaper({ id: 'a' })],
        total: 1,
        executedQuery: 'q',
      };
    },
  };
  const bad: SourceAdapter = {
    id: 'europepmc',
    label: 'Bad',
    isPublic: true,
    async search() {
      throw new Error('network down');
    },
  };

  const result = await searchAll([good, bad], { term: 'ecmo' });
  assert.equal(result.papers.length, 1);
  assert.equal(
    result.bySource.find((entry) => entry.sourceId === 'europepmc')?.error,
    'network down',
  );
  assert.equal(result.bySource.find((entry) => entry.sourceId === 'pubmed')?.count, 1);
});
