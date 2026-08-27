import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDigest } from '../src/digest.js';
import { EuropePmcSource } from '../src/sources/europepmc.js';
import { PubMedSource } from '../src/sources/pubmed.js';
import { defaultSources, searchAll } from '../src/sources/registry.js';

/**
 * These hit the real PubMed and Europe PMC endpoints. They are opt-in
 * (`npm run test:live`) so the normal suite stays offline and deterministic,
 * but they are the only way to catch an upstream response-shape change.
 */
const live = process.env['RESEARCHBUDDY_LIVE'] === '1';
const options = { skip: live ? false : 'set RESEARCHBUDDY_LIVE=1 to run network tests' };

test('PubMed returns parsed papers for a real query', options, async () => {
  const result = await new PubMedSource({ email: undefined }).search({
    term: '"Extracorporeal Membrane Oxygenation"[MeSH Terms] AND review[Publication Type]',
    limit: 5,
  });
  assert.ok(result.total > 100, `expected many matches, got ${result.total}`);
  assert.ok(result.papers.length > 0);
  const paper = result.papers[0]!;
  assert.ok(paper.title.length > 10);
  assert.ok(paper.pmid);
  assert.ok(paper.year);
});

test('Europe PMC returns parsed papers for a real query', options, async () => {
  const result = await new EuropePmcSource().search({
    term: 'extracorporeal membrane oxygenation',
    limit: 5,
  });
  assert.ok(result.papers.length > 0);
  assert.ok(result.papers.some((paper) => paper.abstract));
});

test('a full digest can be built end to end', options, async () => {
  const digest = await buildDigest({
    topicId: 'live-topic',
    rung: 'evidence',
    context: { term: 'ECMO', meshTerm: 'Extracorporeal Membrane Oxygenation' },
    sources: defaultSources(),
    maxPapers: 8,
  });
  assert.ok(digest.sections.length > 0, 'expected at least one themed section');
  assert.ok(digest.readingOrder.length > 0);
});

test('federated search reports per-source outcomes', options, async () => {
  const result = await searchAll(defaultSources(), { term: 'cardiogenic shock', limit: 3 });
  assert.equal(result.bySource.length, 2);
  for (const entry of result.bySource) assert.equal(entry.error, undefined);
});
