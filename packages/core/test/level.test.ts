import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aboutness, assessLevel, pedagogy } from '../src/level.js';
import { makePaper } from './helpers.js';

const pvLoop = { term: 'PV Loop', synonyms: ['Pressure-Volume Loop'] };

test('a paper that uses the topic as a method is not about the topic', () => {
  // The real case: a review of ECMO haemodynamics that happens to use PV loops.
  const usesIt = makePaper({
    title: 'Impact of Venoarterial ECMO on Hemodynamics and Cardiac Mechanics',
    abstract: 'Insights from pressure-volume loop analysis in supported patients.',
  });
  const aboutIt = makePaper({
    title: 'Understanding the Pressure-Volume Loop in Valvular Heart Disease',
  });

  assert.ok(
    aboutness(aboutIt, pvLoop).score > aboutness(usesIt, pvLoop).score,
    'a paper with the topic in its title is more about it than one that mentions it',
  );
  assert.ok(aboutness(usesIt, pvLoop).score < 0.6, 'mentioning is not aboutness');
});

test('NLM indexing counts as aboutness even without the title', () => {
  const indexed = makePaper({
    title: 'Cardiac mechanics in the failing ventricle',
    meshTerms: ['Pressure-Volume Loop'],
  });
  assert.ok(aboutness(indexed, pvLoop).score >= 0.5);
});

test('teaching titles read as introductory, study titles as specialist', () => {
  // Assert the level, not the raw score: the score is an implementation
  // detail and the level is what the reading list actually gates on.
  const level = (title: string) => assessLevel(makePaper({ title }), pvLoop).level;

  assert.equal(level('Understanding the Pressure-Volume Loop'), 'introductory');
  assert.equal(level('A primer on ventricular mechanics'), 'introductory');
  assert.equal(level('Physiology of the cardiac cycle'), 'introductory');

  assert.equal(
    level('Validation of PV loop-derived cardiac output versus thermodilution'),
    'specialist',
  );
  assert.equal(level('Predictors of mortality in a single-centre cohort'), 'specialist');
});

test('a paper showing no sign of teaching anything is specialist by default', () => {
  // This is what kept vancomycin pharmacokinetics on the ECMO foundations
  // list: with no signal either way it used to land on the passing side.
  assert.equal(
    assessLevel(
      makePaper({ title: 'Vancomycin population pharmacokinetics during ECMO support' }),
      pvLoop,
    ).level,
    'specialist',
  );
});

test('an abstract that defines its terms scores above one reporting statistics', () => {
  const defines = makePaper({
    title: 'Ventricular mechanics',
    abstract: 'The pressure-volume loop is defined as the relationship traced during one beat.',
  });
  const reports = makePaper({
    title: 'Ventricular mechanics',
    abstract:
      'We enrolled 240 consecutive patients. The primary endpoint occurred in 31% (p = 0.02, 95% CI 1.2-2.4).',
  });
  assert.ok(pedagogy(defines).score > pedagogy(reports).score);
});

test('the assessment names its reasons', () => {
  const assessment = assessLevel(
    makePaper({ title: 'Understanding the Pressure-Volume Loop in Valvular Heart Disease' }),
    pvLoop,
  );
  assert.equal(assessment.level, 'introductory');
  assert.ok(assessment.reasons.length >= 2);
  assert.ok(assessment.reasons.some((reason) => /title/i.test(reason)));
});

test('levels are ordered and bounded', () => {
  for (const paper of [makePaper({}), makePaper({ title: 'Understanding x', abstract: 'y' })]) {
    const assessment = assessLevel(paper, pvLoop);
    assert.ok(assessment.aboutness >= 0 && assessment.aboutness <= 1);
    assert.ok(assessment.pedagogy >= 0 && assessment.pedagogy <= 1);
    assert.ok(['introductory', 'intermediate', 'specialist'].includes(assessment.level));
  }
});
