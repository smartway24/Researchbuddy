import type { Paper } from '../types.js';
import type {
  AiProvider,
  CardDraft,
  PaperSummary,
  ProviderCapabilities,
  SummarizeOptions,
} from './types.js';

/**
 * The default provider: no network, no key, no account.
 *
 * Medical abstracts are unusually well-structured — most carry explicit
 * Background/Methods/Results/Conclusions labels — so extraction gets you a
 * genuinely useful summary without a model in the loop. This is what the app
 * ships with, and what it falls back to when a model call fails.
 */
export class OfflineProvider implements AiProvider {
  readonly id = 'offline';
  readonly capabilities: ProviderCapabilities = {
    generatesProse: false,
    sendsDataOffDevice: false,
    label: 'On-device (extractive)',
  };

  async summarizePaper(paper: Paper, _options: SummarizeOptions): Promise<PaperSummary> {
    const sections = splitStructuredAbstract(paper.abstract ?? '');

    const conclusion =
      sections.get('conclusions') ??
      sections.get('conclusion') ??
      sections.get('interpretation') ??
      '';
    const results = sections.get('results') ?? sections.get('findings') ?? '';
    const methods = sections.get('methods') ?? sections.get('design') ?? '';

    const headline = firstSentence(conclusion) || firstSentence(results) || paper.title;

    const bullets = [
      ...sentences(results).slice(0, 3),
      ...sentences(conclusion).slice(0, 2),
    ].filter(Boolean);

    const caveats: string[] = [];
    const limitations = sections.get('limitations');
    if (limitations) caveats.push(...sentences(limitations).slice(0, 2));
    if (methods) {
      const sample = /\b(n\s*=\s*[\d,]+|\d[\d,]* (?:patients|participants|subjects))\b/i.exec(methods);
      if (sample?.[0]) caveats.push(`Sample: ${sample[0]}.`);
      if (/retrospective|single[- ]cent(re|er)/i.test(methods)) {
        caveats.push('Retrospective or single-centre design.');
      }
    }
    if (!paper.abstract) caveats.push('No abstract indexed — read the full text before relying on this.');

    return {
      headline: headline.trim(),
      bullets: bullets.length > 0 ? bullets : sentences(paper.abstract ?? '').slice(0, 3),
      caveats,
    };
  }

  async draftCards(
    input: { title: string; body: string; sourceIds: string[]; count?: number },
    _options: SummarizeOptions,
  ): Promise<CardDraft[]> {
    const wanted = input.count ?? 3;
    const sections = splitStructuredAbstract(input.body);
    const drafts: CardDraft[] = [];

    // Section-labelled abstracts give a free question for each section.
    for (const [label, text] of sections) {
      if (drafts.length >= wanted) break;
      const answer = firstSentence(text);
      if (!answer || answer.length < 25) continue;
      const question = QUESTION_BY_SECTION[label];
      if (!question) continue;
      drafts.push({
        front: `${input.title} — ${question}`,
        back: answer,
        sourceIds: input.sourceIds,
      });
    }

    // Fall back to cloze deletions over the most information-dense sentences.
    const body = sentences(input.body);
    if (drafts.length < wanted) {
      for (const sentence of body) {
        if (drafts.length >= wanted) break;
        const cloze = makeCloze(sentence);
        if (cloze) drafts.push({ ...cloze, sourceIds: input.sourceIds });
      }
    }

    // Unstructured review abstracts often have no labels and no numbers to
    // blank out. Rather than silently produce nothing, fall back to the
    // closing sentence, which in that style is almost always the claim.
    if (drafts.length === 0 && body.length > 0) {
      const closing = body[body.length - 1] as string;
      drafts.push({
        front: `${input.title} — what is the main point?`,
        back: closing,
        sourceIds: input.sourceIds,
      });
    }

    return drafts.slice(0, wanted);
  }
}

const QUESTION_BY_SECTION: Record<string, string> = {
  background: 'what problem does this address?',
  objective: 'what was the question?',
  objectives: 'what was the question?',
  purpose: 'what was the question?',
  methods: 'how was it studied?',
  design: 'how was it studied?',
  results: 'what was found?',
  findings: 'what was found?',
  conclusions: 'what does it conclude?',
  conclusion: 'what does it conclude?',
  interpretation: 'what does it conclude?',
};

/** Split "Methods: ... Results: ..." into a label → text map. */
export function splitStructuredAbstract(abstract: string): Map<string, string> {
  const sections = new Map<string, string>();
  if (!abstract.trim()) return sections;

  const pattern = /(^|\n\s*|\.\s+)([A-Z][A-Za-z /&]{3,40}):\s+/g;
  // `labelStart` is where the label itself begins, so the preceding section
  // ends there — including the sentence-ending period that introduced it.
  const marks: { label: string; labelStart: number; textStart: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(abstract)) !== null) {
    const label = (match[2] ?? '').trim().toLowerCase();
    if (label.split(/\s+/).length > 4) continue;
    marks.push({
      label,
      labelStart: match.index + (match[1]?.length ?? 0),
      textStart: match.index + match[0].length,
    });
  }

  for (const [index, mark] of marks.entries()) {
    const end = marks[index + 1]?.labelStart ?? abstract.length;
    const text = abstract.slice(mark.textStart, Math.max(mark.textStart, end)).trim();
    if (text) sections.set(mark.label, text);
  }

  return sections;
}

export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 20);
}

export function firstSentence(text: string): string {
  return sentences(text)[0] ?? text.trim();
}

/**
 * Blank out the most specific thing in a sentence: a measured value first,
 * then a multi-word proper term. Sentences with nothing specific in them make
 * vague cards, so they are skipped rather than turned into bad ones.
 */
export function makeCloze(sentence: string): { front: string; back: string } | null {
  if (sentence.length > 320) return null;

  const measured =
    /\b\d+(?:\.\d+)?\s?(?:%|mg|mL|mmHg|L\/min|hours?|days?|weeks?|months?|years?)\b/i.exec(sentence)?.[0] ??
    /\b\d+(?:\.\d+)?\b/.exec(sentence)?.[0];
  if (measured) {
    return { front: sentence.replace(measured, '_____'), back: measured };
  }

  // A capitalised phrase away from the sentence start is almost always the
  // named entity the sentence is about — the thing worth recalling.
  const phrase = /(?!^)\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/.exec(sentence.slice(1))?.[0];
  if (phrase && phrase.length >= 8) {
    return { front: sentence.replace(phrase, '_____'), back: phrase };
  }

  return null;
}
