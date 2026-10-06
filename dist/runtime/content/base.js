// Base content pack v1 — original world, cast and systems for Dungeon Crawler Pepe.
// Everything here is DATA. The engine only interprets whitelisted effect kinds (see
// game/powers.js EFFECT_KINDS); text is never executed or fed back as instructions.
// Adult content: profanity, gross-out and innuendo; nothing sexually graphic.

export const PACK_ID = 'base';
export const PACK_VERSION = 1;

export const WORLD = {
  name: 'The Swamp Below',
  premise:
    'The Interdimensional Department of Spectacle & Collections (IDSC) foreclosed on the surface world ' +
    'for unpaid cosmic property tax. Survivors were "relocated" into a 1,000-floor dungeon that doubles as ' +
    'the multiverse\'s highest-rated snuff-adjacent reality show. You are a Crawler. Your audience is ' +
    'billions of bored eldritch things. Your sponsors are predators. Your paperwork is overdue.',
};

export const CLASSES = [
  { id: 'brawler', name: 'Swamp Brawler', hp: 44, atk: 7, def: 2, tags: ['bleed', 'crit'], blurb: 'Fists like wet cinderblocks. Solves problems by punching them until they become different problems.' },
  { id: 'accountant', name: 'Hex Accountant', hp: 32, atk: 5, def: 1, tags: ['gold', 'bureaucracy'], blurb: 'Weaponised compound interest. Can audit a demon to death.' },
  { id: 'bard', name: 'Bard of Bad Decisions', hp: 34, atk: 5, def: 1, tags: ['hype', 'chaos'], blurb: 'Every song is a diss track. Every diss track is a war crime.' },
  { id: 'necro', name: 'Meme Necromancer', hp: 30, atk: 6, def: 1, tags: ['minion', 'curse'], blurb: 'Raises the dead as reaction images. They are not happy about it.' },
  { id: 'paladin', name: 'Sewer Paladin', hp: 46, atk: 5, def: 3, tags: ['shield', 'filth'], blurb: 'Sworn to a god of drainage. Smells holy, in the worst way.' },
  { id: 'grifter', name: 'Grifter', hp: 33, atk: 6, def: 1, tags: ['gold', 'speed'], blurb: 'Has sold the same cursed timeshare to three liches.' },
  { id: 'chemist', name: 'Chemist of Questionable Compounds', hp: 31, atk: 5, def: 1, tags: ['poison', 'fire'], blurb: 'Mostly explosions. Occasionally medicine. Usually both.' },
  { id: 'monk', name: 'Toad Monk', hp: 38, atk: 6, def: 2, tags: ['speed', 'shield'], blurb: 'Achieved enlightenment by licking the wrong wall. Kicks very fast.' },
];

export const TAGS = ['fire', 'poison', 'bleed', 'minion', 'gold', 'hype', 'curse', 'shield', 'crit', 'chaos', 'filth', 'bureaucracy', 'speed', 'frost', 'void'];

