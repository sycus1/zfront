# zfront

zfront is a browser game in the style of OpenFront, reworked into base building and tower defence against waves of zombie hordes. It plays on real-world maps, starting with England. Terrain decides where the hordes can go, and the biggest weapons can change the terrain.

Domain: [zfront.app](https://zfront.app) · **Status:** pre-alpha. The repo is a fresh fork of OpenFront, and the first technical spike is being planned.

> zfront is an independent fork of [OpenFront](https://github.com/openfrontio/OpenFrontIO), which is itself a fork and rewrite of [WarFront.io](https://github.com/WarFrontIO). It is **not** affiliated with or endorsed by OpenFront Inc.

## Docs

- [Research findings](docs/zfront/research.md): an OpenFront teardown, licensing, Cloudflare hosting, and genre mechanics
- [Draft requirements](docs/zfront/requirements-draft.md): the core loop, MVP scope, mechanics catalogue and open decisions
- [Technical spike plan](docs/zfront/spike-plan.md): the go/no-go experiment for horde simulation on the OpenFront engine
- Upstream engine docs: [Architecture](docs/Architecture.md), [Maps](docs/Maps.md)

## Licence

- **Code:** [GNU AGPL v3.0](LICENSE), including OpenFront's Section 7 additional terms. Anyone who plays zfront over the network must be offered the source of the exact version they're playing.
- **Required notice:** "© OpenFront and Contributors" must stay visible in the footer and on the loading screen.
- **Assets** in `/resources`: [CC BY-SA 4.0](LICENSE-ASSETS), with attribution to "OpenFront". OpenFront's proprietary assets (`/proprietary`) have been removed from this fork and must not be re-added.
- **History:** see [LICENSING.md](LICENSING.md).

## Prerequisites

- [Node.js](https://nodejs.org/) 24.15 or newer, in the 24.x line
- npm 12.1 or newer, in the 12.x line. Run `npm install --global --ignore-scripts npm@12.1.0`, or prefix commands with `npx -y npm@12.1.0`.
- [Go](https://go.dev/doc/install), only needed to regenerate maps (`npm run gen-maps`)

## Develop

```bash
npm run inst   # npm ci --ignore-scripts. Don't use npm install.
npm run dev    # client and server with hot reload
npm test
npm run typecheck
npm run lint
npm run format
```

## Upstream

`upstream` points at `openfrontio/OpenFrontIO` and is fetch-only. zfront is a hard fork, so upstream fixes are cherry-picked selectively rather than merged. Never open pull requests against upstream from this repo.

## Project structure

- `/packages/engine`: the deterministic simulation (runs in a Web Worker)
- `/packages/engine-api`, `/packages/engine-lib`, `/packages/shared`, `/packages/zbin`: engine contract, map grid and rules, shared client/server code, wire format
- `/src/client`: WebGL renderer and Lit UI
- `/src/server`: lobby and intent relay (Node)
- `/map-generator`: converts PNG to map binaries (Go)
- `/resources`: static assets and generated maps
