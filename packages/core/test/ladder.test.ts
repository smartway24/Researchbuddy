import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeProgress, emptyMastery, isUnlocked, nextRung, orderConcepts } from '../src/ladder.js';
import type { Concept } from '../src/types.js';

test('only orientation is open on a brand new topic', () => {
  const progress = computeProgress('topic-1', emptyMastery());
  assert.deepEqual(progress.unlockedRungs, ['orientation']);
  assert.equal(progress.currentRung, 'orientation');
});

test('mastering a rung unlocks the next one', () => {
  const mastery = { ...emptyMastery(), orientation: 0.7 };
  const progress = computeProgress('topic-1', mastery);
  assert.equal(isUnlocked(progress, 'foundations'), true);
  assert.equal(isUnlocked(progress, 'mechanism'), false);
  assert.equal(progress.currentRung, 'foundations');
});

test('frontier reading stays locked until the rungs below it are solid', () => {
  const mastery = { ...emptyMastery(), orientation: 0.9, frontier: 1 };
  const progress = computeProgress('topic-1', mastery);
  assert.equal(isUnlocked(progress, 'frontier'), false, 'skipping ahead must not unlock the frontier');
});

test('a fully mastered ladder unlocks everything and sits on the frontier', () => {
  const mastery = {
    orientation: 1, foundations: 1, mechanism: 1, applied: 1, evidence: 1, frontier: 1,
  };
  const progress = computeProgress('topic-1', mastery);
  assert.equal(progress.unlockedRungs.length, 6);
  assert.equal(progress.currentRung, 'frontier');
});

test('nextRung walks the ladder and stops at the top', () => {
  assert.equal(nextRung('orientation'), 'foundations');
  assert.equal(nextRung('frontier'), null);
});

test('concepts are ordered so prerequisites come first', () => {
  const concepts: Concept[] = [
    { id: 'c', topicId: 't', rung: 'foundations', label: 'C', summary: '', prerequisites: ['b'], citations: [] },
    { id: 'a', topicId: 't', rung: 'foundations', label: 'A', summary: '', prerequisites: [], citations: [] },
    { id: 'b', topicId: 't', rung: 'foundations', label: 'B', summary: '', prerequisites: ['a'], citations: [] },
  ];
  assert.deepEqual(orderConcepts(concepts).map((concept) => concept.id), ['a', 'b', 'c']);
});

test('a prerequisite cycle does not hang or drop concepts', () => {
  const concepts: Concept[] = [
    { id: 'a', topicId: 't', rung: 'foundations', label: 'A', summary: '', prerequisites: ['b'], citations: [] },
    { id: 'b', topicId: 't', rung: 'foundations', label: 'B', summary: '', prerequisites: ['a'], citations: [] },
  ];
  assert.equal(orderConcepts(concepts).length, 2);
});