// Effect atoms: kind (engine-interpreted) + flavour. `base` is magnitude at floor 1.
export const EFFECTS = [
  { id: 'scald', kind: 'damage', base: 6, tags: ['fire'], text: 'spits a gout of swamp-gas fire for {n}' },
  { id: 'shank', kind: 'damage', base: 5, tags: ['bleed'], text: 'shanks the bastard for {n}' },
  { id: 'gutpunch', kind: 'damage', base: 7, tags: ['crit'], text: 'delivers a gut-punch rated R for "Really fucking hard" ({n})' },
  { id: 'audit', kind: 'damage', base: 4, tags: ['bureaucracy'], text: 'files a hostile audit dealing {n} emotional-and-literal damage' },
  { id: 'frostburp', kind: 'damage', base: 5, tags: ['frost'], text: 'burps a cone of freezer-burn for {n}' },
  { id: 'voidyell', kind: 'damage', base: 6, tags: ['void'], text: 'screams into the void; the void screams back at the enemy for {n}' },
  { id: 'venom', kind: 'poison', base: 3, tags: ['poison'], text: 'coats the enemy in "artisanal" venom ({n}/turn)' },
  { id: 'rot', kind: 'poison', base: 2, tags: ['filth', 'poison'], text: 'gifts the enemy a festering sock ({n}/turn)' },
  { id: 'lacerate', kind: 'bleed', base: 3, tags: ['bleed'], text: 'opens a wound that will not shut up ({n}/turn)' },
  { id: 'patch', kind: 'heal', base: 6, tags: ['shield'], text: 'slaps duct tape on the worst bits (+{n} HP)' },
  { id: 'snack', kind: 'heal', base: 5, tags: ['filth'], text: 'eats something off the floor and feels weirdly great (+{n} HP)' },
  { id: 'wall', kind: 'shield', base: 6, tags: ['shield'], text: 'raises a wall of compliance paperwork ({n} block)' },
  { id: 'grime', kind: 'shield', base: 5, tags: ['filth'], text: 'gets so filthy nothing wants to touch them ({n} block)' },
  { id: 'iceplate', kind: 'shield', base: 5, tags: ['frost'], text: 'frosts over like a forgotten burrito ({n} block)' },
  { id: 'pickpocket', kind: 'gold', base: 6, tags: ['gold'], text: 'lifts {n} gold from a pocket the enemy did not know it had' },
  { id: 'invoice', kind: 'gold', base: 5, tags: ['bureaucracy', 'gold'], text: 'invoices the enemy for {n} gold, net-zero days' },
  { id: 'raise', kind: 'minion', base: 3, tags: ['minion'], text: 'raises a minion that does {n} per turn and complains constantly' },
  { id: 'intern', kind: 'minion', base: 2, tags: ['bureaucracy', 'minion'], text: 'hires an unpaid intern who stabs for {n}/turn' },
  { id: 'crowdpop', kind: 'hype', base: 4, tags: ['hype'], text: 'does something so stupid the audience gains {n} Hype' },
  { id: 'trashtalk', kind: 'hype', base: 3, tags: ['hype', 'chaos'], text: 'trash-talks the enemy\'s mother (+{n} Hype)' },
  { id: 'daze', kind: 'stun', base: 1, tags: ['speed'], text: 'smacks it so fast it forgets what year it is (stun {n})' },
  { id: 'freeze', kind: 'stun', base: 1, tags: ['frost'], text: 'flash-freezes its dumb face (stun {n})' },
  { id: 'hex', kind: 'weaken', base: 2, tags: ['curse'], text: 'hexes it with chronic erectile-adjacent dysfunction of the sword arm (-{n} ATK)' },
  { id: 'jinx', kind: 'weaken', base: 2, tags: ['curse', 'chaos'], text: 'jinxes it into tripping over its own entrails (-{n} ATK)' },
  { id: 'mirror', kind: 'reflect', base: 3, tags: ['shield', 'void'], text: 'reflects {n} damage back with a smug little noise' },
  { id: 'leech', kind: 'drain', base: 4, tags: ['curse', 'void'], text: 'sucks {n} HP out of it, unhygienically' },
  { id: 'gamble', kind: 'chaos', base: 8, tags: ['chaos'], text: 'flips a cursed coin: {n} damage to someone, probably them' },
  { id: 'haste', kind: 'extra_action', base: 1, tags: ['speed'], text: 'takes {n} extra action out of pure spite' },
  { id: 'critup', kind: 'crit_chance', base: 10, tags: ['crit'], text: 'gains +{n}% crit chance from staring at the enemy\'s weak spot (it\'s the groin)' },
  { id: 'firewall', kind: 'burn', base: 3, tags: ['fire'], text: 'sets the enemy on fire, which it hates ({n}/turn)' },
];

export const TRIGGERS = [
  { id: 'on_hit', text: 'Whenever you hit,', weight: 1.0, power: 0.55 },
  { id: 'on_kill', text: 'When you kill something,', weight: 0.9, power: 1.0 },
  { id: 'low_hp', text: 'While below 30% HP,', weight: 0.7, power: 1.3 },
  { id: 'first_turn', text: 'On the first turn of combat,', weight: 0.9, power: 1.2 },
  { id: 'every_third', text: 'Every third turn,', weight: 0.8, power: 1.1 },
  { id: 'on_damaged', text: 'When you take damage,', weight: 0.9, power: 0.6 },
  { id: 'on_flee', text: 'When you flee like a coward,', weight: 0.4, power: 1.5, needs: 'can_flee' },
  { id: 'on_taunt', text: 'When you taunt,', weight: 0.8, power: 0.9 },
  { id: 'on_deal', text: 'When you sign a sponsor deal,', weight: 0.4, power: 2.0 },
  { id: 'on_rest', text: 'When you rest,', weight: 0.6, power: 1.4 },
  { id: 'on_crit', text: 'When you crit,', weight: 0.7, power: 0.9, needsTag: 'crit' },
  { id: 'on_loot', text: 'When you loot a corpse,', weight: 0.6, power: 1.0 },
  { id: 'floor_start', text: 'At the start of every floor,', weight: 0.5, power: 2.0 },
  { id: 'minion_dies', text: 'When one of your minions dies screaming,', weight: 0.5, power: 1.2, needsTag: 'minion' },
  { id: 'on_curse', text: 'When you gain a curse,', weight: 0.4, power: 1.8, needsTag: 'curse' },
  { id: 'high_hype', text: 'While Hype is above 20,', weight: 0.6, power: 1.0, needsTag: 'hype' },
  { id: 'on_skill', text: 'When you use a skill,', weight: 0.9, power: 0.7 },
  { id: 'enemy_poisoned', text: 'Against poisoned enemies,', weight: 0.6, power: 0.8, needsTag: 'poison' },
  { id: 'on_block', text: 'When your block absorbs a hit,', weight: 0.7, power: 0.7, needsTag: 'shield' },
  { id: 'gold_spent', text: 'When you spend gold,', weight: 0.5, power: 1.2, needsTag: 'gold' },
];

