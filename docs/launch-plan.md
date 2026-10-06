# Subsequent launch plan and deployment parameters

This is a supported **conditional plan**, not authorization to execute. The later reviewed launch must produce a live URL, publicly verified contracts/pool, funded services, external review and a recovery demonstration. `node scripts/check-launch.mjs` deliberately exits 2 with open gates. `deploy/launch-gates.json` is a readiness record, **not** a platform `launch.json` or a submission to an IMD deployer.

## Sequence

1. IMD assigns an independent reviewer of this source and the accepted earlier work. Resolve high findings and attach the exact checked source/artifact hashes. IMD's publisher publishes the full source and ABI files; no paid swarm work is opened by this build.
2. Infrastructure and finance operators obtain written hosting/RPC/backup/operator/VRF quotes, record total bootstrap funding and fund only constrained service accounts. Separate payer, guardian, poster and recovery holders must accept responsibilities. The requester is not asked to operate a PC, forward fees, keep signing, or manually configure vendor accounts.
3. IMD's deployer obtains a fresh policy/quote for mainnet, fixed 1 billion DCP, 18 decimals, 10% swarm, **20% pool / 70% remainder**. Prefer DCP/IMD; allow DCP/ETH only with a funded, tested conversion and gas plan. Here `20/10/70` means pool/swarm/reserve; the task's “10% swarm” is preserved. Reject a quote that uses 20% swarm or 80–90% liquidity. POOL4 is optional and not assumed.
4. Resolve reserve-before-token circularity using a platform-supported deterministic deployment or reviewed precomputed address plus supported `remainderTo`. The local CREATE prediction is not a factory promise. If `remainderTo` cannot reach the reserve, arrange exactly **one initially approved 700,000,000 DCP transfer** and verify the receipt. No continuing wallet forwarding, transfer tax or assumed key access.
5. Confirm authority to make the **initial** factory requester assignment to OpsTreasury. Verify actual ABI/auth/one-time semantics, then permissionlessly collect both assets into the treasury in a fork test and after the later authorized deployment. If the factory cannot call/set the requested contract, stop; do not silently route funds through the founder.
6. Deploy immutable game contracts under the approved sequence. Register/fund VRF consumer; configure bounded payees, signers, operators and verified route/oracle through the timelock. Record the actual code hashes and all role holders. Start with new awards/spending disabled until funded service checks pass. Existing final claims must remain callable during dormancy.
7. Provision durable backend and one active keeper; use finalized indexer cursors and persistent transaction journals. Provision isolated payment signer with no game data or reserve powers. Test the actual x402/Permit2 flow and schedule topups with per-invoice/epoch limits, expiry, exact payment recipient and request id validation. The onchain treasury transfer alone does not authorize paid HTTP work.
8. Run the full funded staging drill: two autonomous reviewed content cycles, restore onto a replacement host, keeper/payer loss, RPC outage, deep reorg policy, bad packs, empty budget, low depth, stale prices and claim recovery without web UI. Publish service/runway limits and operator assignments. Only then may the separate launch order enable real transactions and publish the live site.

IMD documentation currently describes imported launch repositories requiring `bytecode_hash = "none"`. The protected existing `foundry.toml` uses its default metadata setting. This assignment must not change it. If that check applies to the subsequent platform launch, the platform needs a separately authorized configuration adaptation and a new source review; do not claim this tree is already platform-deployable.

## Local contract parameters and trust

All token units below are 18-decimal base units (`ether` in Solidity for tokens). Verify real IMD/WETH decimals and standard ERC-20 bool-return behavior before assigning addresses. Fee-on-transfer and rebasing pair assets are not supported.

| Component | Local fixture setting | Who can change it |
| --- | --- | --- |
| DCPToken | Name Dungeon Crawler Pepe; symbol DCP; 1,000,000,000 × 10^18 constructor issuance; allocations sum exactly | Nobody; holders can burn their own tokens; no owner/mint/pause/upgrade |
| GameReserve | 700m DCP allocation; 1-day epochs; 0.1% free balance cap; 2m DCP absolute ceiling; 1-day challenge; 2-day role timelock | Immutable limits; council can timelock poster/role replacement and one-time randomness source binding |
| Reserve daily cap | Sum of roots posted that day cannot exceed its initial cap; per-root free-balance bound also applies | Immutable; veto does not restore that day's emission allowance |
| VRFPrizeSource | Immutable reserve/coordinator/gas lane/subscription; native billing; 150,000 callback gas; tests use 64 confirmations | No owner/withdrawal/provider replacement; coordinator/subscription values unverified for launch |
| Ops work | 1,000 IMD/day; 250/payment; 2,000/day immutable upper bound; 500 floor; halve cap below 3,000; replenish below 5,000 | Council within immutable bounds; signer spends only to approved payees with unique nonzero invoices |
| DCP conversions | 1m/call, 3m/day maximum; dust 10,000; buffer 5m | Council can reduce/reconfigure within deployment-fixed day ceiling |
| WETH conversions | 0.001 ETH dust; 0.05 ETH/call, 0.2 ETH/day, plus shared lower configured bounds | Constants cannot be raised |
| Output/gas | 3% slippage local; hard max 10%; 5 IMD bounty capped at 10% output and hard 20; 0.5 ETH protected from wrapping; 0.05 topup below 0.02 balance; 0.2/day hard maximum | Council within hard bounds; gas operator allowlist; guardian freezes work/conversion |
| Shop | 30% burn, 50% reserve recycle, 20% treasury; only test cosmetic/slot/revive orders | Immutable split; backend catalog is a content/commerce trust boundary |

Council and guardian should be different replaceable multisigs with distinct operators, not founder wallets. Proposed council is 2-of-3; no holders have been provisioned. A guardian can veto unfinalized prize roots or freeze treasury work/swaps, but cannot seize player rewards. Council can cancel/rotate roles after delay; loss of all council keys without a queued rotation is unrecoverable governance loss. Final claims remain, new operations may stop. Do not describe these roles as trustless.

Treasury's allowlisted payees and route/oracle setters give the council economically significant power within fixed caps. No proxy upgrades exist. Content publication cannot change these financial settings. New financial code requires a separately reviewed migration; content releases only update validated data. IMD internal publisher/deployer, factory-policy administration and service credential provisioning are external IMD/operator responsibilities, not authority this game grants itself.
