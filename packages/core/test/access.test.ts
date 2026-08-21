import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessLinks, canonicalUrl, proxyUrl, validateInstitution } from '../src/sources/access.js';
import type { Institution } from '../src/sources/types.js';
import { makePaper } from './helpers.js';

const library: Institution = {
  id: 'lib-1',
  name: 'St Elsewhere Medical Library',
  ezproxyPrefix: 'https://login.ezproxy.example.edu/login?url=',
};

test('free full text is offered before anything that needs a login', () => {
  const paper = makePaper({
    doi: '10.1001/jama.2024.0001',
    openAccessUrl: 'https://pmc.example.org/PMC1',
    url: 'https://pubmed.ncbi.nlm.nih.gov/1/',
  });
  const links = accessLinks(paper, [library]);
  assert.equal(links[0]?.method, 'open-access');
  assert.equal(links[0]?.requiresLogin, false);
  assert.equal(links[1]?.method, 'ezproxy');
  assert.equal(links.at(-1)?.method, 'publisher');
});

test('the proxy link wraps the DOI, url-encoded', () => {
  const paper = makePaper({ doi: '10.1001/jama.2024.0001' });
  const links = accessLinks(paper, [library]);
  const proxied = links.find((link) => link.method === 'ezproxy');
  assert.ok(proxied);
  assert.equal(
    proxied.url,
    'https://login.ezproxy.example.edu/login?url=https%3A%2F%2Fdoi.org%2F10.1001%2Fjama.2024.0001',
  );
  assert.equal(proxied.requiresLogin, true);
  assert.match(proxied.label, /St Elsewhere/);
});

test('OpenAthens libraries work the same way', () => {
  const athens: Institution = {
    id: 'lib-2',
    name: 'County Trust',
    openAthensRedirector: 'https://go.openathens.net/redirector/example.nhs.uk?url=',
  };
  const link = proxyUrl('https://doi.org/10.1/x', athens);
  assert.equal(link?.method, 'openathens');
  assert.match(
    link?.url ?? '',
    /^https:\/\/go\.openathens\.net\/redirector\/example\.nhs\.uk\?url=https%3A/,
  );
});

test('a library with no proxy configured produces no proxied link', () => {
  assert.equal(proxyUrl('https://doi.org/10.1/x', { id: 'x', name: 'No Proxy' }), null);
});

test('canonical url prefers the DOI and normalises an already-resolved one', () => {
  assert.equal(
    canonicalUrl(makePaper({ doi: '10.1/x', url: 'https://p' })),
    'https://doi.org/10.1/x',
  );
  assert.equal(
    canonicalUrl(makePaper({ doi: 'https://doi.org/10.1/x' })),
    'https://doi.org/10.1/x',
  );
  assert.equal(canonicalUrl(makePaper({ url: 'https://p' })), 'https://p');
});

test('institution setup is validated before it can produce dead links', () => {
  assert.deepEqual(validateInstitution(library), []);
  assert.ok(
    validateInstitution({ name: 'X' }).some((problem) => /EZproxy|OpenAthens/.test(problem)),
  );
  assert.ok(
    validateInstitution({ name: 'X', ezproxyPrefix: 'http://login.example.edu/login?url=' }).some(
      (problem) => /https/.test(problem),
    ),
  );
  assert.ok(
    validateInstitution({ name: 'X', ezproxyPrefix: 'https://login.example.edu/login' }).some(
      (problem) => /url=/.test(problem),
    ),
  );
  assert.ok(
    validateInstitution({ ezproxyPrefix: library.ezproxyPrefix }).some((p) => /name/i.test(p)),
  );
});
