# Continuation review (2026-10-07)

This continues the accepted build after `adversarial_review` exhausted its attempts and `site_content_check` never ran. Nothing was rebuilt. The game design, DCP name, adult comic tone, procedural variety, contracts and frontend stack are unchanged. There was no deployment, minting, pool, paid service, live financial play or swarm submission. Every check here was run by this contributor. It is a second review pass, **not** independent sign-off or a launch approval. The NO-GO in [launch readiness](launch-readiness.md) still stands.

## 1. Existing checks, rerun

| Check | Command | Result | Evidence |
| --- | --- | --- | --- |
| Solidity build/tests | `forge build --offline`, `forge test --offline` | 41/41 pass | [contracts-check.txt](evidence/contracts-check.txt) |
| Second fuzz seed | `FOUNDRY_FUZZ_SEED=0x1234 FOUNDRY_FUZZ_RUNS=1024 forge test --offline` | 41/41 pass, 1,024 runs per fuzz test | same |
| Formatting | `forge fmt --check` | clean | same |
| Local deploy simulation | `forge script contracts/script/DeployLocal.s.sol --offline` (no broadcast) | ran, gas 8,256,141 | same |
| Node suite | `node --test test/*.test.mjs` | 34/34 pass. This is 33 inherited tests plus 1 new regression (§3) | [node-tests.txt](evidence/node-tests.txt) |
| Static export | `node scripts/build-web.mjs`, `node scripts/check-export.mjs` | 14 files, hashes match. Rebuild produced **no diff** against committed `dist/` | — |
| JS typecheck | `tsc -p web/tsconfig.json` (pinned tools from `web/package-lock.json`, installed outside the tree) | no diagnostics | — |
| Browser | `scripts/browser-check.mjs` (Playwright 1.58.2, Chromium 145, axe-core 4.10.3) | 8/8 flows pass. Axe found 0 violations; `color-contrast` was *incomplete* on onboarding/game. The only 4xx was the intentional wrong-code `/api/auth/recover` 404 | [browser-checks.json](evidence/browser-checks.json), [screenshots](evidence/browser/) |
| Evidence regeneration | `node scripts/evidence.mjs` | Variety and stress JSON came out byte-identical. Unattended cycles differed only in time-derived cycle IDs/timestamps, so the committed file was kept | [evidence/](evidence/) |
| Demo + recovery CLI | `scripts/demo.mjs` on a scratch DB, HTTP probes, then `scripts/recover.mjs` check/backup/restore | Covered in the smoke run | [demo-recovery-smoke.txt](evidence/demo-recovery-smoke.txt) |

**Environment notes (not project findings):**
- The first browser run failed with `chrome-headless-shell: error while loading shared libraries: libatk-1.0.so.0`. That was a missing system library in this worker. `npx playwright install-deps chromium` installed it, and the unchanged checker then passed.
- Docker is not installed here, so `deploy/compose.yaml` was still not executed.

## 2. Repaired: evidence links were broken in the delivered repository (Medium, reviewability)

**Cause.** `README.md`, `REVIEW.md`, `DESIGN.md`, `docs/interface-review.md` and `docs/launch-readiness.md` all linked to files under `artifacts/`. In the contributor workspace, `.git/info/exclude` lists `artifacts/`, so those files were never committed. None of the cited logs, screenshots or the source archive reached the repository.

**Reproduction.** Run `git check-ignore -v artifacts/node-tests.txt`. It prints `.git/info/exclude:4:artifacts/`.

**Fix.** The checks were rerun and their outputs committed under `docs/evidence/`. The links now point there. Historical statements about 2026-10-06 runs are kept and labelled as not delivered. The scripts still write their working output to `artifacts/` and were not changed. The source archive (`artifacts/dcp-source.tar.gz`) is now described as a local output; the repository itself is the source handoff.

## 3. Repaired: a guardian veto stranded earned milestone rewards (Medium, reward accounting)

