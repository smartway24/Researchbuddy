import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Cache, MemoryStore } from '../src/cache.js';
import { assembleDigest } from '../src/digest.js';
import { heuristicJudgement, PaperJudge, type Judgements } from '../src/judge.js';
import { OfflineProvider } from '../src/ai/offline.js';
import type { AiProvider, JudgeOptions, PaperJudgement } from '../src/ai/types.js';
import type { Paper } from '../src/types.js';
import { makePaper } from './helpers.js';

const topic = { term: 'PV Loop', synonyms: ['Pressure-Volume Loop'] };
const options: JudgeOptions = { rung: 'orientation', topic };

/**
 * The paper the heuristics got wrong for months: a genuine introduction whose
 * title matched no pattern list, in a journal that publishes teaching pieces.
 */
const introduction = makePaper({
  id: 'pubmed:teaching',
  externalId: 'teaching',
  title: 'Close, squeeze, open: the cardiac cycle and the pressure-volume loop',
  abstract: 'We walk through each phase of the cardiac cycle and build the loop from it.',
  year: 2018,
});

/** A specialist paper that uses the loop as its method. */
const specialist = makePaper({
  id: 'pubmed:specialist',
  externalId: 'specialist',
  title: 'Left ventricular unloading during VA-ECMO: a pressure-volume loop analysis',
  abstract: 'We enrolled 42 consecutive patients. Hazard ratio 0.62, 95% CI 0.4-0.9, p = 0.01.',
  year: 2025,
});

/** A provider that answers from a script, so a test never touches the network. */
class ScriptedProvider implements AiProvider {
  readonly id = 'scripted';
  readonly capabilities = {
    generatesProse: true,
    sendsDataOffDevice: true,
    label: 'Scripted',
  };
  calls: string[][] = [];

  constructor(
    private readonly answer: (papers: Paper[]) => PaperJudgement[],
    private readonly offline = new OfflineProvider(),
  ) {}

  summarizePaper: AiProvider['summarizePaper'] = (paper, opts) =>
    this.offline.summarizePaper(paper, opts);
  draftCards: AiProvider['draftCards'] = (input, opts) => this.offline.draftCards(input, opts);

  async judgePapers(papers: Paper[]): Promise<PaperJudgement[]> {
    this.calls.push(papers.map((paper) => paper.id));
    return this.answer(papers);
  }
}

const modelVerdicts = (papers: Paper[]): PaperJudgement[] =>
  papers.map((paper) => ({
    paperId: paper.id,
    aboutness: paper.id === introduction.id ? 0.95 : 0.8,
    level: paper.id === introduction.id ? ('introductory' as const) : ('specialist' as const),
    reason:
      paper.id === introduction.id
        ? 'Builds the loop phase by phase from the cardiac cycle'
        : 'Uses the loop as a measurement tool; assumes you know it',
  }));

test('a verdict reaches the caller with the reason the model gave', async () => {
  const judge = new PaperJudge(new ScriptedProvider(modelVerdicts));
  const verdicts = await judge.judge([introduction, specialist], options);

  assert.equal(verdicts.size, 2);
  const verdict = verdicts.get(introduction.id);
  assert.equal(verdict?.source, 'model');
  assert.equal(verdict?.judgement.level, 'introductory');
  assert.match(verdict?.judgement.reason ?? '', /phase by phase/);
});

test('the model overrules the heuristics on the paper they get wrong', async () => {
  // The whole point of the pass: by title patterns alone this reads as
  // specialist, because nothing in it says "introduction" or "primer".
  assert.equal(heuristicJudgement(introduction, topic).level, 'specialist');

  const judge = new PaperJudge(new ScriptedProvider(modelVerdicts));
  const verdicts = await judge.judge([introduction], options);
  assert.equal(verdicts.get(introduction.id)?.judgement.level, 'introductory');
});

test('a paper is judged once ever, then served from the cache', async () => {
  const cache = new Cache(new MemoryStore(), { ttlMs: 60_000 });
  const provider = new ScriptedProvider(modelVerdicts);
  const judge = new PaperJudge(provider, { cache });

  await judge.judge([introduction, specialist], options);
  assert.equal(provider.calls.length, 1);

  const again = await judge.judge([introduction, specialist], options);
  assert.equal(provider.calls.length, 1, 'a second visit must not call the model again');
  assert.equal(again.get(specialist.id)?.judgement.level, 'specialist');
});

test('a cached verdict is used long past the search TTL', async () => {
  // A paper does not change, so an old verdict is a good verdict. If this
  // regresses, every reading list silently re-bills the learner's API key.
  let now = new Date('2026-01-01T00:00:00Z');
  const cache = new Cache(new MemoryStore(), { ttlMs: 1000, now: () => now });
  const provider = new ScriptedProvider(modelVerdicts);
  const judge = new PaperJudge(provider, { cache });

  await judge.judge([introduction], options);
  now = new Date('2027-01-01T00:00:00Z');
  const verdicts = await judge.judge([introduction], options);

  assert.equal(provider.calls.length, 1);
  assert.equal(verdicts.get(introduction.id)?.source, 'model');
});

test('verdicts are not reused across topics', async () => {
  const cache = new Cache(new MemoryStore());
  const provider = new ScriptedProvider(modelVerdicts);
  const judge = new PaperJudge(provider, { cache });

  await judge.judge([specialist], options);
  await judge.judge([specialist], { rung: 'orientation', topic: { term: 'ECMO' } });

  // Aboutness is relative to the topic: the same paper is 0.8 about PV loops
  // and something else entirely about ECMO.
  assert.equal(provider.calls.length, 2);
});

