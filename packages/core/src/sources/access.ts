import type { Paper } from '../types.js';
import type { AccessLink, Institution } from './types.js';

/**
 * Turn a paper into the ordered list of ways the learner can actually read it.
 *
 * Order matters: free full text first (no login, works offline-ish, no
 * institutional dependency), then the learner's own library proxy, then the
 * publisher's page as a last resort.
 *
 * Design constraints, deliberate:
 *  - No credentials are stored or replayed. Proxy links open the institution's
 *    own login page in a browser session the learner drives.
 *  - Nothing behind a paywall is fetched, cached, or re-hosted by the app.
 *    Researchbuddy links to entitled content; it does not redistribute it.
 */
export function accessLinks(paper: Paper, institutions: Institution[] = []): AccessLink[] {
  const links: AccessLink[] = [];

  if (paper.openAccessUrl) {
    links.push({
      url: paper.openAccessUrl,
      method: 'open-access',
      label: 'Free full text',
      requiresLogin: false,
    });
  }

  const canonical = canonicalUrl(paper);
  if (canonical) {
    for (const institution of institutions) {
      const proxied = proxyUrl(canonical, institution);
      if (proxied) links.push(proxied);
    }
  }

  if (paper.url) {
    links.push({
      url: paper.url,
      method: 'publisher',
      label: paper.sourceId === 'pubmed' ? 'PubMed record' : 'Publisher page',
      requiresLogin: false,
    });
  }

  return links;
}

/** The URL worth proxying: a DOI resolves to the publisher's full text. */
export function canonicalUrl(paper: Paper): string | undefined {
  if (paper.doi) return `https://doi.org/${paper.doi.replace(/^https?:\/\/doi\.org\//, '')}`;
  return paper.url;
}

export function proxyUrl(targetUrl: string, institution: Institution): AccessLink | null {
  if (institution.ezproxyPrefix) {
    return {
      url: `${institution.ezproxyPrefix}${encodeURIComponent(targetUrl)}`,
      method: 'ezproxy',
      label: `Read via ${institution.name}`,
      requiresLogin: true,
    };
  }
  if (institution.openAthensRedirector) {
    return {
      url: `${institution.openAthensRedirector}${encodeURIComponent(targetUrl)}`,
      method: 'openathens',
      label: `Read via ${institution.name}`,
      requiresLogin: true,
    };
  }
  return null;
}

/**
 * Validate what the learner typed when adding a library. Proxy prefixes are
 * pasted from a library help page and are easy to get subtly wrong, so we
 * check the shape up front rather than producing dead links later.
 */
export function validateInstitution(institution: Partial<Institution>): string[] {
  const problems: string[] = [];
  if (!institution.name?.trim()) problems.push('Give the library a name.');

  const prefixes = [institution.ezproxyPrefix, institution.openAthensRedirector].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (prefixes.length === 0) {
    problems.push('Add an EZproxy login prefix or an OpenAthens redirector URL.');
  }
  for (const prefix of prefixes) {
    if (!/^https:\/\//i.test(prefix)) {
      problems.push(`Proxy URLs must start with https:// — got "${truncate(prefix)}".`);
      continue;
    }
    if (!/[?&](url|qurl)=$/i.test(prefix)) {
      problems.push(
        `Proxy URLs should end with "url=" so the article link can be appended — got "${truncate(prefix)}".`,
      );
    }
  }
  return problems;
}

function truncate(value: string, max = 60): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
