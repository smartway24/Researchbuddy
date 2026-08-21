import type { Card, ReviewGrade, ReviewState, RungId } from './types.js';

/**
 * Spaced repetition, SM-2 with the usual practical guards:
 * a lapse drops the interval to one day but keeps a floor on the ease factor,
 * and successful intervals are capped so nothing disappears for a decade.
 */
const MIN_EASE = 1.3;
const MAX_INTERVAL_DAYS = 365;
const PASS_THRESHOLD: ReviewGrade = 3;

const DAY_MS = 86_400_000;

export function isPass(grade: ReviewGrade): boolean {
  return grade >= PASS_THRESHOLD;
}

export function initialReviewState(cardId: string, now: Date = new Date()): ReviewState {
  return {
    cardId,
    repetitions: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    dueAt: now.toISOString(),
    lastReviewedAt: null,
    reviewCount: 0,
    lapses: 0,
  };
}

export function review(
  state: ReviewState,
  grade: ReviewGrade,
  now: Date = new Date(),
): ReviewState {
  const passed = isPass(grade);

  // SM-2 ease update, applied on every review including lapses.
  const easeDelta = 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02);
  const easeFactor = Math.max(MIN_EASE, round(state.easeFactor + easeDelta));

  let repetitions: number;
  let intervalDays: number;

  if (!passed) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    repetitions = state.repetitions + 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.round(state.intervalDays * easeFactor);
    intervalDays = Math.min(MAX_INTERVAL_DAYS, Math.max(1, intervalDays));
  }

  return {
    cardId: state.cardId,
    repetitions,
    intervalDays,
    easeFactor,
    dueAt: new Date(now.getTime() + intervalDays * DAY_MS).toISOString(),
    lastReviewedAt: now.toISOString(),
    reviewCount: state.reviewCount + 1,
    lapses: state.lapses + (passed ? 0 : 1),
  };
}

export function isDue(state: ReviewState, now: Date = new Date()): boolean {
  return new Date(state.dueAt).getTime() <= now.getTime();
}

/**
 * Cards to study right now: everything overdue, longest-overdue first, then
 * cards never seen. `limit` keeps a session finishable in one sitting.
 */
export function dueQueue(states: ReviewState[], now: Date = new Date(), limit = 20): ReviewState[] {
  return states
    .filter((state) => isDue(state, now))
    .sort((a, b) => {
      if (a.lastReviewedAt === null && b.lastReviewedAt !== null) return 1;
      if (b.lastReviewedAt === null && a.lastReviewedAt !== null) return -1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    })
    .slice(0, limit);
}

/**
 * Mastery of a rung, 0..1: the mean per-card retention strength across the
 * rung's cards. A card's strength grows with its scheduled interval — a card
 * you will not see again for a month is one you know — and unseen cards count
 * as zero so an untouched rung never reads as mastered.
 */
export function rungMastery(
  cards: Pick<Card, 'id' | 'conceptId'>[],
  conceptRungs: Map<string, RungId>,
  states: Map<string, ReviewState>,
  rung: RungId,
): number {
  const rungCards = cards.filter((card) => conceptRungs.get(card.conceptId) === rung);
  if (rungCards.length === 0) return 0;

  const total = rungCards.reduce((sum, card) => sum + cardStrength(states.get(card.id)), 0);
  return round(total / rungCards.length);
}

/** 0..1 strength for one card: saturates at a 21-day interval. */
export function cardStrength(state: ReviewState | undefined): number {
  if (!state || state.lastReviewedAt === null) return 0;
  if (state.repetitions === 0) return 0.1; // seen but currently lapsed
  return Math.min(1, state.intervalDays / 21);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