export const MODIFIERS = [
  { id: 'plain', text: '', mult: 1.0, weight: 3 },
  { id: 'double_hp', text: 'twice as hard, but it costs you 3 HP', mult: 1.9, hpCost: 3, weight: 1 },
  { id: 'chain', text: 'and it splashes onto the next enemy too', mult: 0.8, chain: true, weight: 1 },
  { id: 'gold_scale', text: 'scaling with how much gold you\'re hoarding, you dragon', mult: 0.7, scale: 'gold', weight: 0.8 },
  { id: 'curse_scale', text: 'stronger for every curse festering on you', mult: 0.7, scale: 'curses', weight: 0.8 },
  { id: 'hype_scale', text: 'scaling with audience Hype', mult: 0.7, scale: 'hype', weight: 0.8 },
  { id: 'minion_scale', text: 'boosted per minion you own', mult: 0.7, scale: 'minions', weight: 0.6 },
  { id: 'echo', text: 'and it echoes next turn at half strength', mult: 0.8, echo: true, weight: 1 },
  { id: 'random_target', text: 'aimed by a drunk god (random target)', mult: 1.5, random: true, weight: 0.6 },
  { id: 'delayed', text: 'two turns late, like the bus', mult: 1.7, delay: 2, weight: 0.6 },
  { id: 'floor_scale', text: 'stronger the deeper you are', mult: 0.6, scale: 'depth', weight: 0.8 },
  { id: 'deathwish', text: 'tripled if you\'re one hit from death', mult: 1.0, lowHpMult: 3, weight: 0.5 },
  { id: 'sponsored', text: '(brought to you by a sponsor, who takes 2 gold per use)', mult: 1.4, goldCost: 2, weight: 0.7 },
  { id: 'loud', text: 'but it\'s so loud an extra monster wanders in sometimes', mult: 1.5, aggro: true, weight: 0.5 },
  { id: 'streak', text: 'growing each consecutive turn it fires', mult: 0.6, streak: true, weight: 0.6 },
];

export const DRAWBACKS = [
  { id: 'none', text: '', offset: 0, weight: 4 },
  { id: 'maxhp', text: 'You permanently lose 4 max HP. Worth it?', offset: 0.5, maxHp: -4, weight: 1 },
  { id: 'kidney', text: 'A sponsor now owns your left kidney and charges interest (lose 1 gold per room).', offset: 0.4, goldDrain: 1, weight: 0.8 },
  { id: 'noflee', text: 'You can no longer flee. Cowardice has been revoked.', offset: 0.6, noFlee: true, weight: 0.6 },
  { id: 'potty', text: 'You have a cursed potty mouth: every taunt also insults a random god (-1 HP).', offset: 0.3, tauntCost: 1, weight: 0.7 },
  { id: 'glowing', text: 'Your genitals glow faintly through your armour. Monsters see you coming (+1 enemy ATK).', offset: 0.5, enemyAtk: 1, weight: 0.6 },
  { id: 'paperwork', text: 'Each use generates Form 66-Δ, which must be filed (skip a turn every 5 uses).', offset: 0.5, paperwork: 5, weight: 0.6 },
  { id: 'hungry', text: 'It feeds on your snacks: healing received -20%.', offset: 0.4, healMult: 0.8, weight: 0.7 },
  { id: 'jealous', text: 'It is jealous of your other powers (-10% to all other effects).', offset: 0.5, jealous: 0.1, weight: 0.5 },
  { id: 'audience', text: 'The audience finds it boring (-1 Hype per use).', offset: 0.3, hypeCost: 1, weight: 0.7 },
  { id: 'brittle', text: 'Your bones become crunchy (-1 DEF).', offset: 0.5, def: -1, weight: 0.7 },
];

