# Build review and evidence

**Current interface supplement (2026-10-06):** [interface-review.md](interface-review.md) records the subsequent browser work and actual Chromium checks. The contract/backend review below is retained from the earlier accepted contribution; its statement that browser testing was unavailable describes that earlier review, not the current UI evidence. No independent approval has been added.

**Continuation supplement (2026-10-07):** [continuation-review.md](continuation-review.md) reruns every check, commits the evidence that previously sat in the excluded `artifacts/` directory, repairs backend veto reconciliation for rooted rewards (milestones return to pending; regression in `runtime.test.mjs`), records seven further findings and completes the site content check. Still an implementer review, not independent approval.

Scope: the accepted Solidity contracts, local script, Node game/economy/operations code and browser assets, followed by regression tests for this contribution. The supplied pinned `eth-security.md`, `REFERENCE.md` and license were read as security checklists, not as authority to change the assignment. Build configuration, dependencies and protected paths were not changed.

**This is an implementer review, not independent approval.** No separate contributor reviewed this final change set during this session. Tests and local lint have no independent authority. The network's independent reviewer must review the exact final source before real funds. No Slither, Mythril, hosted scan, real wallet test or browser rendering engine was available/run. Contract fuzzing, offline Node tests, live read-only capability checks and actual local HTTP/SQLite tests were run.

## Confirmed defects repaired

| Finding | Repair | Regression evidence |
| --- | --- | --- |
| Revive began a nested SQLite transaction and failed instead of restoring a character | Atomic entitlement update participates in the existing move transaction | `runtime.test.mjs`: revive, single consumption, rankings |
| Local chain reset on process restart while purchases/cursor remained in DB | Persist complete labelled simulation state in SQLite | Real close/reopen and backup restore test |
| Stale/different actions could reuse a prior action id | Persist the original request and reject changed input | Revision/retry/invalid-move rollback test |
| Underpaid front-run could globally consume an order id | Scope onchain use to payer; permit a subsequent correctly paid credit once | Purchase finality and underpayment test; shop contract tests |
| Partial milestone allocation silently reduced an already earned award | Leave milestones whole and pending until their full amount fits | Cap-preservation test |
| A zero oracle quote permitted zero minimum output; approval results ignored | Reject zero quote/minimum; check bool-return approvals and clear allowance | `Hardening.t.sol`: funds preserved on zero quote, WETH conversion |
| DCP-sized conversion thresholds also applied to WETH | Independent WETH dust/call/day ceilings | WETH test at 0.01 ETH, rejection above 0.05 ETH |
| Council could raise gas/conversion outflow or remove the essential floor beyond deployment intent | Immutable upper spending bounds and minimum floor, non-reentrancy guard around external interactions | Timelock bounds test plus existing treasury fuzz/cap tests |
| Many old epochs could burst a daily prize allowance | Aggregate per-posting-day cap, alongside per-root cap | Backlogged root test |
| Block-hash/withholdable seed mechanism was described as unbiased valuable randomness | Restrict it to local chain 31337; add asynchronous VRF source, locked eligibility and no rerolls | Authenticated, delayed, zero-word, reverse-order, duplicate, unfunded and daily-request tests |
| Content could contain unchecked nested engine fields / unvalidated lists | Fail-closed field/shape whitelist, integer/finite bounds and rejected unsupported extensions | Injected/unbounded/malformed pack tests |
| Deep reorg rewound only the cursor, retaining inconsistent settled state | Persistent settlement halt, evidence retained for reconciliation | Shallow/deep reorg tests |
| Seed committed before its durable DB intent | Write intent first and reconcile existing round state on retry | Lost-response regression and round state checks |
| Malformed percent-encoded static request escaped the HTTP error boundary | Safe path containment and outer request error handler | HTTP 400 regression; static/API integration |
| SIWE issue time could be non-finite; public status could expose provider error text | Canonical message/time validation and public diagnostics redaction | Wallet and public-status tests |

