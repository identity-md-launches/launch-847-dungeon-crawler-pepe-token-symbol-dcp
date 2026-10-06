# Launch readiness · 2026-10-06

**Decision: NO-GO for real funds or a production launch.** This order delivers a usable local game and review material. A static export and successful tests do not provide a funded, permanent backend, independent security approval or real factory compatibility.

## External facts checked read-only

[IMD documentation](https://imd.fun/docs/#paid-requests) describes 0.5 IMD requests, x402/Permit2 payment and EIP-712 quote approval. Its launch section describes single-sided seeding, a 10% swarm allocation, `poolBps`/`remainderTo`, and a 1.25% trade fee split 1% payer / 0.25% network. Those are documentation claims, not this project's deployed routing proof.

The [live capabilities endpoint](https://api.imd.fun/requests/capabilities) advertised Ethereum mainnet (1), `imd` and `eth` pairings, 18-decimal IMD and 500000000000000000 atomic units per request when checked. This is more current than the docs' Sepolia-only sentence. Snapshots with read-only provenance are in `docs/evidence/imd-capabilities.json` and `imd-version.json`; no quote or payment was submitted. Pair availability must still be confirmed by the later launch's pinned quote.

The exact `setRequester(uint64,address)`, `claimFees`, `withdraw`, LP ownership and factory post-deploy authority were **not** verified against deployed source or bytecode. No `.imd/reads/network.json` was supplied. No chain address from search results was installed into runtime or deployment parameters. Mock tests demonstrate the intended two-asset flow and one-time assignment only.

[Chainlink's VRF security guidance](https://docs.chain.link/vrf/v2-5/security) requires binding fulfillment to a request, preventing rerolls, freezing inputs before requests and safely handling asynchronous delivery. `VRFPrizeSource` implements those boundaries with an immutable coordinator and one result per epoch. Its ABI follows the [v2.5 request interface](https://docs.chain.link/vrf/v2-5/getting-started). Tests use a mock coordinator: they do not verify a real VRF proof. Coordinator code, gas lane, subscription authorization/funding, callback gas and finality need separate launch review.

## Funding: committed versus needed

| Resource | This build | Required before launch |
| --- | --- | --- |
| Cash | $0 committed/spent | Written hosting, backup, RPC, monitoring and operator quotes |
| IMD work | 0 IMD committed/spent | Observed unit price 0.5 IMD; an illustrative 60-run allocation costs exactly **30 IMD at that price**, subject to a fresh quote |
| Transaction gas | 0 ETH committed/spent | Measured deployment/operation gas × agreed gas-price cap plus failure margin; illustrative protected reserve **0.5 ETH**, not a bill estimate |
| VRF | No subscription created | Actual coordinator/subscription quote and funded balance; amount unknown |
| Pool pairing | No pair asset committed | Single-sided **200,000,000 DCP** seed; **no requester-funded IMD/ETH liquidity** |
| Swarm allocation | Local test fixture only | **100,000,000 DCP** via the supported distributor |
| Prize reserve | Local test fixture only | **700,000,000 DCP** received by GameReserve; not an operations budget |

A definitive all-in bootstrap price is **unavailable** because no provider quotes, deployed gas measurements, service payer or provisioning identity were supplied. Do not turn unknowns into zero. The 40 IMD/day essential-cost assumption in local runway displays and the stress model is an illustrative conservative unit budget, **not a provider price**. Gas, USD bills and IMD must be separately accounted for. Token allocation has no assumed liquid cash value. Any IMD network subsidy must be explicitly documented by its provider, including expiry and limits; none is assumed here.

## Release blockers and accountable operators

| Blocker | Evidence / consequence | Required holder of responsibility |
| --- | --- | --- |
| Independent adversarial sign-off | Implementer checks have no independent authority; no external review artifact is supplied | IMD must assign a separate reviewer; attach findings and reruns to the exact source hash |
| Public source publication | No GitHub URL produced; no authenticated publisher available in this session | IMD publisher uploads complete source and static artifact, records URL/commit; not a founder task |
| Token/factory sequencing | Local token constructor uses allocation arrays; platform token factory may require different constructor/ownership semantics. Reserve predicts local token address, not a supported mainnet factory sequence | IMD deployer verifies exact constructor support and `remainderTo` sequencing without changing supply/economics |
| Fee routing | Factory interface is task-derived; requester reassignment and both-asset collection only mocked | IMD deployer proves allowed initial assignment, fee claim and withdrawal at pinned fork block |
| LP control/liquidity | Fixture has virtual depth and factory-locked balances; no real pool position is measured | IMD pool operator records LP owner, lock/removal rights, fee recipient, actual assets, range and executable depth |
| Swaps and price source | No production adapter/TWAP implementation; interface and attack tests only | Finance operator supplies reviewed liquid routes, stale/observation/liquidity checks, asset-specific caps and minimum output |
| Paid work | `payWork` is a token transfer, not the Permit2/x402 signature flow; `SwarmAuthor` deliberately refuses external submission | Payment operator provisions isolated funded identity, exact bounded approvals, quote validation, durable request ids and payment reconciliation |
| Reward integration | Backend demo still uses legacy fixture epochs. VRF contract path needs frozen snapshot publication, score review, chain genesis alignment and finalized receipt/reorg reconciliation | Backend operator and guardian complete integration; test loss of RPC, key, callback and root veto before any valuable draw |
| Runtime provisioning | Docker is a local template; no host/DB/RPC/indexer/backups/failover was externally provisioned | Infrastructure operator supplies paid durable hosts, private backups, recovery drills, DNS/TLS and secondary operator |
| Essential funding | Treasury floor cannot itself pay hosting bills; it is deliberately protected from `payWork` | Infrastructure/finance operators arrange prepaid service runway and a reviewed bounded essential-payment route |
| Competitive abuse | Sybil heuristics, slot advantage, indefinite Overtime/fame farming and score-authority trust remain | Independent game/economy reviewer runs adversarial farm trials and approves prize eligibility limits |

Automatic season rollover, parties, generated quest schema v2, new engine primitives, EIP-1271 wallet authentication and full browser/device QA are also unfinished. They must not be advertised as delivered capabilities. Deep reorg recovery currently stops settlement for operator reconciliation rather than automatically repairing consumed entitlements. Production cannot be enabled simply by switching a flag.

## Stress evidence

`scripts/economy-stress.mjs` models zero volume, shallow liquidity, 90% price loss, 4× expenses, depleted prizes and no bootstrap budget. `docs/evidence/economy-stress.json` records assumptions and conservation. Unsupported conversions retain accumulated DCP, empty reserves produce no new prizes, operations precede modeled content/prizes, and no-bootstrap operation enters dormancy immediately. This is planning evidence, separate from contract tests; it is not a market forecast or a guarantee of revenue.

No other pool is assumed to route fees here. No wash trades, external pool seeding, exchange listing, token sales, paid schedules or hosting purchases were made. Test traffic is labelled simulated.