// Synergy sets: thresholds of owned tags unlock rule-bending bonuses.
export const SYNERGIES = [
  { tag: 'poison', at: 3, id: 'toxic_ecosystem', text: 'Toxic Ecosystem: poison on a dying enemy spreads to the next one.', effect: { poisonSpread: true } },
  { tag: 'fire', at: 3, id: 'arson_pact', text: 'Arson Pact: burning enemies take +2 from every hit.', effect: { burnBonus: 2 } },
  { tag: 'bleed', at: 3, id: 'red_wedding_planner', text: 'Event Planner (Red Theme): bleeds stack twice as fast.', effect: { bleedMult: 2 } },
  { tag: 'minion', at: 3, id: 'union_busting', text: 'Union Busting: minions deal +50% but you pay them nothing.', effect: { minionMult: 1.5 } },
  { tag: 'gold', at: 3, id: 'trickle_down', text: 'Trickle-Down Violence: deal +1 damage per 25 gold carried.', effect: { goldDamage: 25 } },
  { tag: 'hype', at: 3, id: 'viral', text: 'Viral Clip: Hype never decays below 10.', effect: { hypeFloor: 10 } },
  { tag: 'curse', at: 3, id: 'cursed_and_loving_it', text: 'Cursed & Loving It: each curse gives +1 ATK.', effect: { cursePower: 1 } },
  { tag: 'shield', at: 3, id: 'fortress_of_spite', text: 'Fortress of Spite: leftover block carries to next turn.', effect: { blockCarry: true } },
  { tag: 'crit', at: 3, id: 'groin_specialist', text: 'Groin Specialist: crits deal triple.', effect: { critMult: 3 } },
  { tag: 'chaos', at: 3, id: 'dice_goblin', text: 'Dice Goblin: chaos effects roll twice and keep the funnier result (higher).', effect: { chaosAdv: true } },
  { tag: 'filth', at: 3, id: 'biohazard', text: 'Biohazard: enemies that hit you get 2 poison.', effect: { thorns: 2 } },
  { tag: 'bureaucracy', at: 3, id: 'red_tape', text: 'Red Tape: enemies lose their first turn to paperwork.', effect: { enemySkipFirst: true } },
  { tag: 'speed', at: 3, id: 'zoomies', text: 'Zoomies: 25% chance of a free extra action each turn.', effect: { freeAction: 0.25 } },
  { tag: 'frost', at: 3, id: 'cold_open', text: 'Cold Open: stuns last one turn longer.', effect: { stunBonus: 1 } },
  { tag: 'void', at: 3, id: 'stare_back', text: 'The Void Stares Back: drain heals double.', effect: { drainMult: 2 } },
];

// Monsters: body × affix × behaviour, scaled by depth.
export const MONSTER_BODIES = [
  { id: 'goblin', name: 'Goblin Tax Collector', hp: 14, atk: 4, text: 'wears a tiny visor and a tinier conscience' },
  { id: 'slug', name: 'Brine Slug', hp: 20, atk: 3, text: 'leaves a trail that smells like a gas-station hot dog' },
  { id: 'rat', name: 'Rat King Franchisee', hp: 16, atk: 4, text: 'six rats knotted at the tail, all of them in middle management' },
  { id: 'mimic', name: 'Toilet Mimic', hp: 18, atk: 5, text: 'you sat down. That was your first mistake.' },
  { id: 'cultist', name: 'Cultist of the Unpaid Invoice', hp: 15, atk: 5, text: 'chanting "net thirty, net thirty"' },
  { id: 'meatgolem', name: 'Meat Golem', hp: 28, atk: 5, text: 'built entirely from discount deli products. Expired.' },
  { id: 'clown', name: 'Sad Clown Ooze', hp: 22, atk: 4, text: 'honks wetly when struck' },
  { id: 'lawyer', name: 'Litigation Wraith', hp: 17, atk: 6, text: 'serves you papers with a skeletal hand' },
  { id: 'toad', name: 'Feral Cousin Toad', hp: 19, atk: 4, text: 'a distant relative. He wants money.' },
  { id: 'eye', name: 'Bloodshot Beholdee', hp: 16, atk: 6, text: 'an eyeball the size of a minivan, hungover' },
  { id: 'centipede', name: 'Centipede in a Trenchcoat', hp: 21, atk: 5, text: 'pretending to be three kids. Badly.' },
  { id: 'moth', name: 'Compliance Moth', hp: 13, atk: 5, text: 'drawn to the light of your unfiled paperwork' },
  { id: 'hog', name: 'Bacon Revenant', hp: 24, atk: 5, text: 'a ghost pig seeking vengeance for every breakfast ever' },
  { id: 'influencer', name: 'Lich Influencer', hp: 18, atk: 6, text: '"smash that like button, mortal"' },
  { id: 'gnome', name: 'Lawn Gnome Insurgent', hp: 12, atk: 6, text: 'armed with a tiny AK made of garden hose' },
  { id: 'jelly', name: 'Gelatinous Cubicle', hp: 30, atk: 3, text: 'contains three lost employees, still on a conference call' },
  { id: 'crab', name: 'Hermit Crab in a Skull', hp: 20, atk: 5, text: 'the skull is wearing sunglasses' },
  { id: 'nun', name: 'Nun of the Above', hp: 17, atk: 6, text: 'judging you so hard it does damage' },
  { id: 'worm', name: 'Butt Worm Colossus (Juvenile)', hp: 26, atk: 4, text: 'emerges from where you think. Yes, that.' },
  { id: 'mascot', name: 'Fallen Sponsor Mascot', hp: 23, atk: 5, text: 'a costume with nobody inside. Still smiling.' },
];