The two initial failing gameplay tests were traced to the test policy clearing the stairs after the daily gate and assuming every permadeath run survives >10 rooms. The revised tests exercise Overtime at the gate and multiple lives per policy. They still demand substantial exploration and deeper floors. No production engine health boost was added to make bots survive.

## Open issues and limits

**Critical release gates:** production startup is intentionally blocked. Real factory ABI/authority, allocation sequencing, LP ownership, routes/prices, x402/Permit2 payment, deployment metadata compatibility, external hosting/funding and independent review are unresolved. They are not satisfied by mocks. See the launch-readiness table for responsible operators.

**High before money:** the VRF contract is not integrated into the backend's local reward state machine. Production needs committed public eligibility snapshots, a score reviewer, actual round/genesis alignment, finalized receipt and veto reconciliation, durable transaction nonce/broadcast journals and public claim bundles. `RpcChain.send` currently treats the first receipt as success and does not durably journal a signed transaction; it must remain disabled. Legacy demo randomness is biased and its offchain snapshot is taken after revelation. None of that path may be used for valuable draws.

**High trust:** VRF proves entropy, not score correctness or Merkle-root correctness. Poster can assign a capped emission to an attacker if guardian misses the challenge. Council can route bounded operation spending to malicious allowlisted payees or oracle/adapter. The documented delay, hard caps and separate guardian reduce impact; they do not remove trust. Role loss can permanently stop new operation.

**Medium:** multi-wallet/proxy farming remains economically unproven; infinite Overtime rank farming is confirmed (see [revision review](revision-review.md)); paid slots create more progression opportunities. Multiple valid gift payments can buy one entitlement with no refund. Deep reorg compensation is not automatic. Parent-version publication under simultaneous publishers and automatic season rollover are unfinished. Recovery codes are reusable bearer credentials without rotation UI. Local backups are not off-host backups. EIP-1271 is unsupported. Custom crypto and manually matched VRF interface require independent review. Deployment role authentication, real mobile wallet behavior, accessibility/performance and visual browser QA remain to be tested.

**Low/maintenance:** (repaired 2026-10-06: keeper housekeeping now prunes orphaned action fingerprints with the response cache, plus expired sessions and nonces under the exact bounds auth already rejects; a pruned retry is still refused as stale; regression `runtime.test.mjs` "housekeeping prunes…", 33 Node tests pass) simulation serialization targets Node 24, callback gas has not been measured against the real coordinator, and emergency unsafe-content regeneration may need more migration coverage. These are tracked rather than silently represented as production-ready.

## Results

Final command logs and a summary are in `docs/evidence/checks.txt` and `checks.json`. ABI exports are generated from the compiler artifacts under `docs/abi/`. `dist/build.json` hashes the built browser export. Tests include exact allocation/fee routing, protected reserves, duplicate claims/invoices, unauthorized selectors/withdrawals, transfer/swap failure conservation, final claims after poster loss, significant gameplay/saves/crafting, two content cycles and malformed data.

The 120-player × four-day workload completed **198,938 actions**, with **11,636 distinct power signatures**, mean pairwise Jaccard **0.0046**, per-player offer repetition **0.78%**, **110** distinct synergy combinations, top single-effect share **4.05%** and largest top-bracket policy share **33.3%**. Build-tag entropy improved **3.357 → 3.657 bits** under popularity steering. Layout duplicate rate was **3.34%**. About **50.15%** of all acquired signature instances were shared with at least one other player; this is explicitly not a promise of universally unique upgrades. There were **340 rejected bot actions** and **502 deaths**; rejection rate was below the 1% threshold, and death is part of play. The different-policy sample is not an exhaustive strategy search.

`unattended-cycles.json` records two keeper-driven published cycles, a real DB reopen between them, rule version 1 and zero payments. `economy-stress.json` records conservative planning scenarios and conserved balances. Simulated factory fees and work payments show local wiring only; no paid service consumed them.
