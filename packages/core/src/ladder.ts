import {
  RUNG_ORDER,
  type Concept,
  type RungDefinition,
  type RungId,
  type TopicProgress,
} from './types.js';

/**
 * The ladder is the spine of the app: it turns "I want to learn ECMO" into an
 * ordered path, and it is what keeps frontier literature from arriving before
 * the learner can read it critically.
 */
export const LADDER: readonly RungDefinition[] = [
  {
    id: 'orientation',
    title: 'Orientation',
    goal: 'What this is, why it exists, and the vocabulary you need to read anything else.',
    unlocksAt: null,
  },
  {
    id: 'foundations',
    title: 'Foundations',
    goal: 'The anatomy, physiology, and physics the topic is built on.',
    unlocksAt: 0.6,
  },
  {
    id: 'mechanism',
    title: 'Mechanism',
    goal: 'How it actually works, step by step, including failure modes.',
    unlocksAt: 0.7,
  },
  {
    id: 'applied',
    title: 'Applied practice',
    goal: 'Indications, contraindications, management, and complications in real use.',
    unlocksAt: 0.7,
  },
  {
    id: 'evidence',
    title: 'Evidence base',
    goal: 'The landmark trials and guidelines, and where the consensus actually sits.',
    unlocksAt: 0.75,
  },
  {
    id: 'frontier',
    title: 'Frontier',
    goal: 'What changed in the last two years and what is still unresolved.',
    unlocksAt: 0.75,
  },
] as const;

const BY_ID = new Map<RungId, RungDefinition>(LADDER.map((r) => [r.id, r]));

export function getRung(id: RungId): RungDefinition {
  const rung = BY_ID.get(id);
  if (!rung) throw new Error(`Unknown rung: ${id}`);
  return rung;
}

export function rungIndex(id: RungId): number {
  const index = RUNG_ORDER.indexOf(id);
  if (index < 0) throw new Error(`Unknown rung: ${id}`);
  return index;
}

export function nextRung(id: RungId): RungId | null {
  const next = RUNG_ORDER[rungIndex(id) + 1];
  return next ?? null;
}

export function emptyMastery(): Record<RungId, number> {
  return Object.fromEntries(RUNG_ORDER.map((r) => [r, 0])) as Record<RungId, number>;
}

/**
 * Walk the ladder from the bottom, unlocking each rung whose predecessor has
 * reached its threshold. A gap stops the walk: mastering a later rung out of
 * order never skips an earlier one.
 */
export function computeProgress(
  topicId: string,
  masteryByRung: Record<RungId, number>,
): TopicProgress {
  const unlocked: RungId[] = [];
  for (const rung of LADDER) {
    if (rung.unlocksAt === null) {
      unlocked.push(rung.id);
      continue;
    }
    const previous = RUNG_ORDER[rungIndex(rung.id) - 1];
    if (!previous || !unlocked.includes(previous)) break;
    if ((masteryByRung[previous] ?? 0) < rung.unlocksAt) break;
    unlocked.push(rung.id);
  }

  // The current rung is the first unlocked one that is not yet mastered,
  // falling back to the highest unlocked rung when everything is solid.
  const lastUnlocked = unlocked[unlocked.length - 1] ?? 'orientation';
  const current =
    unlocked.find((id) => {
      const threshold = BY_ID.get(id)?.unlocksAt ?? 0.6;
      return (masteryByRung[id] ?? 0) < threshold;
    }) ?? lastUnlocked;

  return { topicId, masteryByRung, unlockedRungs: unlocked, currentRung: current };
}

export function isUnlocked(progress: TopicProgress, rung: RungId): boolean {
  return progress.unlockedRungs.includes(rung);
}

/**
 * Order concepts within a rung so prerequisites always come first
 * (topological sort, stable on the input order, cycle-tolerant).
 */
export function orderConcepts(concepts: Concept[]): Concept[] {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: Concept[] = [];

  const visit = (concept: Concept): void => {
    if (visited.has(concept.id) || visiting.has(concept.id)) return;
    visiting.add(concept.id);
    for (const prerequisiteId of concept.prerequisites) {
      const prerequisite = byId.get(prerequisiteId);
      if (prerequisite) visit(prerequisite);
    }
    visiting.delete(concept.id);
    visited.add(concept.id);
    ordered.push(concept);
  };

  for (const concept of concepts) visit(concept);
  return ordered;
}
