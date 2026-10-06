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

`dist/` contains the built static export and SHA-256 manifest. It calls same-origin `/api`; opening the HTML alone or putting it on IPFS does not provide saves or game authority. `deploy/compose.yaml` is an optional local-only container appliance with a persistent volume. Docker was unavailable in this worker, so that manifest was not executed.

## Check

```sh
forge build
forge test
forge fmt --check
node --test test/*.test.mjs
node scripts/evidence.mjs
```

`scripts/check.sh` runs build, tests, formatting and static export. All required dependencies are already ordinary repository files or runtime built-ins. Tests require no environment variables or network. The local contract script is a simulation with explicit role arguments and **no broadcast**:

```sh
forge script contracts/script/DeployLocal.s.sol
```

## What is delivered

- Existing procedural combat, branching quests, recurring cast, class/tag synergies, curses, equipment, individual routes and extended sessions; added power/stat splicing with real inventory and gold costs.
- Server-authoritative revisioned actions, idempotent retries, persistent recovery, SIWE-style EOA authentication, rankings, inventory, purchase confirmations, simulated rewards and batched contract claims.
- One-time token issuance, exact 20% pool / 10% swarm / 70% reserve fixture allocation; separate prize reserve and capped operation treasury; burn/recycle shop sink; asynchronous VRF consumer with authenticated fulfillment and immutable eligibility commitment.
- Durable content creation, schema validation, bot testing, publication, rollback, free fallback, isolated payment interface, keeper, backups, status and outage recording. The local validator is **not** an independent external reviewer.
- Static export, recovery CLI, local container manifest, reproducible evidence and [launch gates](deploy/launch-gates.json).

Read [the review and open defects](docs/review.md), [launch readiness and costs](docs/launch-readiness.md), [deployment/authority plan](docs/launch-plan.md), [operating rules](docs/operations.md), [game rules](docs/game.md) and [architecture](docs/architecture.md).

Public GitHub publication and independent contributor sign-off are still outstanding. No authenticated publishing capability was supplied, and this assignment forbids writing `.git/`. Source is delivered in this working tree for the IMD publisher; no public URL is claimed. The project is useful for local play and review, but **not ready to operate with real funds**.

`python3 scripts/package-source.py` reproduces the [offline source handoff](artifacts/dcp-source.tar.gz), including the existing Foundry dependency sources, tests, ABI files and static export. It excludes runtime data, credentials, `.git`, `.github`, installed package directories and scratch tests.
