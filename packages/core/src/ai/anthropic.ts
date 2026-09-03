import Anthropic from '@anthropic-ai/sdk';
import type { Paper } from '../types.js';
import { getRung } from '../ladder.js';
import { isLevel } from '../level.js';
import { topicTerms } from '../query.js';
import { OfflineProvider } from './offline.js';
import type {
  AiProvider,
  CardDraft,
  JudgeOptions,
  PaperJudgement,
  PaperSummary,
  ProviderCapabilities,
  SummarizeOptions,
} from './types.js';

/**
 * Claude-backed provider, bring-your-own key.
 *
 * The key is the learner's own, stored in the device keychain by the app and
 * passed in here — Researchbuddy runs no proxy and holds no keys. Only the
 * title and abstract of a paper are sent; nothing about the learner's deck,
 * progress, or notes leaves the device.
 *
 * Every method degrades to the offline extractive provider on failure, so a
 * bad key or a dead connection costs quality, never function.
 */
export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  /**
   * React Native and browser runtimes need this. It is safe here *because* the
   * key belongs to the user running the app — it is not a shared server key.
   */
  allowBrowser?: boolean;
  /** Fall back to extractive summaries instead of throwing. Default true. */
  fallbackOnError?: boolean;
}

const DEFAULT_MODEL = 'claude-opus-5';

const SYSTEM_PROMPT = `You help a clinician or student learn a medical topic from primary literature.

Rules:
- Only use what is in the supplied text. Never add facts from memory.
- If the text does not support a claim, say so rather than filling the gap.
- Keep numbers, units, and effect sizes exactly as written.
- Be plain and direct. No hedging filler, no "it is important to note".
- This is educational material, not clinical advice for a specific patient.`;

/**
 * The judgement prompt is the product.
 *
 * Everything else in this app is plumbing around one question a clinician asks
 * themselves a hundred times an hour in PubMed: *is this worth my next twenty
 * minutes?* The two axes below are that question, split so each can be
 * answered independently — a paper can be squarely about the topic and still
 * be unreadable at this stage, and the reading list has to know the difference.
 */
const JUDGE_SYSTEM_PROMPT = `You are the reading-list filter for a clinician teaching themselves a topic from primary literature.

For each paper you get a title, journal, year, and the opening of the abstract. Judge exactly two things.

ABOUTNESS, 0.0 to 1.0 — is the paper *about* the topic, or does it merely use it?
  1.0  the topic is the subject of the work
  0.7  the topic is one of a few things the work is about
  0.4  the topic is a component of the thing being studied
  0.2  the topic is the setting, the tool, or the population, not the subject
  0.0  mentioned in passing, or this is a different thing that shares a name or acronym

LEVEL — who is it written for?
  "introductory"  teaches the concept from nothing; a reader who has never met it finishes understanding it
  "intermediate"  assumes the vocabulary, and explains the mechanism or the reasoning
  "specialist"    assumes the concept whole, and reports a new result, comparison, or refinement

Rules that decide most cases:
- Publication type is not level. A narrative review written for people who already use the technique is specialist; a case report written to teach a principle can be introductory.
- A paper reporting what happened to a cohort is specialist, however clearly written.
- A paper whose title promises to explain, introduce, demystify or walk through the topic is usually introductory — but only if the abstract keeps that promise rather than pivoting to a study.
- Judge how the paper reads. Use only the supplied text; never facts you know about the paper from elsewhere.

REASON — one clause, at most 14 words, in plain words, addressed to the learner. Say what the paper does for them, or why it will not help. No hedging, no restating the title.`;

/**
 * Papers per request. Big enough that judging 60 candidates is a handful of
 * calls, small enough that one malformed reply does not cost the whole rung —
 * anything missing falls back to the heuristic rather than disappearing.
 */
const JUDGE_BATCH_SIZE = 12;

/** Batches in flight at once. See `judgePapers`. */
const JUDGE_CONCURRENCY = 3;

