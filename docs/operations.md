# Operating rules and recovery

## Local demonstration

The demo uses one Node process, SQLite WAL, persisted simulated chain state and one non-overlapping keeper loop. It requires no keys, paid accounts or external service. `scripts/demo.mjs` fixes demo mode and loopback binding. The keeper advances the chain/indexer, prize fixture epochs, fee fixtures, content, backups and pruning. Generated content is free local data. Failing tasks are recorded without stopping other tasks. RPC/payer outages do not prevent free play on published content.

Cadence uses IMD runway: paid content is contemplated daily above 60 modeled days, every three days above 21, and stopped below 21. With no paid budget the procedural fallback runs every six days. Prize budgets are separately capped; the production essential-before-prizes gate is a launch integration requirement, not fully enforced by the demo keeper. `runway` is a simulation based on an assumed essential daily unit budget, not a guaranteed bill forecast.

Content states are author → review → test → publish, with durable packs, versions, rules and rejection memory. Three failed attempts stop a cycle; unpaid work waits at most six hours before fallback. Payment invoices have stable identifiers, explicit payee/amount checks and bounded retries; a changed request cannot reuse an invoice. Onchain unique invoices are the final duplicate-transfer barrier. Publish only the tested parent content set; concurrent multi-publisher operation is not supported by this release and must remain disabled until an atomic parent/version lease is implemented.

## Backups and replacement

The keeper creates a consistent `VACUUM INTO` snapshot every six hours and retains twelve local snapshots. This is local recovery automation, **not off-host backup or paid failover**. A live SQLite database may have WAL state: copying only the live `.sqlite` file is not a backup.

```sh
node scripts/recover.mjs backup data/demo.sqlite /tmp/dcp-snapshot.sqlite
node scripts/recover.mjs check /tmp/dcp-snapshot.sqlite
node scripts/recover.mjs restore /tmp/dcp-snapshot.sqlite /tmp/dcp-restored.sqlite
```

The restore tool validates integrity and creates a new target; it refuses overwrites and live-WAL sources. Operators stop the old process, fence its database access, start the replacement with the restored path, and compare accounts, inventory, pending payments, proofs and chain cursor before resuming settlement. Test at least weekly in staging. Preserve old backups until reconciliation completes. Suggested later targets: RPO ≤6 hours, RTO ≤1 hour; neither is an achieved service guarantee here.

Before launch the infrastructure operator must provision durable disks, encrypted off-host snapshots, access-controlled secret storage, health alerts, restore scheduling, a replacement host and vendor billing. Use one active SQLite writer deployment; do not put this database on shared network storage or autoscale replicas. Multi-host state requires a reviewed database/lease design. Docker restart handles process exit, not infrastructure loss. No founder computer or temporary contributor workspace is a production host.

## Loss, outages and dormancy

| Condition | Implemented behavior | Later operation responsibility |
| --- | --- | --- |
| Backend stops | SQLite/chain fixtures recover from disk; final contract claims remain direct calls | Host restarts; cross-host operator restores private snapshot |
| Keeper disappears | Ordinary play uses existing content; no new settlements or fee harvesting | Replace keeper with bounded role; reconcile confirmed chain state before retry |
| Payer disappears / budget empty | Free fallback; no real payment transport is enabled; fixture retries capped | Replace isolated payment identity by timelock; reconcile accepted request ids and invoice events |
| Bad generated content | Schema/text/balance rejection; candidate simulation fails publication; memory records problems | Independent reviewer approves any new schema or engine primitive |
| Rollback | `rolled_back` stops new floors; existing version remains playable; `unsafe` regenerates a floor while retaining active combat | Pin operator-approved rollback version; independently check retained powers/quests |
| Shallow reorg | No unconfirmed purchase credited | Finality policy per deployed chain |
| Deep reorg | Persistent `chainHalted` stops settlement; preserves consumed items and claim evidence | Guardian/operations reconcile canonical purchase/claim logs and compensations before clearing the halt |
| Conversion fails | Contract transaction reverts; assets/caps/approvals roll back | Wait for verified price, liquidity and gas thresholds; no relaxed minimum output |
| Treasury freeze | Work and conversions stop; gas topups remain separately capped; player claims unaffected | Guardian alerts council; delayed unfreeze only after review |
| All governance keys lost | No new role recovery path unless already queued | Multiple independent holders and backup signers must be provisioned; safe dormancy may be permanent |

In production, dormant service must stop new purchases and prize promises first, preserve final roots/proofs and an independently downloadable claim bundle, keep read-only status and recovery instructions available while funded, and avoid spending player custody on operation. The current browser's demo mode has no real purchase liabilities. Merkle proofs are necessary for claims: a contract alone does not reconstruct a missing leaf database. A decentralized/public proof publication pipeline is still required before launch.

## Authority, privacy and publication

Only a funded external keeper can originate transactions or HTTP requests; contracts cannot schedule themselves. Payment signing, score posting, content authoring/review/publication, database access and financial governance are separate privileges. The proposed operator council controls timelocked bounded configuration; guardian veto/freeze never authorizes withdrawals. No founder admin or automatic wallet forwarding is planned.

Do not pass recovery codes, sessions, RNG secrets, keys, raw device/network signals or player messages to paid content prompts. Prompts must be constructed from reviewed rules and aggregate content metrics. Salted signals are still correlatable and onchain activity is public; there is no anonymity promise. Public status includes versions, runway assumptions, spending, reserves, liabilities, liquidity fixtures and redacted outage summaries. Detailed error strings remain private because provider errors can contain credentials or payloads.

Keep encrypted runtime backups outside source and static artifacts. Source publication belongs to the IMD publisher; credentials are not requested from or assumed to belong to the requester. The external public GitHub repository, independent review receipt, actual hosting URL and funded operator roles must all be recorded during the later reviewed launch.
