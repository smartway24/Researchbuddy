import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardStrength, dueQueue, initialReviewState, isDue, review, rungMastery } from '../src/srs.js';
import type { ReviewState, RungId } from '../src/types.js';

const START = new Date('2026-01-01T09:00:00Z');
const day = (n: number) => new Date(START.getTime() + n * 86_400_000);

test('a new card is due immediately and has no strength', () => {
  const state = initialReviewState('card-1', START);
  assert.equal(isDue(state, START), true);
  assert.equal(cardStrength(state), 0);
});

test('successful reviews follow the 1, 6, then ease-multiplied schedule', () => {
  let state = initialReviewState('card-1', START);
  state = review(state, 5, START);
  assert.equal(state.intervalDays, 1);
  state = review(state, 5, day(1));
  assert.equal(state.intervalDays, 6);
  state = review(state, 5, day(7));
  assert.ok(state.intervalDays > 6, 'third interval should grow past 6 days');
  assert.equal(state.repetitions, 3);
  assert.equal(state.lapses, 0);
});

test('a lapse resets the interval but not below the ease floor', () => {
  let state = initialReviewState('card-1', START);
  for (let i = 0; i < 4; i++) state = review(state, 5, day(i));
  const before = state.intervalDays;
  state = review(state, 1, day(5));
  assert.equal(state.repetitions, 0);
  assert.equal(state.intervalDays, 1);
  assert.equal(state.lapses, 1);
  assert.ok(state.intervalDays < before);

  for (let i = 0; i < 10; i++) state = review(state, 0, day(6 + i));
  assert.ok(state.easeFactor >= 1.3, 'ease factor must not fall below 1.3');
});

test('intervals are capped at a year', () => {
  let state = initialReviewState('card-1', START);
  for (let i = 0; i < 20; i++) state = review(state, 5, day(i * 30));
  assert.ok(state.intervalDays <= 365);
});

test('the due queue is longest-overdue first, with unseen cards last', () => {
  const overdueOld: ReviewState = {
    ...initialReviewState('old', START),
    dueAt: day(-10).toISOString(),
    lastReviewedAt: day(-20).toISOString(),
    repetitions: 2,
  };
  const overdueRecent: ReviewState = {
    ...initialReviewState('recent', START),
    dueAt: day(-1).toISOString(),
    lastReviewedAt: day(-3).toISOString(),
    repetitions: 1,
  };
  const unseen = initialReviewState('unseen', START);
  const notYetDue: ReviewState = { ...initialReviewState('later', START), dueAt: day(5).toISOString() };

  const queue = dueQueue([notYetDue, unseen, overdueRecent, overdueOld], START, 10);
  assert.deepEqual(queue.map((state) => state.cardId), ['old', 'recent', 'unseen']);
});

test('the due queue respects its limit', () => {
  const states = Array.from({ length: 50 }, (_, i) => initialReviewState(`card-${i}`, START));
  assert.equal(dueQueue(states, START, 20).length, 20);
});

test('rung mastery counts unseen cards as zero and saturates with interval', () => {
  const conceptRungs = new Map<string, RungId>([
    ['concept-a', 'foundations'],
    ['concept-b', 'foundations'],
    ['concept-c', 'frontier'],
  ]);
  const cards = [
    { id: 'card-a', conceptId: 'concept-a' },
    { id: 'card-b', conceptId: 'concept-b' },
    { id: 'card-c', conceptId: 'concept-c' },
  ];

  const empty = new Map<string, ReviewState>();
  assert.equal(rungMastery(cards, conceptRungs, empty, 'foundations'), 0);

  let mature = initialReviewState('card-a', START);
  for (let i = 0; i < 5; i++) mature = review(mature, 5, day(i * 7));
  const states = new Map<string, ReviewState>([['card-a', mature]]);

  const mastery = rungMastery(cards, conceptRungs, states, 'foundations');
  assert.ok(mastery > 0.4 && mastery < 0.6, `one of two cards mature should be ~0.5, got ${mastery}`);
  assert.equal(rungMastery(cards, conceptRungs, states, 'orientation'), 0, 'no cards means no mastery');
});
