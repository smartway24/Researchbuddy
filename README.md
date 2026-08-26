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
_Extracorporeal Membrane Oxygenation_, keeps NLM's definition, and searches on the
descriptor plus its entry terms. Precise queries, for free, from what you typed.

**The concept neighbourhood.** The "flurry of ideas around the concept" is derived
from data, not guessed: MeSH indexing on the papers a topic returns is a hand-curated
map of what that topic is about. Counting co-occurring descriptors and dropping the
ones that are everywhere gives you the real neighbours — for ECMO: _Respiration,
Artificial_; _ARDS_; _Cannula_; _Heart Arrest_; _Patient Selection_.

**Ranked, themed, explained.** Papers are classified by evidence level, scored against
the rung you are on, grouped into themes, and put in reading order. Every paper shows
_why_ it is on the list. Ranking you cannot see is worse than no ranking.

**Recall that means something.** Cards are generated from what you read and scheduled
with SM-2. Mastery per rung is the mean retention strength of that rung's cards, and
mastery is what unlocks the next rung.

## No server

There is no backend, and there is nothing to deploy, operate, or pay for. No
accounts, no sign-in, no telemetry, no analytics SDK. The only hosts the app ever
contacts are NCBI, Europe PMC, and — if you turn it on with your own key — the
Anthropic API. It talks to them directly from the device.

The two things that usually force a project like this to grow a server are rate
limits and offline reading. Both are handled on the device instead: searches are
cached locally, so a repeat search costs no request and stays inside PubMed's
limits, and when the network is gone a stale copy is served rather than an error.
Because ranking, theming, and scheduling are pure functions over cached papers, a
cached search is enough to rebuild an entire reading list with no signal — verified
by cutting the network and reloading the app from scratch: the full themed list
comes back, labelled with how old it is, with zero requests.

Your topics, cards, and review history never leave the device. Settings exports the
lot as plain JSON.

## What is here

```
packages/core/    Platform-agnostic domain logic. No React, no I/O assumptions.
apps/mobile/      Expo / React Native app, built for the iOS App Store.
```

`@researchbuddy/core` is the whole product minus the screens:

| Module        | What it does                                                    |
| ------------- | --------------------------------------------------------------- |
| `ladder.ts`   | The six rungs, unlock gating, concept ordering                  |
| `srs.ts`      | SM-2 scheduling, due queues, per-rung mastery                   |
| `query.ts`    | Topic → the right PubMed query for each rung                    |
| `rank.ts`     | Evidence classification and rung-aware scoring, with reasons    |
| `concepts.ts` | Concept neighbourhood and theming from MeSH co-occurrence       |
| `digest.ts`   | Retrieved papers → a themed, ordered reading list               |
| `sources/`    | PubMed, Europe PMC, MeSH lookup, institutional access, dedupe   |
| `cache.ts`    | On-device TTL cache and source wrapper; what replaces a backend |
| `ai/`         | Optional model layer, with an extractive on-device default      |

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

_Searching inside_ licensed databases (Embase, Scopus, Ovid, Web of Science) needs a
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
npm test                 # 91 tests, all offline against fixtures
npm run test:live -w @researchbuddy/core   # also hits the real PubMed / Europe PMC APIs

cd apps/mobile
npx expo start           # press i for the iOS Simulator, or scan the QR with Expo Go
npx expo run:ios --device  # or straight onto a real iPhone over a cable
```

`npm run verify` runs typecheck, lint, and tests together — that is the gate before
anything is published.

## Releasing

Credentials live on EAS, and builds run on EAS's machines — a Mac is handy for
the Simulator but is not part of the release path.

```bash
npm run verify
cd apps/mobile
EXPO_TOKEN=<token> npx eas-cli@latest build \
  --platform ios --profile production --non-interactive --auto-submit
```

Build numbers are remote and auto-incremented; `version` in `app.json` is the
marketing version and is bumped by hand. `runtimeVersion` is on the `fingerprint`
policy from the first build, so an over-the-air update can never reach a binary
that lacks the native code it needs.

Two placeholders in `apps/mobile/eas.json` must be filled before the first build —
`submit.production.ios.ascAppId` and `appleTeamId` — or a finished build has nowhere
to go. `npx eas init` writes the project id.

JavaScript changes ship over the air in about two minutes; a build is only needed
when the binary changes. See `CLAUDE.md` for the full workflow.

## Not built yet

- **Licensed database adapters** (Embase, Scopus, Ovid). The `SourceAdapter`
  interface and the federated search already accommodate them; each needs its
  institution-issued API credentials.
- **On-device model.** A small local model for summaries would remove the
  API-key tradeoff entirely. The `AiProvider` interface is the seam for it.
- **Concept prerequisites across topics.** Concepts carry a `prerequisites` field
  and are ordered topologically, but nothing yet links a concept in one topic to
  its foundation in another.
- **Sync and backup.** Everything is local; Settings exports plain JSON. Any
  future sync should stay serverless — a file in the user's own iCloud Drive,
  not a service.