test('a provider that throws costs quality, never the reading list', async () => {
  const exploding = new ScriptedProvider(() => {
    throw new Error('no network');
  });
  const judge = new PaperJudge(exploding);
  const verdicts = await judge.judge([introduction, specialist], options);

  assert.equal(verdicts.size, 2);
  for (const verdict of verdicts.values()) {
    assert.equal(verdict.source, 'heuristic');
    assert.ok(verdict.judgement.reason.length > 0, 'a fallback verdict still explains itself');
  }
});

test('papers the model skipped fall back individually', async () => {
  // A partial batch must not make the missing papers vanish from the digest.
  const partial = new ScriptedProvider((papers) =>
    modelVerdicts(papers.filter((paper) => paper.id === introduction.id)),
  );
  const verdicts = await new PaperJudge(partial).judge([introduction, specialist], options);

  assert.equal(verdicts.get(introduction.id)?.source, 'model');
  assert.equal(verdicts.get(specialist.id)?.source, 'heuristic');
});

test('every verdict carries a reason, whoever formed it', async () => {
  const silent = new ScriptedProvider((papers) =>
    papers.map((paper) => ({
      paperId: paper.id,
      aboutness: 0.9,
      level: 'introductory' as const,
      reason: '',
    })),
  );
  const verdicts = await new PaperJudge(silent).judge([introduction], options);
  // An empty reason is the provider's business to fill; the contract the UI
  // depends on is that `reasons` is never blank in the finished digest.
  const digest = assembleDigest([introduction], {
    topicId: 't',
    rung: 'orientation',
    context: topic,
    sources: [],
    judgements: verdicts,
  });
  const scored = digest.sections[0]?.papers[0];
  assert.ok(scored, 'the paper survived the gate');
  assert.ok(scored.reasons.every((reason) => reason.trim().length > 0));
});

test('the digest gate follows the verdict, not the title patterns', () => {
  const base = {
    topicId: 't',
    rung: 'orientation' as const,
    context: topic,
    sources: [],
  };

  // Without a verdict the heuristics exclude the teaching paper from
  // orientation, which is the bug this pass exists to fix.
  assert.equal(assembleDigest([introduction], base).readingOrder.length, 0);

  const judgements: Judgements = new Map([
    [
      introduction.id,
      {
        judgement: {
          paperId: introduction.id,
          aboutness: 0.95,
          level: 'introductory' as const,
          reason: 'Builds the loop phase by phase',
        },
        source: 'model' as const,
      },
    ],
  ]);
  const judged = assembleDigest([introduction], { ...base, judgements });
  assert.deepEqual(judged.readingOrder, [introduction.id]);
  assert.ok(
    judged.sections[0]?.papers[0]?.reasons.includes('Builds the loop phase by phase'),
    "the model's reason is what the learner reads",
  );
});

test('a verdict can also exclude a paper the heuristics would have kept', () => {
  const looksIntroductory = makePaper({
    id: 'pubmed:decoy',
    externalId: 'decoy',
    title: 'Understanding the pressure-volume loop in pelvic organ prolapse surgery',
    abstract: 'This review describes our operative approach.',
    year: 2021,
  });
  const base = {
    topicId: 't',
    rung: 'orientation' as const,
    context: topic,
    sources: [],
  };
  assert.equal(assembleDigest([looksIntroductory], base).readingOrder.length, 1);

  const judgements: Judgements = new Map([
    [
      looksIntroductory.id,
      {
        judgement: {
          paperId: looksIntroductory.id,
          aboutness: 0.2,
          level: 'specialist' as const,
          reason: 'A different loop; this is about a surgical technique',
        },
        source: 'model' as const,
      },
    ],
  ]);
  assert.equal(assembleDigest([looksIntroductory], { ...base, judgements }).readingOrder.length, 0);
});

test('the offline provider judges without a network, key, or model', async () => {
  const verdicts = await new OfflineProvider().judgePapers([introduction, specialist], options);
  assert.equal(verdicts.length, 2);
  for (const verdict of verdicts) {
    assert.ok(['introductory', 'intermediate', 'specialist'].includes(verdict.level));
    assert.ok(verdict.reason.length > 0);
  }
});

test('a verdict outweighs recency on the teaching rungs', async () => {
  // The best introduction to a concept is often old. If recency can outrank a
  // verdict that read the paper, orientation fills with new papers that merely
  // mention the topic — the failure this pass exists to fix.
  const older = makePaper({
    id: 'pubmed:older',
    externalId: 'older',
    title: 'The pressure-volume loop, from the beginning',
    abstract: 'We build the loop one phase at a time.',
    year: 2008,
    publicationTypes: ['Review'],
  });
  const newer = makePaper({
    id: 'pubmed:newer',
    externalId: 'newer',
    title: 'The pressure-volume loop in transcatheter valve repair',
    abstract: 'A review of our institutional experience.',
    year: 2026,
    publicationTypes: ['Review'],
  });

  const judgements: Judgements = new Map([
    [
      older.id,
      {
        judgement: {
          paperId: older.id,
          aboutness: 1,
          level: 'introductory' as const,
          reason: 'Builds the loop from nothing',
        },
        source: 'model' as const,
      },
    ],
    [
      newer.id,
      {
        judgement: {
          paperId: newer.id,
          aboutness: 0.9,
          level: 'introductory' as const,
          reason: 'Explains the loop in one clinical setting',
        },
        source: 'model' as const,
      },
    ],
  ]);

  const digest = assembleDigest([newer, older], {
    topicId: 't',
    rung: 'orientation',
    context: topic,
    sources: [],
    judgements,
    now: new Date('2026-06-01T00:00:00Z'),
  });

  assert.equal(digest.readingOrder[0], older.id, 'the eighteen-year-old primer still leads');
});
