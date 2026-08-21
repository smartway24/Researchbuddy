import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyEvidence,
  paperAgeYears,
  rankPapers,
  scorePaper,
  topicalFit,
} from '../src/rank.js';
import { makePaper } from './helpers.js';

const NOW = new Date('2026-06-01T00:00:00Z');

test('classifies by publication type, strongest label winning', () => {
  assert.equal(
    classifyEvidence(makePaper({ publicationTypes: ['Practice Guideline'] })),
    'guideline',
  );
  assert.equal(
    classifyEvidence(makePaper({ publicationTypes: ['Journal Article', 'Meta-Analysis'] })),
    'systematic-review',
  );
  assert.equal(
    classifyEvidence(
      makePaper({ publicationTypes: ['Randomized Controlled Trial', 'Journal Article'] }),
    ),
    'rct',
  );
  assert.equal(classifyEvidence(makePaper({ publicationTypes: ['Review'] })), 'narrative-review');
  assert.equal(classifyEvidence(makePaper({ publicationTypes: ['Case Reports'] })), 'case-series');
});

test('falls back to title hints when publication types are missing', () => {
  assert.equal(
    classifyEvidence(makePaper({ title: 'ECMO in ARDS: a systematic review and meta-analysis' })),
    'systematic-review',
  );
  assert.equal(classifyEvidence(makePaper({ title: 'Something entirely unlabelled' })), 'other');
});

test('early rungs prefer reviews and late rungs prefer trials', () => {
  const review = makePaper({ id: 'r', publicationTypes: ['Review'], year: 2024 });
  const trial = makePaper({
    id: 't',
    publicationTypes: ['Randomized Controlled Trial'],
    year: 2024,
  });

  const orientation = rankPapers([review, trial], { rung: 'orientation', now: NOW });
  assert.equal(orientation[0]?.paper.id, 'r', 'orientation should lead with the review');

  const evidence = rankPapers([review, trial], { rung: 'evidence', now: NOW });
  assert.equal(evidence[0]?.paper.id, 't', 'the evidence rung should lead with the trial');
});

test('recency dominates on the frontier rung', () => {
  const old = makePaper({
    id: 'old',
    publicationTypes: ['Randomized Controlled Trial'],
    year: 2010,
  });
  const fresh = makePaper({
    id: 'fresh',
    publicationTypes: ['Randomized Controlled Trial'],
    year: 2025,
  });
  const ranked = rankPapers([old, fresh], { rung: 'frontier', now: NOW });
  assert.equal(ranked[0]?.paper.id, 'fresh');
});

test('every score carries reasons and stays inside 0..1', () => {
  const scored = scorePaper(
    makePaper({
      publicationTypes: ['Practice Guideline'],
      year: 2025,
      openAccessUrl: 'https://x',
      abstract: 'a'.repeat(60),
    }),
    { rung: 'applied', now: NOW },
  );
  assert.ok(scored.score > 0 && scored.score <= 1);
  assert.ok(scored.reasons.length >= 2);
  assert.ok(scored.reasons.some((reason) => /free full text/i.test(reason)));
});

test('topical fit measures overlap with the focus terms', () => {
  const paper = makePaper({
    title: 'Cannula position and recirculation',
    meshTerms: ['Extracorporeal Membrane Oxygenation'],
  });
  assert.equal(topicalFit(paper, ['recirculation', 'cannula']), 1);
  assert.equal(topicalFit(paper, ['recirculation', 'anticoagulation']), 0.5);
  assert.equal(topicalFit(paper, []), 0.6, 'no focus terms means neutral fit');
});

test('paper age handles year-only, month, and missing dates', () => {
  assert.equal(paperAgeYears(makePaper({ year: 2026, publishedAt: '2026-06' }), NOW), 0);
  assert.ok((paperAgeYears(makePaper({ year: 2016 }), NOW) ?? 0) > 9);
  assert.equal(paperAgeYears(makePaper({}), NOW), null);
});