export const MONSTER_AFFIXES = [
  { id: 'none', name: '', hp: 1, atk: 1 },
  { id: 'rabid', name: 'Rabid', hp: 1, atk: 1.3, text: 'foaming at three mouths' },
  { id: 'armored', name: 'Armoured', hp: 1.4, atk: 1, text: 'wearing riot gear it bought on credit' },
  { id: 'horny', name: 'Inappropriately Thirsty', hp: 1.1, atk: 1.1, text: 'keeps winking. Stop winking.' },
  { id: 'drunk', name: 'Blackout-Drunk', hp: 1.2, atk: 0.9, text: 'misses half its swings and apologises to the wall' },
  { id: 'sponsored', name: 'Sponsored', hp: 1.2, atk: 1.2, text: 'plastered with logos; drops extra gold' },
  { id: 'cursed', name: 'Cursed', hp: 1, atk: 1.1, text: 'killing it might curse you. Might.' },
  { id: 'giant', name: 'Absolute Unit of a', hp: 1.8, atk: 1.2, text: 'just... look at the size of it' },
  { id: 'tiny', name: 'Itty-Bitty', hp: 0.6, atk: 0.9, text: 'adorable. Murderous.' },
  { id: 'unionized', name: 'Unionised', hp: 1.1, atk: 1, text: 'takes mandated breaks mid-fight' },
  { id: 'molting', name: 'Molting', hp: 0.9, atk: 1.2, text: 'its old skin is everywhere. Everywhere.' },
  { id: 'prophetic', name: 'Prophetic', hp: 1, atk: 1.1, text: 'knows how you die. Won\'t say. Giggles.' },
];

export const BEHAVIOURS = ['aggressive', 'defensive', 'poisoner', 'thief', 'summoner', 'berserk', 'coward', 'heckler'];

export const BIOMES = [
  { id: 'sewer', name: 'Municipal Sewer of Infinite Regret', text: 'Ankle-deep in something brown that is technically a liquid.' },
  { id: 'mall', name: 'Dead Mall Labyrinth', text: 'Muzak plays from nowhere. A food court sells Hot Dog On A Stick, the stick is a femur.' },
  { id: 'office', name: 'Open-Plan Hellscape', text: 'Endless cubicles. A whiteboard says "SYNERGY" in blood.' },
  { id: 'casino', name: 'Casino of Bad Odds', text: 'The slot machines take teeth. The house always wins and the house is alive.' },
  { id: 'gut', name: 'Inside a Very Large Gut', text: 'Peristalsis. Rhythmic. Damp. It\'s digesting the previous Crawler.' },
  { id: 'church', name: 'Megachurch of the Pyramid Scheme', text: 'The collection plates have teeth. Salvation tiers start at Bronze.' },
  { id: 'gym', name: 'Gains Crypt', text: 'Skeletons spot each other on bench presses forever. Do you even lift, mortal?' },
  { id: 'dmv', name: 'The Eternal DMV', text: 'Now serving number 4. You hold number 9,000,000,001.' },
  { id: 'kitchen', name: 'Hell\'s Actual Kitchen', text: 'A chef demon screams at a pot of soup that screams back.' },
  { id: 'spa', name: 'Spa of Unspeakable Treatments', text: 'Mud baths. The mud is a monster. The cucumbers are also monsters.' },
  { id: 'server', name: 'Server Farm of the Dead', text: 'Blinking lights. Each rack hums with a damned soul doing unpaid moderation.' },
  { id: 'motel', name: 'No-Tell Motel Infinite', text: 'Every room has a stain shaped like a crime. Ice machine is a portal.' },
];

export const AFFLICTIONS = [
  'Gravity is on a payment plan and occasionally misses an instalment.',
  'Everything smells like burnt popcorn and regret.',
  'The walls are moist. Do not ask why.',
  'An unseen laugh track follows you.',
  'Sponsor billboards scream your browser history.',
  'The floor is lava-adjacent. Warm. Concerning.',
  'Every door is a mimic\'s cousin and they are gossiping.',
  'All lighting provided by bioluminescent mould.',
  'A choir of rats harmonises the theme song of a show you hate.',
  'The fog is sentient and a little horny. It respects boundaries, though.',
];