**Scope.** `server/src/economy.js` handles a vetoed epoch. Before this fix it marked only the epoch as `vetoed`. Every reward row rooted in that epoch kept the status `rooted` with the dead root's proof, so:
- earned milestones were never re-offered to a later root (permanent loss to the player);
- `liabilities()` and `/api/status` reported them as outstanding liabilities forever.

The contract side was already right: `GameReserve.veto` releases `outstanding`.

**Reproduction.** In the new test `guardian veto returns earned milestones…` in `test/runtime.test.mjs`:
1. Reach depth 3.
2. Advance the epoch until the milestone is `rooted`.
3. Veto the round inside the window.
4. Advance past the window.

On the previous code, the reward stays `['rooted', 2]` across later epochs. The test fails without the fix (verified) and passes with it.

**Fix (8 lines, one transaction).** Milestone rows of the vetoed epoch return to `pending` with no epoch, leaf or proof. Remaining rooted rows of that epoch (top/draw) become `vetoed`. Milestones are re-rooted in a later epoch under the normal caps. Flagged or otherwise ineligible accounts are still filtered by `eligible()`.

## 4. Review findings recorded, not changed

Severity is relative to a future funded launch. Production mode is disabled in code (`server/src/main.js`, `createApp`), so none of these is reachable in the delivered demo.

| # | Severity | Area | Finding | Reproduction / basis | Recommendation |
| --- | --- | --- | --- | --- | --- |
| F1 | Medium | `OpsTreasury.convert` | Anyone can call it and pick `minOut`. A caller can set `minOut` exactly at `fair × (1 − slippageBps)` and sandwich their own call. They extract up to `slippageBps` of each conversion plus the bounty (`min(bounty, out/10)`). This is bounded by `convertPerCall`, `convertPerEpoch` and the WETH hard caps, and only allowed while IMD runway is below `replenishBelow`. | Code path `convert()` lines checking `minOut < fair*(10000-slippageBps)/10000`. No test, because it needs a real AMM. | Keep `MAX_SLIPPAGE_BPS` low at deployment, or restrict `convert` to the keeper with private submission. Requires fresh contract review. Not changed, because the contracts were accepted and source-only edits need re-audit. |
| F2 | Medium | Indexer / RPC mode | The cursor starts at block −1, so the first `eth_getLogs` spans block 0 to head in one call. Real providers reject such ranges. There is no deployment start block or chunking. | `Indexer.poll` and `RpcChain.getLogs`. Adds to the existing "RpcChain must remain disabled" item. | Configure the deploy block and page `getLogs` before enabling RPC mode. |
| F3 | Low | `GameReserve` | Each posted root's unclaimed remainder (`total − claimed`) stays in `outstanding` forever. That includes a total overstated against the leaf sum. Free balance and future emission shrink permanently, and the only control is a guardian veto inside the window. A veto also does not restore that day's posting allowance (already documented in [launch-plan](launch-plan.md)). | Code: no expiry/sweep path. | Publish root totals with leaf sums for guardian checking. Consider a reviewed expiry in a future migration. |
| F4 | Low | Payment retry (RPC mode) | Suppose a retry runs while the first `payWork` tx is still pending. `invoicePaid` is false, so the retry resends. It reverts with `DuplicateInvoice` and is classed as `deferred`, even though the payment succeeded. The ledger then misses `paid_work` and the cycle falls back to the free author. Funds are safe because the on-chain invoice guard holds. | `payInvoice` policy regex treats `DuplicateInvoice` as a refusal. | Treat `DuplicateInvoice` as "check `invoicePaid` then confirm". Belongs to the existing durable nonce/broadcast journal item. |
| F5 | Low | HTTP rate limiter | The per-IP token buckets are cleared wholesale at 50,000 keys. Keys are full addresses, so one IPv6 /64 can reset every limiter, including recovery and nonce. Recovery codes are 96-bit, so guessing stays infeasible. The impact is guest, nonce and sign-in spam. | `RateLimiter.take` in `server/src/app.js`. | Key IPv6 by /64 and evict LRU entries rather than clearing. |
| F6 | Info | Frontend wallet | `Wallet.pick()` uses the first EIP-6963 provider, so users with several wallets cannot choose. | `web/wallet.js`. | Add a provider chooser during mobile wallet QA (already outstanding). |
| F7 | Info | Docs | `server/src/main.js` references `deploy/env.example`, which does not exist. | `ls deploy`. | Add it when production configuration is designed. |