/**
 * How much abstract the model sees. The first paragraph is where a paper
 * announces who it is talking to; past that it is methods, and methods all
 * read the same.
 */
const JUDGE_ABSTRACT_CHARS = 900;

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic';
  readonly capabilities: ProviderCapabilities = {
    generatesProse: true,
    sendsDataOffDevice: true,
    label: 'Claude (your API key)',
  };

  private readonly client: Anthropic;
  private readonly model: string;
  private readonly fallback = new OfflineProvider();
  private readonly fallbackOnError: boolean;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.allowBrowser ? { dangerouslyAllowBrowser: true } : {}),
    });
    this.model = options.model ?? DEFAULT_MODEL;
    this.fallbackOnError = options.fallbackOnError ?? true;
  }

  async summarizePaper(paper: Paper, options: SummarizeOptions): Promise<PaperSummary> {
    if (!paper.abstract) return this.fallback.summarizePaper(paper, options);

    const rung = getRung(options.rung);
    const prompt = `A learner is working at the "${rung.title}" stage: ${rung.goal}

Summarise this paper for them.

Title: ${paper.title}
Journal: ${paper.journal ?? 'unknown'} (${paper.year ?? 'year unknown'})
Publication types: ${paper.publicationTypes.join(', ') || 'unknown'}

Abstract:
${paper.abstract}

Reply with JSON only, no prose around it:
{"headline": "one sentence on what it found",
 "bullets": ["2-5 short points useful at this stage"],
 "caveats": ["limitations that affect how much weight to give it"]}`;

    try {
      const parsed = await this.completeJson<PaperSummary>(prompt, options.signal);
      return {
        headline: String(parsed.headline ?? '').trim() || paper.title,
        bullets: toStringArray(parsed.bullets).slice(0, 5),
        caveats: toStringArray(parsed.caveats).slice(0, 4),
      };
    } catch (error) {
      if (!this.fallbackOnError) throw error;
      return this.fallback.summarizePaper(paper, options);
    }
  }

  async draftCards(
    input: { title: string; body: string; sourceIds: string[]; count?: number },
    options: SummarizeOptions,
  ): Promise<CardDraft[]> {
    const count = input.count ?? 4;
    const rung = getRung(options.rung);
    const prompt = `A learner is working at the "${rung.title}" stage: ${rung.goal}

Write ${count} spaced-repetition cards from the text below.

A good card asks one thing, has a short unambiguous answer, and tests
understanding rather than recall of the paper's title. Prefer "why" and "how"
over "what did this study call X".

Title: ${input.title}

Text:
${input.body}

Reply with JSON only, no prose around it:
{"cards": [{"front": "question", "back": "answer"}]}`;

    try {
      const parsed = await this.completeJson<{ cards?: { front?: string; back?: string }[] }>(
        prompt,
        options.signal,
      );
      const cards = (parsed.cards ?? [])
        .map((card) => ({
          front: String(card.front ?? '').trim(),
          back: String(card.back ?? '').trim(),
          sourceIds: input.sourceIds,
        }))
        .filter((card) => card.front.length > 0 && card.back.length > 0);
      if (cards.length === 0) throw new Error('Model returned no usable cards');
      return cards.slice(0, count);
    } catch (error) {
      if (!this.fallbackOnError) throw error;
      return this.fallback.draftCards(input, options);
    }
  }

  async judgePapers(papers: Paper[], options: JudgeOptions): Promise<PaperJudgement[]> {
    if (papers.length === 0) return [];

    const names = topicTerms(options.topic);
    const rung = getRung(options.rung);

    const batches: Paper[][] = [];
    for (let index = 0; index < papers.length; index += JUDGE_BATCH_SIZE) {
      batches.push(papers.slice(index, index + JUDGE_BATCH_SIZE));
    }

    // A few batches at a time. Sequentially, a first visit to a rung with 90
    // candidates is eight round trips and most of a minute of spinner; all at
    // once is eight sockets from a phone on cellular and a rate limit waiting
    // at the end. Verdicts are cached, so this is paid once per paper ever.
    const judgements: PaperJudgement[] = [];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < batches.length) {
        if (options.signal?.aborted) return;
        const batch = batches[next++];
        if (!batch) return;
        try {
          judgements.push(...(await this.judgeBatch(batch, names, rung, options.signal)));
        } catch (error) {
          // An aborted request means the learner left the screen; stop rather
          // than spending their key on results nobody will see.
          if (options.signal?.aborted) return;
          if (!this.fallbackOnError) throw error;
          // Otherwise leave this batch unjudged. The caller fills the gap from
          // the deterministic assessment, so one bad batch costs quality on
          // twelve papers rather than on the whole reading list.
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(JUDGE_CONCURRENCY, batches.length) }, () => worker()),
    );

    return judgements;
  }

  private async judgeBatch(
    papers: Paper[],
    names: string[],
    rung: { title: string; goal: string },
    signal?: AbortSignal,
  ): Promise<PaperJudgement[]> {
    const listed = papers
      .map((paper, index) => {
        const abstract = (paper.abstract ?? '').replace(/\s+/g, ' ').trim();
        return [
          `[${index + 1}]`,
          `Title: ${paper.title}`,
          `Journal: ${paper.journal ?? 'unknown'} (${paper.year ?? 'year unknown'})`,
          `Types: ${paper.publicationTypes.join(', ') || 'unindexed'}`,
          abstract
            ? `Abstract: ${abstract.slice(0, JUDGE_ABSTRACT_CHARS)}${abstract.length > JUDGE_ABSTRACT_CHARS ? '…' : ''}`
            : 'Abstract: none indexed.',
        ].join('\n');
      })
      .join('\n\n');

    const prompt = `Topic: ${names[0]}${names.length > 1 ? `\nAlso called: ${names.slice(1).join(', ')}` : ''}

The learner is at the "${rung.title}" stage: ${rung.goal}

Judge each paper below.

${listed}

Reply with JSON only, no prose around it, one entry per paper, in order:
{"judgements": [{"n": 1, "aboutness": 0.0, "level": "introductory|intermediate|specialist", "reason": "one clause"}]}`;

    const parsed = await this.completeJson<{ judgements?: unknown }>(
      prompt,
      signal,
      JUDGE_SYSTEM_PROMPT,
    );

    const raw = Array.isArray(parsed.judgements) ? parsed.judgements : [];
    const judgements: PaperJudgement[] = [];

    for (const [position, entry] of raw.entries()) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;

      // Trust `n` when it is a usable index and fall back to position, so a
      // model that drops the field still lines up with the right paper.
      const numbered = Number(record.n);
      const index =
        Number.isInteger(numbered) && numbered >= 1 && numbered <= papers.length
          ? numbered - 1
          : position;
      const paper = papers[index];
      if (!paper) continue;

      const level = record.level;
      if (!isLevel(level)) continue;

      const aboutness = Number(record.aboutness);
      if (!Number.isFinite(aboutness)) continue;

      const reason = String(record.reason ?? '').trim();
      judgements.push({
        paperId: paper.id,
        aboutness: Math.max(0, Math.min(1, aboutness)),
        level,
        reason: reason || `Judged as ${level} reading on this topic.`,
      });
    }

    return judgements;
  }

  private async completeJson<T>(
    prompt: string,
    signal?: AbortSignal,
    system: string = SYSTEM_PROMPT,
  ): Promise<T> {
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: 4096,
        system,
        // `thinking` is deliberately omitted: on the default model it runs
        // adaptively when unset, and the installed SDK's types predate the
        // adaptive option. Do not reintroduce `budget_tokens` here — current
        // models reject it.
        messages: [{ role: 'user', content: prompt }],
      },
      signal ? { signal } : {},
    );

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return parseJsonObject<T>(text);
  }
}

/** Models sometimes wrap JSON in prose or a fence; take the outermost object. */
export function parseJsonObject<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model response');
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}