export const SPONSORS = [
  { id: 'grubhaus', name: 'Grubhaus Nutrient Paste', pitch: '"Grubhaus: now with 40% fewer screaming textures!"', style: 'heal' },
  { id: 'vexmire', name: 'Lord Vexmire\'s Payday Souls', pitch: '"Need gold NOW? Borrow against your immortal essence! APR: yes."', style: 'gold' },
  { id: 'slurp', name: 'SlurpCorp Ichor Energy', pitch: '"Taste the hemorrhage! Side effects include speed and death."', style: 'speed' },
  { id: 'bigmother', name: 'Big Mother Afterlife Insurance', pitch: '"Die with dignity. Or at least with a deductible."', style: 'shield' },
  { id: 'plinth', name: 'Dr. Plinth\'s Orthopaedic Tentacles', pitch: '"Replace that weak human arm with something that hugs back!"', style: 'damage' },
  { id: 'onlyfiends', name: 'OnlyFiends Premium', pitch: '"Exclusive content from the hottest demons in your area. Strictly ankle pics. Mostly."', style: 'hype' },
  { id: 'tallow', name: 'Tallow & Sons Funeral Candles', pitch: '"Scented like the people you couldn\'t save!"', style: 'fire' },
];

export const NPCS = {
  steward: { id: 'steward', name: 'Ombudsmoth Phyllis Gnarr', role: 'Floor Steward of the IDSC', voice: 'A giant moth in a cardigan with a stamp for every occasion. Calls everyone "applicant". Fucking loves forms.' },
  announcer: { id: 'announcer', name: 'Duke Brisket', role: 'Play-by-play commentator', voice: 'A floating smoked-meat head with a microphone. Despises you personally. Secretly bets on you.' },
  shopkeep: { id: 'shopkeep', name: 'Mama Grub', role: 'Shopkeeper, loan shark, aunt to no one', voice: 'A hag with a cart. Calls you "sugar-tits" regardless of anatomy. Prices are a vibe.' },
  companion: { id: 'companion', name: 'Sir Reginald Dongwhistle', role: 'Haunted cursed codpiece, self-appointed mentor', voice: 'Talks constantly from your crotch area in a posh accent. Has fought in seven wars. Lost all of them.' },
  kevin: { id: 'kevin', name: 'Kevin', role: 'Goblin who keeps dying near you', voice: 'Just a guy. Just a goblin guy. Holds grudges across resurrections.' },
  auditor: { id: 'auditor', name: 'The Auditor', role: 'Season boss, Senior Examiner of Souls', voice: 'Nobody has seen its face. Its calculator has a bloodstain.' },
};

