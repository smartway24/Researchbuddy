import Anthropic from '@anthropic-ai/sdk';
import type { Paper } from '../types.js';
import { getRung } from '../ladder.js';
import { OfflineProvider } from './offline.js';
import type {
  AiProvider,
  CardDraft,
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

  private async completeJson<T>(prompt: string, signal?: AbortSignal): Promise<T> {
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
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
