import { stableHash, type Cache } from './cache.js';
import { assessLevel } from './level.js';
import { topicTerms, type TopicSpec } from './query.js';
import type { AiProvider, JudgeOptions, PaperJudgement } from './ai/types.js';
import type { Paper } from './types.js';

/**
 * The judgement pass.
 *
 * Retrieval is a keyword problem, and the query planner solves it: for "PV
 * loop" it pulls back 89 candidates that genuinely contain the three papers a
 * learner should read first. Judgement is a reading problem, and that is where
 * the app was still a PubMed wrapper — a regex over titles cannot tell that
 * "Close, squeeze, open: introducing the cardiac cycle and pressure-volume
 * loop" is the best introduction in the literature while a 2025 narrative
 * review of VA-ECMO haemodynamics assumes you already know what a loop is.
 *
 * So this layer reads each candidate and says what it is for. Three properties
 * make it safe to depend on:
 *
 *  - **Cached per paper, forever.** A paper's title and abstract do not change,
 *    so a verdict never expires. The second visit to a rung costs nothing, and
 *    the learner's own key is spent once per paper rather than once per screen.
 *  - **Never fatal.** Any paper the model does not return a verdict for — a
 *    dropped batch, a dead network, no key at all — falls back to the
 *    deterministic assessment in `level.ts`. The reading list always renders.
 *  - **Always explained.** Every verdict carries a reason the UI shows, from
 *    the model or from the heuristics. A ranking without its reasons is the
 *    thing this app exists to replace.
 */

/** A verdict plus where it came from — the UI says which, and so does the API. */
export interface JudgeResult {
  judgement: PaperJudgement;
  /** 'model' read the paper; 'heuristic' pattern-matched its title. */
  source: 'model' | 'heuristic';
}

export type Judgements = Map<string, JudgeResult>;

export interface PaperJudgeOptions {
  /**
   * Where verdicts are kept between runs. Without one the judge still works,
   * it just pays for every paper on every visit.
   */
  cache?: Cache;
  /**
   * Bumped when the prompt or the axes change, so old verdicts are not mixed
   * with new ones under the same key.
   */
  version?: string;
}

const JUDGE_VERSION = 'v1';

export class PaperJudge {
  private readonly cache: Cache | undefined;
  private readonly version: string;

  constructor(
    private readonly provider: AiProvider,
    options: PaperJudgeOptions = {},
  ) {
    this.cache = options.cache;
    this.version = options.version ?? JUDGE_VERSION;
  }

  /** True when verdicts come from reading the papers rather than matching them. */
  get readsPapers(): boolean {
    return this.provider.capabilities.generatesProse;
  }

  async judge(papers: Paper[], options: JudgeOptions): Promise<Judgements> {
    const results: Judgements = new Map();
    if (papers.length === 0) return results;

    // Aboutness is relative to the topic, so a verdict is only reusable for
    // the topic it was formed about.
    const topicKey = stableHash(topicTerms(options.topic, 20).join('|').toLowerCase());

    const unjudged: Paper[] = [];
    for (const paper of papers) {
      // `allowStale`: a paper does not change, so an old verdict is a good
      // verdict. The TTL exists for searches, not for judgements.
      const cached = await this.cache
        ?.get<PaperJudgement>(this.key(topicKey, paper.id), true)
        .catch(() => null);
      if (cached?.value && cached.value.paperId === paper.id) {
        results.set(paper.id, { judgement: cached.value, source: 'model' });
      } else {
        unjudged.push(paper);
      }
    }

    if (unjudged.length > 0) {
      let fresh: PaperJudgement[] = [];
      try {
        fresh = await this.provider.judgePapers(unjudged, options);
      } catch {
        // Every paper falls through to the heuristic below. A dead network
        // costs judgement quality, never the reading list.
        fresh = [];
      }

      const byId = new Map(fresh.map((judgement) => [judgement.paperId, judgement]));
      for (const paper of unjudged) {
        const raw = byId.get(paper.id);
        if (!raw) continue;
        // Normalised here rather than trusted from the provider: a verdict
        // with a blank reason or an out-of-range score would otherwise reach
        // the UI, and a ranking shown without its reasons is the one thing
        // this app must never do.
        const judgement = normalize(raw, paper, options.topic);
        results.set(paper.id, { judgement, source: 'model' });
        await this.cache?.set(this.key(topicKey, paper.id), judgement).catch(() => undefined);
      }
    }

    // Whatever is still missing gets the deterministic answer, so the caller
    // can rely on a verdict for every paper it asked about.
    for (const paper of papers) {
      if (results.has(paper.id)) continue;
      results.set(paper.id, {
        judgement: heuristicJudgement(paper, options.topic),
        source: 'heuristic',
      });
    }

    return results;
  }

  private key(topicKey: string, paperId: string): string {
    return `judge.${this.version}.${topicKey}.${stableHash(paperId)}`;
  }
}

/**
 * Make a provider's answer safe to show: score inside 0..1, and a reason that
 * says something. A verdict that explains nothing falls back to the
 * heuristic's wording rather than to a blank line.
 */
function normalize(judgement: PaperJudgement, paper: Paper, topic: TopicSpec): PaperJudgement {
  const aboutness = Number(judgement.aboutness);
  const reason = String(judgement.reason ?? '').trim();
  return {
    paperId: paper.id,
    aboutness: Number.isFinite(aboutness) ? Math.max(0, Math.min(1, aboutness)) : 0.5,
    level: judgement.level,
    reason: reason || heuristicJudgement(paper, topic).reason,
  };
}

/** The fallback verdict, from `level.ts` alone. Exported so callers can preview it. */
export function heuristicJudgement(paper: Paper, topic: TopicSpec): PaperJudgement {
  const assessment = assessLevel(paper, topic);
  return {
    paperId: paper.id,
    aboutness: assessment.aboutness,
    level: assessment.level,
    reason: assessment.reasons[0] ?? 'Judged from its title and indexing.',
  };
}