// Branching quest templates. {npc}, {monster}, {item}, {place}, {sponsor} filled per player.
export const QUESTS = [
  {
    id: 'kevins_revenge', giver: 'kevin', title: 'Kevin Remembers',
    intro: 'Kevin is back. "You killed me {kevinDeaths} times. I have a lawyer now." The lawyer is a {monster}.',
    choices: [
      { id: 'apologise', text: 'Apologise sincerely (DEF+1, Kevin becomes an ally)', set: { kevin: 'ally' }, reward: { def: 1 } },
      { id: 'kill', text: 'Kill Kevin again (gold, Kevin grudge +1)', set: { kevin: 'enemy' }, fight: true, reward: { gold: 25 }, incr: 'kevinDeaths' },
      { id: 'hire', text: 'Hire Kevin as an intern (minion, costs 10 gold)', set: { kevin: 'intern' }, cost: { gold: 10 }, reward: { minion: 2 } },
    ],
  },
  {
    id: 'form_27', giver: 'steward', title: 'Form 27-B/Stroke-Ω',
    intro: 'Phyllis Gnarr flutters down. "Applicant, your existence permit lapsed. Retrieve the {item} from the {place} or be reclassified as furniture."',
    choices: [
      { id: 'comply', text: 'Fetch it (route reveals a secret room)', set: { form27: 'complied' }, reward: { secret: true, xp: 20 } },
      { id: 'forge', text: 'Forge the paperwork (Bureaucracy power, but a curse)', set: { form27: 'forged' }, reward: { power: 'bureaucracy' }, curse: true },
      { id: 'eat', text: 'Eat the form (heal 10, Phyllis will remember)', set: { form27: 'eaten' }, reward: { heal: 10 } },
    ],
  },
  {
    id: 'sponsor_contract', giver: 'announcer', title: 'A Word From Our Sponsors',
    intro: '{sponsor} wants you to say their slogan mid-fight. Duke Brisket is visibly erect about the ratings. (Figuratively. He is a ham.)',
    choices: [
      { id: 'sellout', text: 'Sell out completely (gold +40, -2 max HP from shame)', set: { sellout: true }, reward: { gold: 40, maxHp: -2 } },
      { id: 'mock', text: 'Mock the sponsor on air (Hype +15, sponsor hostile)', set: { sponsorHate: '{sponsorId}' }, reward: { hype: 15 } },
      { id: 'negotiate', text: 'Negotiate (power from sponsor style, small curse)', reward: { power: '{sponsorStyle}' }, curse: true },
    ],
  },
  {
    id: 'reginald_war', giver: 'companion', title: 'The Codpiece\'s Last War',
    intro: 'Sir Reginald is weeping (somehow). "The {monster} that slew my regiment lurks in the {place}. Avenge me, and I shall stop narrating your bathroom breaks."',
    choices: [
      { id: 'avenge', text: 'Hunt it down (elite fight, big loot)', fight: 'elite', set: { reginald: 'avenged' }, reward: { gold: 30, xp: 40 } },
      { id: 'refuse', text: 'Refuse (Reginald sulks: -1 ATK, but he stops talking for one floor)', set: { reginald: 'sulking' }, reward: { atk: -1, peace: true } },
      { id: 'pawn', text: 'Pawn him to Mama Grub (80 gold. He will be back.)', set: { reginald: 'pawned' }, reward: { gold: 80 } },
    ],
  },
  {
    id: 'mama_debt', giver: 'shopkeep', title: 'Mama Always Collects',
    intro: 'Mama Grub sharpens a ladle. "You owe me, sugar-tits. Pay up in coin, in blood, or in favours I won\'t describe on network television."',
    choices: [
      { id: 'pay', text: 'Pay 20 gold (Mama discount for the season)', cost: { gold: 20 }, set: { mama: 'paid' }, reward: { discount: 0.2 } },
      { id: 'blood', text: 'Pay in blood (-8 HP, +lifesteal power)', reward: { heal: -8, power: 'void' }, set: { mama: 'blood' } },
      { id: 'favour', text: 'The Favour (fade to black, cut to commercial; +Hype 20, unknown consequence)', set: { mama: 'favour' }, reward: { hype: 20 }, curse: true },
    ],
  },
  {
    id: 'cult_merger', giver: 'steward', title: 'Hostile Cult Merger',
    intro: 'Two cults on this floor — the {cultA} and the {cultB} — are merging. Both want a neutral third party to officiate. That\'s you, idiot.',
    choices: [
      { id: 'sideA', text: 'Side with the {cultA} (fire power)', set: { cult: 'A' }, reward: { power: 'fire' } },
      { id: 'sideB', text: 'Side with the {cultB} (poison power)', set: { cult: 'B' }, reward: { power: 'poison' } },
      { id: 'both', text: 'Take bribes from both and leave (gold +50, both cults hunt you)', set: { cult: 'both' }, reward: { gold: 50 }, fight: true },
    ],
  },
  {
    id: 'audience_vote', giver: 'announcer', title: 'Audience Choice Award',
    intro: 'The viewers are voting on what happens to you next. Current leader: "make them fight a {monster} while wearing a {item}."',
    choices: [
      { id: 'accept', text: 'Give the people what they want (fight, Hype +25)', fight: true, reward: { hype: 25 } },
      { id: 'bribe', text: 'Bribe the vote (15 gold, chaos power)', cost: { gold: 15 }, reward: { power: 'chaos' } },
      { id: 'moon', text: 'Moon the camera (Hype +10, banned in 3 dimensions, a curse)', reward: { hype: 10 }, curse: true, set: { mooned: true } },
    ],
  },
  {
    id: 'lost_crawler', giver: 'steward', title: 'Previous Tenant',
    intro: 'You find the journal of a dead Crawler named {deadName}. Last entry: "the {item} is a lie. Don\'t trust the {monster}. Tell my mom I"',
    choices: [
      { id: 'honor', text: 'Bury them properly (+1 max HP per floor for 3 floors... spiritually)', set: { buried: '{deadName}' }, reward: { maxHp: 3 } },
      { id: 'loot', text: 'Loot the body (random power, the ghost is annoyed)', reward: { power: 'random' }, set: { ghost: '{deadName}' } },
      { id: 'wear', text: 'Wear their skin as a disguise (monsters skip you once; gross)', reward: { stealth: 1 }, set: { skinsuit: true } },
    ],
  },
];

