import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findAll, findFirst, parseXml, textContent } from '../src/sources/xml.js';

test('parses nested elements and attributes', () => {
  const root = parseXml('<a x="1"><b y="2">hello</b><b>world</b></a>');
  const a = findFirst(root, 'a');
  assert.equal(a?.attributes['x'], '1');
  const bs = findAll(root, 'b');
  assert.equal(bs.length, 2);
  assert.equal(bs[0]?.attributes['y'], '2');
  assert.equal(textContent(bs[0]), 'hello');
});

test('decodes entities and handles CDATA', () => {
  const root = parseXml('<a>5 &lt; 10 &amp; 20 &#62; 3<b><![CDATA[raw <tag> & stuff]]></b></a>');
  assert.equal(textContent(findFirst(root, 'a')).startsWith('5 < 10 & 20 > 3'), true);
  assert.equal(textContent(findFirst(root, 'b')), 'raw <tag> & stuff');
});

test('handles self-closing tags, comments and declarations', () => {
  const root = parseXml('<?xml version="1.0"?><!-- note --><a><br/><c>x</c></a>');
  assert.equal(findAll(root, 'br').length, 1);
  assert.equal(textContent(findFirst(root, 'c')), 'x');
});

test('does not end a tag on a > inside an attribute value', () => {
  const root = parseXml('<a title="1 > 0"><b>ok</b></a>');
  assert.equal(findFirst(root, 'a')?.attributes['title'], '1 > 0');
  assert.equal(textContent(findFirst(root, 'b')), 'ok');
});

test('tolerates unclosed and stray tags rather than throwing', () => {
  const root = parseXml('<a><b>one</a></c><d>two</d>');
  assert.equal(textContent(findFirst(root, 'b')), 'one');
  assert.equal(textContent(findFirst(root, 'd')), 'two');
});
