import { clusterByTheme } from './concepts.js';
import { getRung } from './ladder.js';
import { planForRung, type QueryContext } from './query.js';
import { evidenceLabel, rankPapers } from './rank.js';
import { searchAll } from './sources/registry.js';
import type { SourceAdapter } from './sources/types.js';
import type { Digest, DigestSection, Paper, RungId, ScoredPaper } from './types.js';

/**
 * A digest is the deliverable: for the rung you are on, the reading that is
 * worth your next hour, grouped into themes, in the order you should read it.
 * The learner does no searching, no filtering, and no sorting.
 */

export interface BuildDigestOptions {
  topicId: string;
  rung: RungId;
  context: QueryContext;
  sources: SourceAdapter[];
  /** Papers already read; excluded so a digest never repeats itself. */
  seenPaperIds?: Set<string>;
  /** Cap on papers in the finished digest. */
  maxPapers?: number;
  now?: Date;
  signal?: AbortSignal;
}

export async function buildDigest(options: BuildDigestOptions): Promise<Digest> {
  const plan = planForRung(options.rung, options.context);
  const query: Parameters<SourceAdapter['search']>[0] = {
    term: plan.term,
    limit: plan.limit,
  };
  if (plan.fromYear !== undefined) query.fromYear = plan.fromYear;
  if (plan.toYear !== undefined) query.toYear = plan.toYear;
  if (options.signal) query.signal = options.signal;

  const federated = await searchAll(options.sources, query);
  return { ...assembleDigest(federated.papers, options), sourceStatus: federated.bySource };
}

/**
 * How much of this digest came off the device rather than the network, and
 * how old that copy is. The UI uses it to say "saved yesterday" instead of
 * quietly presenting stale results as current.
 */
export function digestFreshness(digest: Digest): {
  live: boolean;
  cached: boolean;
  /** Oldest cached copy contributing to the digest. */
  savedAt?: string;
  failedSources: string[];
} {
  const status = digest.sourceStatus ?? [];
  const cachedEntries = status.filter((entry) => entry.fromCache);
  const savedTimes = cachedEntries
    .map((entry) => entry.savedAt)
    .filter((value): value is string => Boolean(value))
    .sort();

  return {
    live: status.some((entry) => !entry.fromCache && !entry.error),
    cached: cachedEntries.length > 0,
    ...(savedTimes[0] ? { savedAt: savedTimes[0] } : {}),
    failedSources: status.filter((entry) => entry.error).map((entry) => entry.sourceId),
  };
}

/**
 * The pure half of `buildDigest`: everything from retrieved papers to a
 * finished digest, with no I/O. Kept separate so it is testable against
 * fixtures and reusable for locally cached papers.
 */
export function assembleDigest(papers: Paper[], options: BuildDigestOptions): Digest {
  const now = options.now ?? new Date();
  const seen = options.seenPaperIds ?? new Set<string>();
  const maxPapers = options.maxPapers ?? 12;

  const candidateCount = papers.length;
  const fresh = papers.filter((paper) => !seen.has(paper.id));

  const scoreOptions: Parameters<typeof rankPapers>[1] = { rung: options.rung, now };
  if (options.context.focusTerms?.length) scoreOptions.focusTerms = options.context.focusTerms;

  const ranked = rankPapers(fresh, scoreOptions).slice(0, maxPapers);
  const byId = new Map(ranked.map((scored) => [scored.paper.id, scored]));

  // The topic and every name for it must not be reported as concepts "around"
  // itself — that is the single most common way a concept map turns useless.
  const exclude = [
    options.context.topic,
    options.context.meshTerm,
    ...(options.context.synonyms ?? []),
  ].filter((value): value is string => Boolean(value));
  const { themes, unthemed } = clusterByTheme(
    ranked.map((scored) => scored.paper),
    { exclude, minPaperCount: 2, limit: 5 },
  );

  const sections: DigestSection[] = themes.map((theme) => {
    const members = theme.paperIds
      .map((id) => byId.get(id))
      .filter((scored): scored is ScoredPaper => scored !== undefined)
      .sort((a, b) => b.score - a.score);
    return {
      title: theme.label,
      rationale: rationaleFor(members, options.rung),
      papers: members,
    };
  });

  const leftovers = unthemed
    .map((id) => byId.get(id))
    .filter((scored): scored is ScoredPaper => scored !== undefined)
    .sort((a, b) => b.score - a.score);

  if (leftovers.length > 0) {
    sections.push({
      title: 'Also worth a look',
      rationale: 'Strong papers that did not group with the themes above.',
      papers: leftovers,
    });
  }

  // Sections lead with their strongest paper; ordering sections by that paper
  // means the first thing the learner opens is the best thing in the digest.
  sections.sort((a, b) => (b.papers[0]?.score ?? 0) - (a.papers[0]?.score ?? 0));

  return {
    topicId: options.topicId,
    rung: options.rung,
    generatedAt: now.toISOString(),
    sections,
    readingOrder: sections.flatMap((section) => section.papers.map((scored) => scored.paper.id)),
    candidateCount,
  };
}

function rationaleFor(papers: ScoredPaper[], rung: RungId): string {
  if (papers.length === 0) return getRung(rung).goal;
  const levels = new Set(papers.map((scored) => evidenceLabel(scored.evidenceLevel)));
  const years = papers.map((scored) => scored.paper.year).filter((y): y is number => Boolean(y));
  const span =
    years.length > 0
      ? years.length === 1 || Math.min(...years) === Math.max(...years)
        ? ` from ${years[0]}`
        : ` from ${Math.min(...years)}–${Math.max(...years)}`
      : '';
  return `${papers.length} paper${papers.length === 1 ? '' : 's'}${span} — ${[...levels]
    .slice(0, 2)
    .join(', ')
    .toLowerCase()}.`;
}

/** Rough reading time, for planning a session. Abstract-only counts as 2 minutes. */
export function estimatedMinutes(digest: Digest): number {
  return digest.sections.reduce(
    (total, section) =>
      total +
      section.papers.reduce(
        (sum, scored) => sum + (scored.paper.openAccessUrl ? 12 : scored.paper.abstract ? 3 : 2),
        0,
      ),
    0,
  );
}
