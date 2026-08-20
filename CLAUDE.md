# Working on Researchbuddy

## Layout

- `packages/core` — all domain logic. TypeScript, ESM, strict. Relative imports carry
  the `.js` extension because this package compiles to real ESM.
- `apps/mobile` — Expo app. Relative imports have **no** extension: Metro does not
  resolve `./x.js` to `./x.tsx`, and it will fail the bundle if you add one.

## Rules that matter here

- **Core stays platform-agnostic.** No React, no React Native, no direct storage
  access. If something needs a device API, it belongs in `apps/mobile`.
- **The app must work with no AI and no account.** Every model-backed path has a
  deterministic fallback, and the offline provider is the default.
- **Never surface a ranking without its reasons.** `ScoredPaper.reasons` is rendered
  in the UI; anything that changes scoring should say why in plain words.
- **Never fetch, cache, or re-host paywalled full text.** Access is link resolution
  only (`sources/access.ts`), and library credentials are never stored.
- **Cite everything.** Concepts and cards keep the paper ids they came from.

## Checks before pushing

```bash
npm run build                              # core must compile
npm test                                   # offline suite
npm run test:live -w @researchbuddy/core   # network suite, opt-in
cd apps/mobile && npx tsc --noEmit && npx expo export --platform ios --output-dir /tmp/x
```

`react-native` is pinned by a root `overrides` entry: Expo SDK 57's Metro config
requires `react-native/rn-get-polyfills`, which RN 0.87 removed. Without the pin, npm
hoists 0.87 for peer deps and every bundle fails.
