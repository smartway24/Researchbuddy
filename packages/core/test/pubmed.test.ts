import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePubmedXml } from '../src/sources/pubmed.js';
import { fixture } from './helpers.js';

const papers = parsePubmedXml(fixture('pubmed-ecmo.xml'));

test('parses every article in the set', () => {
  assert.equal(papers.length, 3);
  for (const paper of papers) {
    assert.match(paper.id, /^pubmed:\d+$/);
    assert.ok(paper.title.length > 10, `missing title for ${paper.id}`);
    assert.ok(paper.authors.length > 0, `missing authors for ${paper.id}`);
    assert.equal(paper.url, `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`);
  }
});

test('extracts identifiers, journal and year', () => {
  const withDoi = papers.filter((paper) => paper.doi);
  assert.ok(withDoi.length >= 2, 'expected DOIs on most records');
  for (const paper of papers) {
    assert.ok(paper.journal && paper.journal.length > 3, `missing journal for ${paper.id}`);
    assert.ok(paper.year && paper.year > 1990 && paper.year <= new Date().getFullYear() + 1);
  }
});

test('keeps structured abstract section labels', () => {
  const structured = papers.find((paper) => (paper.abstract ?? '').includes(':'));
  assert.ok(structured, 'expected at least one structured abstract');
  assert.ok((structured.abstract ?? '').length > 200);
});

test('captures publication types and MeSH indexing', () => {
  const trial = papers.find((paper) =>
    paper.publicationTypes.some((type) => /randomized controlled trial/i.test(type)),
  );
  assert.ok(trial, 'expected a randomised trial in the fixture');
  assert.ok(trial.meshTerms.length > 0);
  assert.ok(
    trial.meshTerms.some((term) => /extracorporeal membrane oxygenation/i.test(term)),
    'expected the topic MeSH descriptor',
  );
});

test('links PMC full text when the record has a PMC id', () => {
  for (const paper of papers) {
    if (paper.pmcid) {
      assert.equal(paper.openAccessUrl, `https://www.ncbi.nlm.nih.gov/pmc/articles/${paper.pmcid}/`);
    } else {
      assert.equal(paper.openAccessUrl, undefined);
    }
  }
});
