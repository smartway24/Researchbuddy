import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanTerm,
  planForRung,
  renderEuropePmcQuery,
  renderPubMedQuery,
  topicTerms,
  type TopicSpec,
} from '../src/query.js';
import { RUNG_ORDER } from '../src/types.js';

const ecmo: TopicSpec = {
  term: 'ECMO',
  meshTerm: 'Extracorporeal Membrane Oxygenation',
  synonyms: ['Extracorporeal Life Support', 'ECLS Treatment'],
};

const options = { currentYear: 2026 };

test('characters that would break either parser are stripped', () => {
  assert.equal(cleanTerm('ARDS (severe) [adult]:'), 'ARDS severe adult');
  assert.equal(cleanTerm('  PV   Loop '), 'PV Loop');
});

test('topic terms are deduplicated, descriptor first, synonyms bounded', () => {
  assert.deepEqual(topicTerms(ecmo), [
    'Extracorporeal Membrane Oxygenation',
    'ECMO',
    'Extracorporeal Life Support',
    'ECLS Treatment',
  ]);
  assert.deepEqual(topicTerms({ term: 'ECMO', meshTerm: 'ECMO' }), ['ECMO'], 'no duplicates');
  assert.equal(topicTerms({ term: 'x', synonyms: ['a', 'b', 'c', 'd', 'e', 'f'] }).length, 5);
});

test('every rung produces a usable, explained plan', () => {
  for (const rung of RUNG_ORDER) {
    const plan = planForRung(rung, ecmo, options);
    assert.equal(plan.rung, rung);
    assert.ok(plan.limit > 0 && plan.limit <= 100, 'within what a source will return');
    assert.ok(plan.explanation.length > 20, `${rung} needs an explanation`);
    assert.ok(renderPubMedQuery(plan).includes('ECMO'));
    assert.ok(renderEuropePmcQuery(plan).includes('ECMO'));
  }
});

test('PubMed queries use PubMed field tags', () => {
  const query = renderPubMedQuery(planForRung('evidence', ecmo, options));
  assert.match(query, /"Extracorporeal Membrane Oxygenation"\[MeSH Terms:noexp\]/);
  assert.match(query, /ECMO\[Title\/Abstract\]/);
  assert.match(query, /randomized controlled trial\[Publication Type\]/);
  assert.match(query, /\[Date - Publication\]/);
});

test('Europe PMC queries use Europe PMC field names', () => {
  const query = renderEuropePmcQuery(planForRung('evidence', ecmo, options));
  assert.match(query, /TITLE_ABS:"ECMO"/);
  assert.match(query, /PUB_TYPE:"randomized controlled trial"/);
  assert.match(query, /FIRST_PDATE:\[2006-01-01 TO 2026-12-31\]/);
});

test("neither renderer leaks the other source's syntax", () => {
  for (const rung of RUNG_ORDER) {
    const plan = planForRung(rung, ecmo, options);

    const pubmed = renderPubMedQuery(plan);
    assert.equal(
      pubmed.includes('TITLE_ABS:'),
      false,
      `${rung}: Europe PMC syntax in PubMed query`,
    );
    assert.equal(pubmed.includes('PUB_TYPE:'), false);
    assert.equal(pubmed.includes('FIRST_PDATE'), false);

    const europe = renderEuropePmcQuery(plan);
    assert.equal(
      europe.includes('[Title/Abstract]'),
      false,
      `${rung}: PubMed syntax in Europe PMC query`,
    );
    assert.equal(europe.includes('[Publication Type]'), false);
    assert.equal(europe.includes('[Date - Publication]'), false);
  }
});

test('the frontier rung only looks at the last two years', () => {
  assert.equal(planForRung('frontier', ecmo, options).fromYear, 2024);
  assert.ok((planForRung('orientation', ecmo, options).fromYear ?? 0) < 2024);
});

test('the applied rung restricts to human studies, the mechanism rung does not', () => {
  assert.equal(planForRung('applied', ecmo, options).humansOnly, true);
  assert.match(
    renderPubMedQuery(planForRung('applied', ecmo, options)),
    /humans\[MeSH Terms:noexp\]/,
  );
  assert.equal(planForRung('mechanism', ecmo, options).humansOnly, false);
});

test('focus terms narrow the search without replacing the topic', () => {
  const plan = planForRung('orientation', ecmo, { ...options, focusTerms: ['recirculation'] });
  assert.deepEqual(plan.anyText, ['recirculation']);
  const query = renderPubMedQuery(plan);
  assert.match(query, /recirculation\[Title\/Abstract\]/);
  assert.match(query, /ECMO\[Title\]/, 'orientation anchors the topic to the title');
});

test('a topic with no MeSH descriptor still produces a valid query', () => {
  const plan = planForRung('orientation', { term: 'PV Loop' }, options);
  const pubmed = renderPubMedQuery(plan);
  const europe = renderEuropePmcQuery(plan);
  assert.match(pubmed, /"PV Loop"\[Title\]/);
  assert.equal(pubmed.includes('[MeSH'), false, 'no MeSH clause without a descriptor');
  assert.match(europe, /TITLE:"PV Loop"/);
  assert.equal(europe.includes('MESH:'), false);
});

test('the teaching rungs anchor the topic to the title, the frontier does not', () => {
  for (const rung of ['orientation', 'foundations', 'mechanism'] as const) {
    const plan = planForRung(rung, ecmo, options);
    assert.equal(plan.titleAnchored, true, `${rung} should be title-anchored`);
    assert.match(renderPubMedQuery(plan), /ECMO\[Title\]/);
    assert.match(renderPubMedQuery(plan), /\[MeSH Major Topic:noexp\]/);
    assert.match(renderEuropePmcQuery(plan), /TITLE:"ECMO"/);
  }
  for (const rung of ['applied', 'evidence', 'frontier'] as const) {
    const plan = planForRung(rung, ecmo, options);
    assert.equal(plan.titleAnchored, false, `${rung} should search the whole record`);
    assert.match(renderPubMedQuery(plan), /ECMO\[Title\/Abstract\]/);
  }
});

test('orientation no longer filters on publication type', () => {
  // "review" is a metadata tag, not a level: a specialist review of a topic is
  // still a review. Level is judged after retrieval instead.
  assert.deepEqual(planForRung('orientation', ecmo, options).publicationTypes, []);
});

test('MeSH clauses never explode down the tree', () => {
  // Exploding "Respiratory Distress Syndrome" pulls in its narrower newborn
  // term, which put neonatal surfactant trials on an adult ARDS reading list.
  const ards: TopicSpec = { term: 'ARDS', meshTerm: 'Respiratory Distress Syndrome' };
  for (const rung of RUNG_ORDER) {
    const query = renderPubMedQuery(planForRung(rung, ards, options));
    const mesh = query.match(/\[MeSH[^\]]*\]/g) ?? [];
    for (const clause of mesh) {
      assert.match(clause, /:noexp\]$/, `${rung}: ${clause} would explode`);
    }
  }
});

test('the descriptor is matched as a descriptor, never as free text', () => {
  const ards: TopicSpec = { term: 'ARDS', meshTerm: 'Respiratory Distress Syndrome' };
  const query = renderPubMedQuery(planForRung('evidence', ards, options));
  assert.match(query, /"Respiratory Distress Syndrome"\[MeSH Terms:noexp\]/);
  assert.equal(
    query.includes('"Respiratory Distress Syndrome"[Title/Abstract]'),
    false,
    'the phrase as free text also matches neonatal RDS',
  );
  assert.match(query, /ARDS\[Title\/Abstract\]/);
});
