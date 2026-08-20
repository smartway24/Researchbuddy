import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clusterByTheme, extractRelatedConcepts } from '../src/concepts.js';
import { parsePubmedXml } from '../src/sources/pubmed.js';
import { fixture, makePaper } from './helpers.js';

const papers = parsePubmedXml(fixture('pubmed-ecmo.xml'));

test('drops boilerplate descriptors that carry no topical signal', () => {
  const concepts = extractRelatedConcepts(papers, { minPaperCount: 1, maxPrevalence: 1 });
  const labels = concepts.map((concept) => concept.label.toLowerCase());
  for (const noise of ['humans', 'male', 'female', 'adult', 'retrospective studies']) {
    assert.equal(labels.includes(noise), false, `${noise} should be filtered out`);
  }
});

test('surfaces real neighbouring concepts from MeSH indexing', () => {
  const concepts = extractRelatedConcepts(papers, {
    exclude: ['Extracorporeal Membrane Oxygenation'],
    minPaperCount: 1,
    maxPrevalence: 1,
  });
  assert.ok(concepts.length > 0);
  assert.equal(
    concepts.some((concept) => /extracorporeal membrane oxygenation/i.test(concept.label)),
    false,
    'the topic itself is not a related concept',
  );
  for (const concept of concepts) {
    assert.ok(concept.paperCount >= 1);
    assert.ok(concept.prevalence > 0 && concept.prevalence <= 1);
    assert.ok(concept.examplePaperIds.length > 0);
  }
});

test('a descriptor present in every paper is too generic to be a concept', () => {
  const uniform = [1, 2, 3].map((n) =>
    makePaper({ id: `p${n}`, externalId: String(n), meshTerms: ['Ubiquitous Term', `Specific ${n}`] }),
  );
  const concepts = extractRelatedConcepts(uniform, { maxPrevalence: 0.8, minPaperCount: 1 });
  assert.equal(concepts.some((concept) => concept.label === 'Ubiquitous Term'), false);
});

test('clustering assigns each paper to at most one theme', () => {
  const corpus = [
    makePaper({ id: 'a', meshTerms: ['Anticoagulants', 'Hemorrhage'] }),
    makePaper({ id: 'b', meshTerms: ['Anticoagulants', 'Thrombosis'] }),
    makePaper({ id: 'c', meshTerms: ['Weaning'] }),
  ];
  const { themes, unthemed } = clusterByTheme(corpus, { minPaperCount: 2 });
  const assigned = themes.flatMap((theme) => theme.paperIds);
  assert.equal(new Set(assigned).size, assigned.length, 'no paper appears in two themes');
  assert.equal([...assigned, ...unthemed].sort().join(','), 'a,b,c');
  assert.deepEqual(unthemed, ['c']);
});

test('an empty corpus yields no concepts rather than throwing', () => {
  assert.deepEqual(extractRelatedConcepts([]), []);
});
