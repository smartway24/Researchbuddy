# Working on Researchbuddy

## Layout

- `packages/core` — all domain logic. TypeScript, ESM, strict. Relative imports carry
  the `.js` extension because this package compiles to real ESM.
- `apps/mobile` — Expo app. Relative imports have **no** extension: Metro does not
  resolve `./x.js` to `./x.tsx`, and it will fail the bundle if you add one.

## Rules that matter here

- **Core stays platform-agnostic.** No React, no React Native, no direct storage
  access. If something needs a device API, it belongs in `apps/mobile`.
- **The app must work with no AI, no account, and no network.** Every model-backed
  path has a deterministic fallback, and every screen renders from cache first.
- **Never surface a ranking without its reasons.** `ScoredPaper.reasons` is rendered
  in the UI; anything that changes scoring should say why in plain words.
- **Never fetch, cache, or re-host paywalled full text.** Access is link resolution
  only (`sources/access.ts`), and library credentials are never stored.
- **Cite everything.** Concepts and cards keep the paper ids they came from. Never
  paraphrase a study without linking the record it came from — that traceability is
  the mitigation for App Review guideline 1.4.1, not a nicety.
- **No permissions.** The app declares none, and that is an asset: every string you
  do not declare is a question App Review does not ask. Adding one means a new build,
  not an update.

## Checks before pushing

```bash
npm run verify   # typecheck (both workspaces) + lint + tests
npm run build    # core must compile before the app typechecks against it
npm run test:live -w @researchbuddy/core   # network suite, opt-in

cd apps/mobile && EXPO_OFFLINE=1 CI=1 npx expo export --platform ios --output-dir /tmp/x
```

## This sandbox needs two env vars for every Expo command

```bash
EXPO_OFFLINE=1 CI=1 npx expo export --platform ios ...
```

`EXPO_OFFLINE=1` because the agent proxy blocks Expo's version-check host, and
without it the export dies inside `getNativeModuleVersions` with a JSON parse error
that never mentions the real cause. `CI=1` silences the interactive prompt path.
Web is fully configured (`react-native-web` is installed and `web.bundler` is set),
so `--platform` is optional here — but pass it anyway to keep exports fast.

## Dependencies

Install every Expo-adjacent package with `npx expo install <pkg>`, never
`npm install <pkg>`. `npx expo install --check` reports drift. If you find yourself
typing a version number for an `expo-*` or `react-native-*` package, stop.

The one exception is the root `overrides` entry pinning `react-native`: Expo SDK 57's
Metro config requires `react-native/rn-get-polyfills`, which RN 0.87 removed. Without
the pin, npm hoists 0.87 to satisfy peer ranges and every bundle fails.

## Releasing

Credentials live on EAS, not on disk. No Mac and no Xcode are involved.

```bash
npm run verify
cd apps/mobile
EXPO_TOKEN=<token> npx eas-cli@latest build \
  --platform ios --profile production --non-interactive --auto-submit
```

- `production` is the TestFlight profile. It has no `distribution` key, so it
  defaults to `store` and produces an App Store-signed `.ipa`.
- Build numbers are remote (`cli.appVersionSource: "remote"` + `autoIncrement`).
  Nothing to bump by hand. `version` in `app.json` is the marketing version and is
  bumped deliberately.
- `runtimeVersion` is `{"policy": "fingerprint"}`, set before the first build. Do not
  change it to `sdkVersion`: switching policies silently orphans every binary built
  under the old one.
- Before the first build, two placeholders in `apps/mobile/eas.json` must be filled:
  `submit.production.ios.ascAppId` and `appleTeamId`. Without them,
  `eas submit --non-interactive` stops dead with a finished build and nowhere to put
  it. `npx eas init` writes the project id and owner into `app.json`.

**Update vs build.** JavaScript changes ship over the air in about two minutes; a
build is only needed when the binary changes — a native module, a permission string,
an `Info.plist` key, the icon, the app name, an SDK bump. A TestFlight binary listens
on the channel its build profile declared (`production`), so publish there or your
testers never see the fix.

```bash
EXPO_OFFLINE=1 CI=1 EXPO_TOKEN=<token> npx eas-cli@latest update \
  --branch preview --platform ios --message "<what changed>"
```

**Before the first build**, decide every native capability you will want for the next
few months and enable them at Apple _first_, then regenerate the provisioning
profile — a profile snapshots capabilities at creation time, so regenerating first
achieves nothing. Adding a native module later invalidates signing, not just the
build.

## Assets

`apps/mobile/assets/*.png` are generated, not hand-drawn:

```bash
cd apps/mobile && npm run assets
```

Edit `scripts/generate-assets.mjs` and re-run rather than editing the PNGs, so the
geometry stays recoverable.
