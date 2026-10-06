# Dungeon Crawler Pepe · DCP

Runnable build-and-review delivery, **not a launch**. Original adult comedy dungeon game, fixed-supply token contracts, authoritative Node/SQLite backend, browser frontend and local operating loop. No real token, pool, wallet funding, paid work, subscription or production site was created. Production startup is disabled in code.

## Run locally

Prerequisites: Node **24+** (tested 24.21.0) and Foundry with the existing pinned Solidity **0.8.26** configuration. No npm install, Python package, API key, RPC or wallet is required.

```sh
node scripts/build-web.mjs
node scripts/demo.mjs
```

Open **http://127.0.0.1:8787**. Accept the adult-content notice, create a Crawler, choose a perk and follow the map. Saves persist in `data/demo.sqlite`. The guest recovery code permits another browser/device to recover the same account; treat it like a password. It is never included in public status or content prompts.

In Rewards & Shop, link the **simulated** wallet, create an order and pay with test DCP. The keeper advances confirmations every 15 seconds. Status exposes the simulated day-advance button for exercising epochs and future content. Ordinary play has no time cap, wallet transaction or AI call. After the day's floor gate, Overtime generates further routes. These controls and test balances have no real value.

`dist/` contains the built static export and SHA-256 manifest. Integrated mode calls same-origin `/api`; a static host also offers explicitly separate browser practice, but does not provide authoritative saves or game authority. `deploy/compose.yaml` is an optional local-only container appliance with a persistent volume. Docker was unavailable in this worker, so that manifest was not executed.

## Check

```sh
forge build --offline
forge test --offline
forge fmt --check
node --test test/*.test.mjs
node scripts/evidence.mjs
```

`scripts/check.sh` runs build, tests, formatting and static export. All required dependencies are already ordinary repository files or runtime built-ins. Tests require no environment variables or network. The local contract script is a simulation with explicit role arguments and **no broadcast**:

```sh
forge script contracts/script/DeployLocal.s.sol --offline
```

## What is delivered

- Existing procedural combat, branching quests, recurring cast, class/tag synergies, curses, equipment, individual routes and extended sessions; added power/stat splicing with real inventory and gold costs.
- Server-authoritative revisioned actions, idempotent retries, persistent recovery, SIWE-style EOA authentication, rankings, inventory, purchase confirmations, simulated rewards and batched contract claims.
- One-time token issuance, exact 20% pool / 10% swarm / 70% reserve fixture allocation; separate prize reserve and capped operation treasury; burn/recycle shop sink; asynchronous VRF consumer with authenticated fulfillment and immutable eligibility commitment.
- Durable content creation, schema validation, bot testing, publication, rollback, free fallback, isolated payment interface, keeper, backups, status and outage recording. The local validator is **not** an independent external reviewer.
- Static export, recovery CLI, local container manifest, reproducible evidence and [launch gates](deploy/launch-gates.json).

Read [the review and open defects](docs/review.md), [launch readiness and costs](docs/launch-readiness.md), [deployment/authority plan](docs/launch-plan.md), [operating rules](docs/operations.md), [game rules](docs/game.md) and [architecture](docs/architecture.md).

Public GitHub publication and independent contributor sign-off are still outstanding. GitHub CLI reported no authenticated hosts, and this assignment forbids writing `.git/`. Source is delivered in this working tree for the IMD publisher; no public URL is claimed. The project is useful for local play and review, but **not ready to operate with real funds**.

`python3 scripts/package-source.py` reproduces the [offline source handoff](artifacts/dcp-source.tar.gz), including the existing Foundry dependency sources, tests, ABI files and static export. It excludes runtime data, credentials, `.git`, `.github`, installed package directories and scratch tests.

## Browser interface and static practice (this contribution)

The accepted vanilla JavaScript stack is retained. The finished export includes a responsive original dungeon illustration, class selection, keyboard-accessible encounters/maps/feed, explicit recovery and error states, rankings, shop and operations views. `DESIGN.md` documents the actual tokens and components. See [the six-domain interface review](docs/interface-review.md) for findings, fixes and remaining coverage limits.

For a static preview, no install is needed:

```sh
node scripts/build-web.mjs
python3 -m http.server 8080 --directory dist
```

Open `http://127.0.0.1:8080/`, confirm adulthood, then choose **Play browser practice** when no backend is present. Choose a class, name the Crawler, take a perk and follow the gold-outlined route nodes. Browser practice uses the existing engine with separate device storage and has no wallet, purchases, claims or competitive rewards. Refresh resumes the same run. It never overwrites or imports into a server save. **Use server** leaves practice mode; the practice ledger is retained. Use HTTP localhost or HTTPS, not a `file:` URL, for browser modules and secure-context APIs.

For the integrated demo, use Node 24+ and `node scripts/demo.mjs` as above. Choose **Use simulated demo wallet** in Loot & shop, create an order, **Pay (simulated)**, then **Refresh orders** after the keeper advances finality. Recovery codes restore server accounts across browsers; protect the code like a password. All financial controls remain fixtures.

### Install checking tools and rebuild

The frontend runtime and build have no npm dependencies. The new frontend-only manifest/lockfile pins development checking tools; the existing Foundry build configuration and dependencies are untouched.

```sh
npm ci --prefix web
npm run build --prefix web
npm run typecheck --prefix web
node --test test/*.test.mjs
npm exec --prefix web -- playwright install chromium
npm run check:browser --prefix web
```

The production build is the deterministic public allowlist copy in `scripts/build-web.mjs`; there is no Vite migration, remote asset fetch or runtime bundle dependency. Build can run offline without npm installation. Checking tools install from the lockfile; repeat installation offline requires your normal npm cache. Do not commit installed dependencies, browser downloads or caches. Browser checks can use provisioned tooling with `DCP_PLAYWRIGHT_MODULE`, `DCP_CHROMIUM_PATH` and `DCP_AXE_PATH` pointing to local installed files. The checker creates ephemeral local servers/SQLite state and writes evidence under `artifacts/`.

Actual results on 2026-10-06: production export and JavaScript typecheck passed; **32 Node tests** and **41 offline Solidity tests** passed, including a second 1,024-run fuzz seed. The 120-player/four-day simulation and two durable unattended content cycles passed. Chromium validated the static subpath and integrated purchase/recovery flows at desktop/mobile widths; sampled axe audits reported no violations, with some contrast checks requiring manual interpretation. Logs/screenshots and exact limits are in [the interface review](docs/interface-review.md) and `artifacts/`.

### Source publication and later site publication

This order does **not** authorize a live production site. The IMD source publisher should publish the complete source, `web/package.json`, `web/package-lock.json`, `DESIGN.md`, docs/tests/contracts and the finished `dist/` together to the assigned public GitHub repository, recording its URL and exact commit in the handoff. This worker cannot do that: GitHub CLI has no authenticated account and `.git/` writes are prohibited. No public repository URL is claimed. `scripts/package-source.py` supplies a credential-free source archive for that publisher.

At a separately reviewed launch, the operator may serve the contents of `dist/` below any static subpath (relative asset URLs and hash navigation need no route rewrite). The authoritative runtime still needs a funded same-origin `/api`, database, keeper, backups and the integrations listed in `deploy/launch-gates.json`; static hosting supplies only practice if no API is present. Before enabling real assets, attach independent review, verified contracts/pool, funded services and a recovery drill. Never infer launch readiness from a successful static build.
