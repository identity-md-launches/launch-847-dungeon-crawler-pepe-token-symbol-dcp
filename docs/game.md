# Game rules and creative scope

Dungeon Crawler Pepe is set in the Swamp Below, an interdimensional spectacle administered by the IDSC. Its cast, quests and text are original. Sir Reginald can be pawned and redeemed; Kevin remembers how you treated him; sponsor contracts change your powers and obligations. Stitch-Mother destroys two items to transplant one power into the other's stat profile. Profanity, gross monsters, predatory advertising, non-graphic adult jokes and absurd bureaucracy belong to the world. There are no copied book characters, plot or dialogue.

## Play and persistence

Routes are keyed to a server-secret-derived character seed, choice history, floor and Overtime count. Reloads and retries cannot reroll a committed offer. Every move is interpreted from a fixed action set. Text is data, never executable commands. The engine combines effects, triggers, modifiers and drawbacks; valid combinations must fit a power budget. Population popularity steers away from convergence. Each encounter retains its content version while new floors can use reviewed updates.

Classes have different skills and tag affinities. Secret doors respond to tags, keys, gold or hype. Perks and gear expose their mechanical effect and drawback. Equipment may carry a composed power, not only a renamed stat roll. There are 24 perk slots and 30 inventory slots; replacement is explicit. Splicing two unequipped items of the same slot consumes both, 30 + 10 × their highest tier gold, and keeps one donor power plus the other item's stats. It never stacks both powers or creates escalating stats for free.

Death retires the character. Accounts, cosmetic purchases, paid slots and earned reward records persist. A new character may use an elevator to half the season-best depth. A revive consumes one purchased entitlement and disqualifies the revived run from rankings and further milestone awards; it does not revoke previously earned rewards. Normal free players can play indefinitely and restart after death. Season identifiers exist, but **automatic season rollover and party gameplay are not implemented**. Do not schedule a season reset before a reviewed rollover implementation preserves accounts and claims.

Gold, items and powers are server ledger objects, not transferable tokens or NFTs. There is no item marketplace or cash redemption. The shop sells cosmetics, additional slots and unranked revives; cosmetics do not alter combat. Slots can increase opportunity to find a good run, so competitive anti-farming remains imperfect. No IMD NFT is required. All paid-looking behavior in this build uses labelled test DCP.

## Rewards and abuse limits

Milestones are awarded once per account and season, daily rankings use server-computed fame, and a weighted draw samples eligible players. Default eligibility requires wallet authentication, account age and substantial play. A cluster based on salted network/user-agent signals shares an epoch cap. These are heuristics, **not proof of one human**: bots, proxy rotation, account resets, unlimited Overtime and coordination require an adversarial farming trial before prizes have value. Heuristics may also group a shared household incorrectly.

The reserve caps emissions by free balance and absolute daily limits, protects existing liabilities, and has no withdrawal method. An earned milestone that cannot fit is retained whole for another epoch. Ordinary play RNG is not a valuable-prize source. The browser demonstration uses biased local commit/reveal fixtures; production contracts require a funded VRF source. Score/eligibility correctness still depends on a trusted poster plus guardian review; the contract does not replay game moves.

The local author expands effect combinations, monsters, biomes, events and callbacks. It cannot add arbitrary engine primitives or executable code. Generated branching quest schemas beyond the base quests, new classes and new engine mechanics need reviewed source releases. This bounded schema is a safety boundary, and continued creative expansion is an operating responsibility, not a promise of infinite novel mechanics.

See `docs/evidence/variety-simulation.json` for 120 players × four days, eight bot policies, duplicate signatures, pairwise overlap, offer repetition, synergy diversity and dominant-strategy measurements. Bot diversity is evidence for this workload, not evidence that no human exploit or optimum exists.