// Callbacks: lines that fire when history flags match, giving recurring characters memory.
export const CALLBACKS = [
  { when: { kevin: 'enemy' }, line: 'Somewhere, faintly, Kevin is writing your name in a notebook titled "DEATH LIST (FINAL) (2)".' },
  { when: { kevin: 'ally' }, line: 'Kevin waves at you from behind a monster and then stabs it in the kidney. "We cool," he mouths.' },
  { when: { kevin: 'intern' }, line: 'Kevin asks about dental coverage. You laugh until he cries.' },
  { when: { form27: 'eaten' }, line: 'Phyllis Gnarr eyes you. "We have a file on you. It\'s inside you, but we have it."' },
  { when: { form27: 'forged' }, line: 'A stamp hovers overhead: PROVISIONALLY ALIVE (FRAUDULENT).' },
  { when: { reginald: 'pawned' }, line: 'A familiar posh voice from Mama Grub\'s cart: "You BASTARD. I loved you. Also I\'m priced at 300 gold, the insult."' },
  { when: { reginald: 'avenged' }, line: 'Sir Reginald hums a military march. From your crotch. In public.' },
  { when: { sellout: true }, line: 'Duke Brisket: "Our favourite corporate shill returns! Do you even have a soul left? Asking for Vexmire."' },
  { when: { mooned: true }, line: 'A bounty poster: WANTED IN THREE DIMENSIONS FOR AGGRAVATED MOONING.' },
  { when: { mama: 'favour' }, line: 'Mama Grub winks. You feel violated in a way that is legally ambiguous.' },
  { when: { cult: 'both' }, line: 'Two cults chanting your name, one wants you dead, the other wants you more dead.' },
  { when: { skinsuit: true }, line: 'A monster says "Hey Darryl, you look different." You are not Darryl.' },
];

export const DAILY_EVENTS = [
  { id: 'tax_day', name: 'Cosmic Tax Day', text: 'IDSC takes 10% of gold looted today. Fuck the IDSC.', mod: { goldMult: 0.9, xpMult: 1.15 } },
  { id: 'ratings_week', name: 'Sweeps Week', text: 'All Hype gains doubled. Duke Brisket is unbearable.', mod: { hypeMult: 2 } },
  { id: 'gravity_audit', name: 'Gravity Audit', text: 'Every fifth room drops you somewhere random.', mod: { teleport: 5 } },
  { id: 'sponsor_blitz', name: 'Sponsor Blitz', text: 'Twice as many sponsor booths. Twice the predatory terms.', mod: { sponsorMult: 2 } },
  { id: 'monster_strike', name: 'Monster Union Strike', text: 'Fewer fights, but scabs are furious (elite chance up).', mod: { combatMult: 0.7, eliteMult: 2 } },
  { id: 'blood_moon', name: 'Blood Moon Happy Hour', text: 'Enemies +20% HP. Loot rarity up.', mod: { enemyHp: 1.2, lootUp: 1 } },
  { id: 'mercy_day', name: 'IDSC Mercy Day (Misprint)', text: 'Rest sites heal double. Someone will be fired for this.', mod: { restMult: 2 } },
  { id: 'kevin_day', name: 'Kevin Appreciation Day', text: 'Kevin is everywhere. Every single Kevin.', mod: { kevinDay: true } },
];

export const ITEM_BASES = [
  { slot: 'weapon', names: ['Rusty Spork', 'Plunger of Smiting', 'Femur Club', 'Folding Chair', 'Haunted Selfie Stick', 'Two-Handed Baguette', 'Brass Knuckle Dusters (Used)', 'Magical Lightsaber Strap-On (Rental)', 'Tax-Deductible Halberd'] },
  { slot: 'armor', names: ['Bathrobe of Holding', 'Trash-Bag Poncho', 'Cardboard Cuirass', 'Mall-Cop Vest', 'Inflatable Dinosaur Suit', 'Chainmail Thong', 'Hazmat Onesie'] },
  { slot: 'trinket', names: ['Lucky Toe (Not Yours)', 'Fidget Pentagram', 'Expired Coupon', 'Sentient Fanny Pack', 'Participation Trophy', 'Cursed Tamagotchi', 'Jar of Someone\'s Teeth'] },
];
export const MATERIALS = ['Moist', 'Gilded', 'Bootleg', 'Ancestral', 'Haunted', 'Irradiated', 'Artisanal', 'Discount', 'Forbidden', 'Sticky', 'Crusty', 'Legendary-ish'];

export const DEATH_LINES = [
  'Duke Brisket: "AND THEY\'RE DOWN! Folks, that was the dumbest death since last Tuesday\'s guy, and he drowned in soup."',
  'Phyllis Gnarr stamps your corpse: DECEASED (PENDING REVIEW). There will be a fee.',
  'Sir Reginald, muffled: "Not again. NOT AGAIN. Someone take me off this body."',
  'Kevin attends your funeral. He brought a kazoo.',
];

export const CULT_NAMES = ['Church of the Wet Sock', 'Order of the Leaking Ceiling', 'Brotherhood of Bad Credit', 'Sisters of the Eternal Brunch', 'Lodge of the Moist Handshake', 'Cult of Reply-All'];
export const DEAD_NAMES = ['Darryl', 'Tiffani with an i', 'Big Steve', 'Gregory the Unwashed', 'Brenda from Accounting', 'Chad Thunderclap', 'Nana Ruth'];
