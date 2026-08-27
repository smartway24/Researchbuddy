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
  context: { term: 'ECMO', meshTerm: 'Extracorporeal Membrane Oxygenation' },
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
      // On-topic: the digest excludes papers that are not about the topic
      // before it ranks anything, so a fixture has to look relevant.
      title: `ECMO cannulation study ${i}`,
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
  const paper = { id: 'a', title: 'ECMO in adults', abstract: 'x'.repeat(50) };
  const abstractOnly = assembleDigest([makePaper(paper)], base);
  const fullText = assembleDigest([makePaper({ ...paper, openAccessUrl: 'https://x' })], base);
  assert.ok(estimatedMinutes(fullText) > estimatedMinutes(abstractOnly));
});

test('a strong paper about something else never reaches the reading list', () => {
  const onTopic = makePaper({ id: 'on', title: 'ECMO for refractory cardiogenic shock' });
  const offTopic = makePaper({
    id: 'off',
    title: 'Drugs for preventing postoperative nausea and vomiting: a network meta-analysis',
    abstract: 'Antiemetics compared after general anaesthesia.',
    publicationTypes: ['Meta-Analysis'],
    year: 2020,
    citedByCount: 127,
  });

  const digest = assembleDigest([onTopic, offTopic], base);
  assert.deepEqual(digest.readingOrder, ['on']);
  assert.equal(digest.candidateCount, 2, 'both were considered, one was excluded');
});