**Checked and found to hold (no change):**
- The token has fixed supply, no owner, mint or tax, and its constructor requires an exact total.
- Shop order use is scoped per payer, so a front-run cannot consume another buyer's order. Splits are immutable and match the site copy (30% burn, 50% reserve, 20% ops).
- Each reserve claim pays once to its leaf account and is bounded by root total. The daily posting cap holds.
- The VRF source accepts only the coordinator and one request per epoch, with no reroll.
- Treasury setters stay within immutable bounds. Payments require an allowlisted payee and a unique invoice.
- SIWE checks domain, URI, chain, expiry and canonical form, and uses single-use nonces bound to the address. A session's wallet field only affects display.
- Action IDs are idempotent. A changed retry is refused, and stale revisions return 409.
- A probe from another account gets 400 on both load and act. An unauthenticated act gets 401.
- Encoded traversal gets 404. Public status does not contain the guest recovery code.
- Recovery refuses overwrites and live-WAL restores.
- The content pipeline is fail-closed. Inherited tests cover injected, malformed and unbounded packs.

## 5. Site content check (previously never run)

The finished `dist/` copy was reviewed against the code. `web/` and `dist/` HTML/JS/CSS are byte-identical apart from the documented practice-module rewrite.
- **18+ gate:** the dialog opens first and traps focus. The adult comic tone is stated plainly: "R-rated comedy … non-graphic sexual jokes".
- **Money claims:** the copy says "No real-money gambling", "not an investment" and "no yield, return or service guarantee". The footer reads "Build & review · Not a launch". Practice mode states it cannot earn or claim DCP. The status view says mainnet launch remains blocked.
- **Factual claims match the code:**
  - shop split 30/50/20 matches `DeployLocal.s.sol` (`3_000, 5_000`) and `SimChain`;
  - depth gate `3 + 2 × day` matches `GameService.maxDepth`;
  - "top ten daily fame gains" matches `TOP_PRIZES.length`;
  - the revive leaderboard exclusion matches `leaderboard_ok = 0`;
  - "Automatic season rollover is not implemented" is accurate.
- **No contract addresses, external URLs, remote assets or third-party scripts:** the CSP is `default-src 'self'`.
- **Brand:** "Original world & cast. Not affiliated with any book, show or meme rights holder" is present.

**Result:** no copy correction was required. Limits:
- No legal review of the adult or prize wording.
- No human visual QA beyond the recorded screenshots.
- Axe colour-contrast results remain partly manual.

## 6. Remaining limitations (unchanged by this pass)

- Production integrations remain unbuilt or unverified: IMD factory ABI and authority, pool/LP, x402/Permit2 payment, VRF subscription, RPC signer journal, hosting, funding and operator provisioning (council, guardian, poster, payment signer). Each is listed with its owner in [launch readiness](launch-readiness.md) and [`deploy/launch-gates.json`](../deploy/launch-gates.json).
- Fixture content cycles and mocked payments show local wiring only. They are **not** proof of autonomous production operation.
- No independent external reviewer has signed off. Slither/Mythril, real wallets, Docker and fork tests were not run.
- Public GitHub publication is done by the IMD publisher from this tree, not by this worker. No new URL is claimed here.
- The speculative DCP companion-worker network was not introduced.
