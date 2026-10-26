# Contributing to zfront

zfront is a base-builder and tower-defence game against zombie hordes, played on real terrain in the browser. It is a hard fork of [OpenFront](https://github.com/openfrontio/OpenFrontIO) and builds on its deterministic engine and WebGL renderer.

Start with the design docs in [`docs/zfront/`](docs/zfront/): `research.md`, `requirements-draft.md` and `spike-plan.md`.

## Ground rules

- **Licence.** zfront is AGPL-3.0 with OpenFront's Section 7 terms (see `LICENSE` and `LICENSE-ASSETS`). Keep "© OpenFront and Contributors" visible in-game. Never add OpenFront's proprietary assets or branding.
- **Upstream.** `origin` is `sycus1/zfront`. `upstream` (`openfrontio/OpenFrontIO`) is fetch-only: never open PRs or issues there.
- **New gameplay code** goes in clearly named modules (for example `packages/engine/src/horde/`) rather than being spread through OpenFront files, so cherry-picking from upstream stays possible.
- **Determinism.** The engine runs on every client and must stay bit-identical. Use the seeded PRNG and `packages/engine-lib/src/DetMath.ts`, never `Math.random`, `Date.now` or the approximated `Math` functions. Oxlint enforces this.
- **Tests.** Every change to `packages/engine`, `packages/engine-api` or `packages/engine-lib` needs tests. Test the simulation directly with `tests/util/Setup.ts` rather than with mocks.
- **Text.** All user-visible text goes through `translateText()` with an entry in `resources/lang/en.json`. Don't edit the other translation files.

## Getting started

### Prerequisites

- Node.js 24.15.0 or newer in the Node 24 line.
- npm 12.1.0 or newer. If Node bundled an older one, run `npm install --global --ignore-scripts npm@12.1.0` first.
- Go, only if you regenerate maps (`npm run gen-maps`).
- A browser with WebGL2.
- For editor support, the [TypeScript 7 native preview extension](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview) in VS Code.

### Install and run

```bash
git clone https://github.com/sycus1/zfront.git
cd zfront
npm run inst   # npm ci --ignore-scripts; do NOT use npm install
npm run dev    # client and server with hot reload
```

Dependency releases must be at least seven days old. Git, URL, tarball and directory dependencies are rejected.

## Workflow

1. Branch from `main` (`feature/…` or `fix/…`).
2. Keep each PR to one change, with tests and, for UI changes, a screenshot.
3. Before pushing, run:

   ```bash
   npm run format
   npm run lint
   npm run typecheck
   npm test
   ```

4. Commit messages are in the present tense ("Add wall unit", not "Added wall unit").

## Architecture

See [`CLAUDE.md`](CLAUDE.md) and [`docs/Architecture.md`](docs/Architecture.md) for the package layout (`engine-api`, `engine-lib`, `engine`, `shared`, `zbin`), the import rules that `tests/LayerBoundaries.test.ts` enforces, and the intent → execution flow.

## Maps

Map sources live in `map-generator/assets/maps/<map>/` (an `image.png` plus `info.json`). `npm run gen-maps` builds `resources/maps/`, `Maps.gen.ts` and the map names in `en.json`. zfront currently ships only Britannia; an England map from OS Terrain 50 is planned.
