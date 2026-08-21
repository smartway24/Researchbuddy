import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OfflineProvider, makeCloze, splitStructuredAbstract } from '../src/ai/offline.js';
import { parsePubmedXml } from '../src/sources/pubmed.js';
import { fixture, makePaper } from './helpers.js';

const provider = new OfflineProvider();
const options = { rung: 'evidence' as const };

test('the offline provider never sends anything off device', () => {
  assert.equal(provider.capabilities.sendsDataOffDevice, false);
});

test('splits a structured abstract into its labelled sections', () => {
  const sections = splitStructuredAbstract(
    'Background: ECMO is used in severe respiratory failure and remains debated. ' +
      'Methods: We randomised 249 patients to ECMO or conventional care in twenty centres. ' +
      'Results: Mortality was 35% versus 46% at 60 days in the two study groups. ' +
      'Conclusions: ECMO did not significantly reduce 60-day mortality in this trial.',
  );
  assert.deepEqual([...sections.keys()], ['background', 'methods', 'results', 'conclusions']);
  assert.match(sections.get('results') ?? '', /35%/);
});

test('an unstructured abstract yields no sections rather than junk ones', () => {
  assert.equal(splitStructuredAbstract('One long paragraph with no labels at all.').size, 0);
});

test('summaries lead with the conclusion and flag design limitations', async () => {
  const paper = makePaper({
    abstract:
      'Methods: This was a retrospective single-center review of 40 patients receiving support. ' +
      'Results: Survival to discharge was 55% among the treated patients in this series. ' +
      'Conclusions: Outcomes were comparable to those reported in larger registries.',
  });
  const summary = await provider.summarizePaper(paper, options);
  assert.match(summary.headline, /comparable/i);
  assert.ok(summary.bullets.length > 0);
  assert.ok(summary.caveats.some((caveat) => /retrospective|single/i.test(caveat)));
});

test('a paper with no abstract is summarised honestly', async () => {
  const summary = await provider.summarizePaper(makePaper({ title: 'Untitled work' }), options);
  assert.equal(summary.headline, 'Untitled work');
  assert.ok(summary.caveats.some((caveat) => /no abstract/i.test(caveat)));
});

test('cards are drafted from real abstracts with source attribution', async () => {
  const paper = parsePubmedXml(fixture('pubmed-ecmo.xml')).find((p) => p.abstract);
  assert.ok(paper);
  const cards = await provider.draftCards(
    { title: paper.title, body: paper.abstract ?? '', sourceIds: [paper.id], count: 3 },
    options,
  );
  assert.ok(cards.length > 0, 'expected at least one card from a real abstract');
  for (const card of cards) {
    assert.ok(card.front.length > 5);
    assert.ok(card.back.length > 0);
    assert.deepEqual(card.sourceIds, [paper.id]);
  }
});

test('cloze cards blank out the specific value, not a vague phrase', async () => {
  const cards = await provider.draftCards(
    {
      title: 'Flow targets',
      body: 'Circuit flow was maintained at 4.5 L/min throughout the observation period in all patients.',
      sourceIds: [],
      count: 1,
    },
    options,
  );
  assert.equal(cards.length, 1);
  assert.match(cards[0]?.front ?? '', /_____/);
  assert.equal(cards[0]?.back, '4.5 L/min');
});

test('an unstructured abstract with no numbers still yields a card', async () => {
  const cards = await provider.draftCards(
    {
      title: 'Extracorporeal life support for adult patients with ARDS',
      body:
        'Extracorporeal life support has become part of the management of severe respiratory failure. ' +
        'Its role remains defined by patient selection rather than by the technology itself. ' +
        'Referral to an experienced centre remains the single most important determinant of outcome.',
      sourceIds: ['pubmed:1'],
      count: 3,
    },
    options,
  );
  assert.ok(cards.length > 0, 'a readable abstract must never produce zero cards');
  for (const card of cards) assert.ok(card.back.length > 0);
});

test('a cloze falls back to a named term when there is no number', () => {
  const cloze = makeCloze(
    'Referral to an experienced centre determines outcome in Severe Respiratory Failure.',
  );
  assert.equal(cloze?.back, 'Severe Respiratory Failure');
  assert.match(cloze?.front ?? '', /_____/);
});

test('a sentence with nothing specific in it is skipped, not made into a vague card', () => {
  assert.equal(
    makeCloze('This has been discussed at length elsewhere in the wider literature.'),
    null,
  );
});

test('an over-long sentence is not turned into a card', () => {
  assert.equal(makeCloze(`Mortality was 40% ${'x'.repeat(400)}`), null);
});
