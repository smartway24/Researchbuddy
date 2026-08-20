import assert from 'node:assert/strict';
import { test } from 'node:test';
import { neighbourhoodPlans, planForRung, quoteTerm, topicClause } from '../src/query.js';
import { RUNG_ORDER } from '../src/types.js';

const context = {
  topic: 'ECMO',
  meshTerm: 'Extracorporeal Membrane Oxygenation',
  currentYear: 2026,
};

test('multi-word terms are quoted and single words are not', () => {
  assert.equal(quoteTerm('ECMO'), 'ECMO');
  assert.equal(quoteTerm('Extracorporeal Membrane Oxygenation'), '"Extracorporeal Membrane Oxygenation"');
});

test('characters that would break the query parser are stripped', () => {
  assert.equal(quoteTerm('ARDS (severe) [adult]'), '"ARDS severe adult"');
});

test('the topic clause anchors on MeSH when available', () => {
  const clause = topicClause(context);
  assert.match(clause, /\[MeSH Terms\]/);
  assert.match(clause, /\[Title\/Abstract\]/);
  assert.equal(topicClause({ topic: 'ECMO' }).includes('MeSH'), false);
});

test('focus terms narrow the query with an AND', () => {
  const clause = topicClause({ ...context, focusTerms: ['recirculation'] });
  assert.match(clause, /\) AND \(/);
  assert.match(clause, /recirculation\[Title\/Abstract\]/);
});

test('a few synonyms widen the query without unbounding it', () => {
  const clause = topicClause({
    ...context,
    synonyms: ['Extracorporeal Life Support', 'ECLS Treatment', 'a', 'b', 'c', 'd'],
  });
  assert.match(clause, /"Extracorporeal Life Support"\[Title\/Abstract\]/);
  assert.equal((clause.match(/\[Title\/Abstract\]/g) ?? []).length, 5, 'topic plus at most four synonyms');
});

test('every rung produces a usable, explained plan', () => {
  for (const rung of RUNG_ORDER) {
    const plan = planForRung(rung, context);
    assert.equal(plan.rung, rung);
    assert.ok(plan.term.includes('ECMO'));
    assert.ok(plan.limit > 0 && plan.limit <= 25);
    assert.ok(plan.explanation.length > 20, `${rung} needs an explanation`);
  }
});

test('the frontier rung only looks at the last two years', () => {
  const plan = planForRung('frontier', context);
  assert.equal(plan.fromYear, 2024);
  const orientation = planForRung('orientation', context);
  assert.ok((orientation.fromYear ?? 0) < 2024, 'orientation reaches further back');
});

test('the evidence rung filters to trials, syntheses and guidelines', () => {
  const plan = planForRung('evidence', context);
  assert.match(plan.term, /randomized controlled trial\[Publication Type\]/);
  assert.match(plan.term, /meta-analysis\[Publication Type\]/);
});

test('neighbourhood plans map around the topic rather than into it', () => {
  const plans = neighbourhoodPlans(context);
  assert.equal(plans.length, 3);
  assert.ok(plans.some((plan) => /history/i.test(plan.term)));
  assert.ok(plans.some((plan) => /controversy/i.test(plan.term)));
});
