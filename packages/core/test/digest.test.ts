import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleDigest, estimatedMinutes } from '../src/digest.js';
import { parsePubmedXml } from '../src/sources/pubmed.js';
import { fixture, makePaper } from './helpers.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const papers = parsePubmedXml(fixture('pubmed-ecmo.xml'));

const base = {
  topicId: 'topic-1',
  rung: 'evidence' as const,
  context: { topic: 'ECMO', meshTerm: 'Extracorporeal Membrane Oxygenation' },
  sources: [],
  now: NOW,
};

test('builds sections with a reading order covering every included paper', () => {
  const digest = assembleDigest(papers, base);
  assert.equal(digest.candidateCount, papers.length);
  assert.ok(digest.sections.length > 0);
  const inSections = digest.sections.flatMap((section) => section.papers.map((s) => s.paper.id));
  assert.deepEqual(digest.readingOrder, inSections);
  assert.equal(new Set(digest.readingOrder).size, digest.readingOrder.length, 'no duplicates');
});

test('every section explains itself', () => {
  const digest = assembleDigest(papers, base);
  for (const section of digest.sections) {
    assert.ok(section.title.length > 0);
    assert.ok(section.rationale.length > 10, `"${section.title}" needs a rationale`);
    assert.ok(section.papers.length > 0);
  }
});

test('papers already read are excluded', () => {
  const seen = new Set([papers[0]!.id]);
  const digest = assembleDigest(papers, { ...base, seenPaperIds: seen });
  assert.equal(digest.readingOrder.includes(papers[0]!.id), false);
  assert.equal(
    digest.candidateCount,
    papers.length,
    'candidate count still reports what was considered',
  );
});

test('the digest is capped so a session stays finishable', () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    makePaper({
      id: `pubmed:${i}`,
      externalId: String(i),
      year: 2025,
      publicationTypes: ['Randomized Controlled Trial'],
      meshTerms: [`Theme ${i % 3}`],
    }),
  );
  const digest = assembleDigest(many, { ...base, maxPapers: 8 });
  assert.equal(digest.readingOrder.length, 8);
  assert.equal(digest.candidateCount, 40);
});

test('the first paper in the reading order is the highest scoring one', () => {
  const digest = assembleDigest(papers, base);
  const scores = digest.sections.flatMap((section) => section.papers.map((s) => s.score));
  assert.equal(scores[0], Math.max(...scores));
});

test('an empty result set produces an empty digest, not an error', () => {
  const digest = assembleDigest([], base);
  assert.deepEqual(digest.sections, []);
  assert.deepEqual(digest.readingOrder, []);
  assert.equal(estimatedMinutes(digest), 0);
});

test('estimated reading time grows with full-text availability', () => {
  const abstractOnly = assembleDigest([makePaper({ id: 'a', abstract: 'x'.repeat(50) })], base);
  const fullText = assembleDigest(
    [makePaper({ id: 'a', abstract: 'x'.repeat(50), openAccessUrl: 'https://x' })],
    base,
  );
  assert.ok(estimatedMinutes(fullText) > estimatedMinutes(abstractOnly));
});
