import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMeshSummary, resolveMeshTopic } from '../src/sources/mesh.js';

const summary = {
  result: {
    uids: ['68015199'],
    '68015199': {
      uid: '68015199',
      ds_yearintroduced: '1989',
      ds_scopenote: 'Application of a life support system that circulates the blood…',
      ds_meshterms: [
        'Extracorporeal Membrane Oxygenation',
        'ECMO Extracorporeal Membrane Oxygenation',
        'Extracorporeal Life Support',
      ],
    },
  },
};

test('the first MeSH term is the descriptor and the rest are synonyms', () => {
  const resolved = parseMeshSummary(summary, '68015199');
  assert.equal(resolved?.descriptor, 'Extracorporeal Membrane Oxygenation');
  assert.deepEqual(resolved?.synonyms, [
    'ECMO Extracorporeal Membrane Oxygenation',
    'Extracorporeal Life Support',
  ]);
  assert.match(resolved?.definition ?? '', /life support system/);
  assert.equal(resolved?.yearIntroduced, '1989');
});

test('a missing or malformed record resolves to null rather than throwing', () => {
  assert.equal(parseMeshSummary(summary, 'nope'), null);
  assert.equal(parseMeshSummary({ result: { x: {} } }, 'x'), null);
  assert.equal(parseMeshSummary({}, 'x'), null);
});

test(
  'an abbreviation resolves to its descriptor against the live index',
  { skip: process.env['RESEARCHBUDDY_LIVE'] === '1' ? false : 'set RESEARCHBUDDY_LIVE=1' },
  async () => {
    const resolved = await resolveMeshTopic('ECMO');
    assert.equal(resolved?.descriptor, 'Extracorporeal Membrane Oxygenation');
    assert.ok((resolved?.synonyms.length ?? 0) > 3);
    assert.ok((resolved?.definition?.length ?? 0) > 40);
  },
);

test(
  'nonsense resolves to null rather than a wrong topic',
  { skip: process.env['RESEARCHBUDDY_LIVE'] === '1' ? false : 'set RESEARCHBUDDY_LIVE=1' },
  async () => {
    assert.equal(await resolveMeshTopic('qwertyuiopasdfgh'), null);
  },
);
