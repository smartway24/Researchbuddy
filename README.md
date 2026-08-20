# Researchbuddy

A self-education tool for medicine and the life sciences.

You name a topic — "ECMO", "cardiac preload", "sepsis" — and Researchbuddy builds the
path: fundamentals first, the concepts that surround it, then the current research,
organised and ordered for you. You do no searching, no filtering, and no sorting.

> Researchbuddy is a study tool. It is not clinical decision support, and nothing in
> it is advice about the care of a particular patient.

## The idea

Learning a topic from the literature fails in a specific way: search returns 30,000
papers sorted by nothing you care about, and the useful ones assume knowledge you do
not have yet. Researchbuddy fixes the order of operations.

**The ladder.** Every topic is split into six rungs — Orientation, Foundations,
Mechanism, Applied practice, Evidence base, Frontier. Each rung has its own kind of
reading: reviews and physiology at the bottom, trials and guidelines in the middle,
the last two years at the top. A rung unlocks when your recall of the one below it
holds up, so frontier papers never arrive before you can read them critically.

**Canonicalisation.** You type "ECMO"; the app resolves it against MeSH to
*Extracorporeal Membrane Oxygenation*, keeps NLM's definition, and searches on the
descriptor plus its entry terms. Precise queries, for free, from what you typed.

**The concept neighbourhood.** The "flurry of ideas around the concept" is derived
from data, not guessed: MeSH indexing on the papers a topic returns is a hand-curated
map of what that topic is about. Counting co-occurring descriptors and dropping the
ones that are everywhere gives you the real neighbours — for ECMO: *Respiration,
Artificial*; *ARDS*; *Cannula*; *Heart Arrest*; *Patient Selection*.

**Ranked, themed, explained.** Papers are classified by evidence level, scored against
the rung you are on, grouped into themes, and put in reading order. Every paper shows
*why* it is on the list. Ranking you cannot see is worse than no ranking.

**Recall that means something.** Cards are generated from what you read and scheduled
with SM-2. Mastery per rung is the mean retention strength of that rung's cards, and
mastery is what unlocks the next rung.

## What is here

```
packages/core/    Platform-agnostic domain logic. No React, no I/O assumptions.
apps/mobile/      Expo / React Native app, built for the iOS App Store.
```

`@researchbuddy/core` is the whole product minus the screens:

| Module | What it does |
|---|---|
| `ladder.ts` | The six rungs, unlock gating, concept ordering |
| `srs.ts` | SM-2 scheduling, due queues, per-rung mastery |
| `query.ts` | Topic → the right PubMed query for each rung |
| `rank.ts` | Evidence classification and rung-aware scoring, with reasons |
| `concepts.ts` | Concept neighbourhood and theming from MeSH co-occurrence |
| `digest.ts` | Retrieved papers → a themed, ordered reading list |
| `sources/` | PubMed, Europe PMC, MeSH lookup, institutional access, dedupe |
| `ai/` | Optional model layer, with an extractive on-device default |

## Data sources

**Public, and enough on their own.** PubMed (NCBI E-utilities) and Europe PMC, queried
in parallel and merged — a source that fails is reported, not fatal. No API key is
required; an NCBI key just raises the rate limit. Europe PMC also reports open-access
full text, which is what makes "just let me read it" work with no login at all.

**Your library.** Add your institution's EZproxy prefix or OpenAthens redirector in
Settings and paywalled papers open through your own library login, in a browser
session you control — the same thing a library's "find it @ my institution" button
does. Free full text is always offered first, the proxy link second, the publisher
page last.

Two things Researchbuddy deliberately does not do: it never stores or replays your
library credentials, and it never fetches, caches, or re-hosts anything behind a
paywall. It links to what you are entitled to; it does not redistribute it.

*Searching inside* licensed databases (Embase, Scopus, Ovid, Web of Science) needs a
licensed API key issued to your institution. The source layer is a pluggable adapter
interface built for exactly that — see "Not built yet".

## AI

Optional, and off by default. Retrieval, ranking, theming, and scheduling are all
deterministic, so the app is fully functional with no model and no account:
summaries and cards are extracted on-device from structured abstracts, which in
medicine are unusually well-labelled.

Turning on Claude (your own API key, stored in the iOS keychain) gets you written
summaries and better cards instead. Only a paper's title and abstract are sent;
nothing about your deck, progress, or notes leaves the device, and every model call
falls back to the extractive path on failure.

One honest limitation: an app cannot log in to a consumer Claude or ChatGPT
subscription the way a Chrome or Excel add-in does — those subscriptions have no
third-party app authorisation for this. The supported routes are your own API key, or
nothing.

## Running it

```bash
npm install
npm run build            # build @researchbuddy/core
npm test                 # 81 tests, all offline against fixtures
npm run test:live -w @researchbuddy/core   # also hits the real PubMed / Europe PMC APIs

cd apps/mobile
npx expo start           # then press i for the iOS simulator
```

For a device build or a TestFlight/App Store submission, use EAS (`eas build -p ios`),
which needs an Apple Developer account and a Mac or EAS's build servers.

## Not built yet

- **Licensed database adapters** (Embase, Scopus, Ovid). The `SourceAdapter`
  interface and the federated search already accommodate them; each needs its
  institution-issued API credentials.
- **On-device model.** A small local model for summaries would remove the
  API-key tradeoff entirely. The `AiProvider` interface is the seam for it.
- **Concept prerequisites across topics.** Concepts carry a `prerequisites` field
  and are ordered topologically, but nothing yet links a concept in one topic to
  its foundation in another.
- **Sync and backup.** Everything is local; Settings exports plain JSON.
