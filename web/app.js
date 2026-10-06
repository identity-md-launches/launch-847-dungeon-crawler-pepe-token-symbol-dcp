// Dungeon Crawler Pepe — browser client. Thin view over the authoritative server API.
// Integrated mode is authoritative on the server; opt-in practice uses an isolated device ledger. All text is HTML-escaped.
import { Wallet } from './wallet.js';
import { practiceApi, unlocked } from './practice.js';
let practice = null;
let connectedOnce = false;
const CLASS_ICONS = ['✊', '⌘', '♫', '☠', '♜', '♠', '⚗', '☯'];

const $ = (s) => document.querySelector(s);
/** @param {string} selector @returns {NodeListOf<HTMLButtonElement>} */
const buttons = (selector) => document.querySelectorAll(selector);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dcp = (wei) => { const n = BigInt(wei ?? 0); const w = n / 10n ** 18n; const f = (n % 10n ** 18n).toString().padStart(18, '0').slice(0, 2); return `${w.toLocaleString()}${f !== '00' ? '.' + f : ''}`; };
const ICON = { entrance: '🚪', combat: '⚔️', elite: '★', shop: '🛒', sponsor: '📣', quest: '📜', rest: '🛏️', treasure: '💰', trap: '🪤', shrine: '⛩️', secret: '🗝️', stairs: '🪜', side: '🌀' };

const S = {
  token: localStorage.getItem('dcp.token'),
  cfg: null, me: null, ch: null, rev: 0, charId: localStorage.getItem('dcp.char'), busy: false, classId: null, wallet: null,
};

/** @param {string} path @param {{method?:string, body?:any, retries?:number}} options */
async function api(path, { method = 'GET', body, retries = 2 } = {}) {
  if (practice) return practice(path, { method, body });
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(path, { signal: AbortSignal.timeout(7000), method, headers: { 'content-type': 'application/json', ...(S.token ? { authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.headers.get('content-type')?.includes('application/json')) throw new Error('No game API at this address');
      if (!r.ok) { throw Object.assign(new Error(j.error ?? r.statusText), { status: r.status, data: j }); }
      return j;
    } catch (e) {
      // Network failures are retried with the SAME body (actions carry an idempotent actionId).
      if (e.status || (method !== 'GET' && !body?.actionId) || i >= retries) throw e;
      await new Promise((res) => setTimeout(res, 400 * (i + 1)));
    }
  }
}

function banner(msg) {
  $('#banner-text').textContent = msg;
  $('#banner').hidden = !msg;
}
$('#dismiss-banner').onclick = () => banner('');

function focusEncounter() {
  const target = S.ch?.pending ? $('#room') : $('#map');
  target?.focus({ preventScroll: true });
  if (target && (target.getBoundingClientRect().top < 0 || target.getBoundingClientRect().top > innerHeight - 100)) target.scrollIntoView({ block: 'start' });
}

function setBars(root = document) {
  for (const el of buttons('[data-w]')) el.style.width = `${Math.max(0, Math.min(100, Number(el.dataset.w)))}%`;
}

// ------------------------------------------------------------------ session
async function ensureSession() {
  if (practice) { S.me = await api('/api/me'); return; }
  if (S.token) {
    try { S.me = await api('/api/me'); return; } catch (e) { if (e.status !== 401) throw e; }
  }
  const g = await api('/api/auth/guest', { method: 'POST' });
  S.token = g.token;
  localStorage.setItem('dcp.token', g.token);
  S.me = await api('/api/me');
  banner(`Guest account created. Recovery code (save it to continue on another device): ${g.recovery}`);
}

function renderAcct() {
  const a = S.me?.account;
  const w = a?.wallet;
  $('#acct').innerHTML = `
    <span class="muted">${w ? '🦊 ' + esc(w.slice(0, 6) + '…' + w.slice(-4)) : 'Guest'}</span>
    ${S.me?.sessionWallet && S.wallet?.address && S.wallet.address.toLowerCase() !== S.me.sessionWallet.toLowerCase() ? '<span class="warn">wallet changed — sign again</span>' : ''}
    <button id="recoverBtn" class="small">Use recovery code</button>`;
  if (practice) { a && (a.wallet = null); $('#acct').innerHTML = '<span class="muted">Saved in this browser</span><button id="server-mode">Use server</button>'; $('#server-mode').onclick = () => { localStorage.removeItem('dcp.mode'); location.reload(); }; return; }
  $('#recoverBtn').onclick = () => { $('#recovery-dialog').showModal(); $('#recovery-code').focus(); };

}

$('#recovery-close').onclick = () => $('#recovery-dialog').close();
$('#recovery-form').onsubmit = async (event) => {
  event.preventDefault();
  const button = $('#recovery-form button[type=submit]');
  button.disabled = true;
  $('#recovery-error').textContent = '';
  $('#recovery-code').removeAttribute('aria-invalid');
  try {
    const r = await api('/api/auth/recover', { method: 'POST', body: { code: $('#recovery-code').value.trim() }, retries: 0 });
    S.token = r.token; localStorage.setItem('dcp.token', r.token);
    localStorage.removeItem('dcp.char'); S.charId = null; S.ch = null;
    $('#recovery-dialog').close(); await boot();
  } catch (e) { $('#recovery-error').textContent = e.message + '. Check the code and server, then try again.'; $('#recovery-code').setAttribute('aria-invalid', 'true'); $('#recovery-code').focus(); }
  finally { button.disabled = false; }
};
// ------------------------------------------------------------------ character select
function renderNoChar() {
  $('#welcome').hidden = false;
  $('#nochar').hidden = false;
  $('#game').hidden = true;
  $('#premise').textContent = S.cfg.world.premise;
  $('#classes').innerHTML = S.cfg.classes.map((c, i) => `<button type="button" aria-pressed="${S.classId === c.id}" class="class ${S.classId === c.id ? 'sel' : ''}" data-id="${esc(c.id)}"><span class="class-icon" aria-hidden="true">${CLASS_ICONS[i]}</span><b>${esc(c.name)}</b><small>${esc(c.blurb)}</small><small class="class-stats">HP ${c.hp} · ATK ${c.atk} · DEF ${c.def} · ${c.tags.map(esc).join(', ')}</small></button>`).join('');
  for (const b of buttons('.class')) b.onclick = () => { S.classId = b.dataset.id; renderNoChar(); $(`[data-id="${S.classId}"]`)?.focus({ preventScroll: true }); };
  const chars = S.me?.characters ?? [];
  $('#roster').innerHTML = chars.length ? `<h3>Your Crawlers</h3><table>${chars.map((c) => `<tr><td>${c.alive ? '🟢' : '💀'} ${esc(c.name)}</td><td>${esc(c.className)}</td><td>Lvl ${c.level}</td><td>Floor ${c.floor}</td><td>Fame ${c.fame}</td><td>${c.alive ? `<button data-play="${esc(c.id)}">Play</button>` : ''}</td></tr>`).join('')}</table>` : '';
  for (const b of buttons('[data-play]')) b.onclick = () => loadChar(b.dataset.play);
}

$('#character-form').onsubmit = async (event) => {
  event.preventDefault();
  if ($('#create').disabled) return;
  $('#create').disabled = true;
  $('#create').textContent = 'Entering…';
  $('#create-error').textContent = '';
  $('#cname').removeAttribute('aria-invalid');
  try {
    const r = await api('/api/characters', { method: 'POST', body: { name: $('#cname').value.trim(), classId: S.classId ?? S.cfg.classes[0].id } });
    S.me = await api('/api/me');
    setChar(r.character, r.rev); focusEncounter();
  } catch (e) { $('#create-error').textContent = e.message; $('#cname').setAttribute('aria-invalid', 'true'); $('#cname').focus(); }
  finally { $('#create').disabled = false; $('#create').textContent = 'Enter the dungeon ↘'; }
};

async function loadChar(id) {
  try { const r = await api('/api/character?id=' + encodeURIComponent(id)); setChar(r.character, r.rev); } catch (e) { banner(e.message); localStorage.removeItem('dcp.char'); renderNoChar(); }
}

function setChar(ch, rev) {
  S.ch = ch; S.rev = rev; S.charId = ch.id;
  localStorage.setItem(practice ? 'dcp.practice.char' : 'dcp.char', ch.id);
  renderGame();
}

// ------------------------------------------------------------------ actions
async function act(action) {
  if (S.busy) return;
  S.busy = true;
  $('#game').setAttribute('aria-busy', 'true');
  $('#action-status').textContent = 'Saving move…';
  for (const b of buttons('#game button:not(:disabled)')) { b.disabled = true; b.dataset.busy = 'true'; }
  const actionId = crypto.randomUUID();
  try {
    const r = await api('/api/act', { method: 'POST', body: { charId: S.charId, rev: S.rev, actionId, action } });
    setChar(r.character, r.rev);
    $('#action-status').textContent = 'Move saved. ' + (S.ch.log.at(-1) ?? '');
    focusEncounter();
  } catch (e) {
    $('#action-status').textContent = 'Move not saved. Try again.';
    if (e.status === 409 && e.data?.current) { setChar(e.data.current.character, e.data.current.rev); banner('Synced with your other device/tab.'); }
    else banner(e.message);
  } finally { S.busy = false; $('#game').removeAttribute('aria-busy'); for (const b of buttons('[data-busy]')) { b.disabled = false; delete b.dataset.busy; } }
}

// ------------------------------------------------------------------ game view
function renderGame() {
  const ch = S.ch;
  $('#welcome').hidden = true;
  $('#nochar').hidden = true;
  $('#game').hidden = false;
  const synergies = Object.keys(ch.flags).filter((k) => k.startsWith('syn_')).map((k) => k.slice(4).replace(/_/g, ' '));
  const xpNeed = 20 + ch.level * 15;
  $('#sheet').innerHTML = `
    <img src="favicon.svg" class="portrait" alt=""><p class="eyebrow">Crawler dossier</p><h2>${esc(ch.name)}</h2><div class="muted">${esc(ch.className)} · Level ${ch.level} · Floor ${ch.floor}${ch.revived ? ' · <span class="warn">revived (no prizes)</span>' : ''}</div>
    <div class="small">HP ${Math.max(0, ch.hp)}/${ch.maxHp}</div><div class="bar"><i data-w="${(100 * ch.hp) / ch.maxHp}"></i></div>
    <div class="small">Hype ${ch.hype}</div><div class="bar hype"><i data-w="${ch.hype}"></i></div>
    <div class="small">XP ${ch.xp}/${xpNeed}</div><div class="bar xp"><i data-w="${(100 * ch.xp) / xpNeed}"></i></div>
    <div class="stats"><span>ATK <b>${ch.atk + (ch.equipped.weapon?.atk ?? 0) + (ch.equipped.trinket?.atk ?? 0)}</b></span><span>DEF <b>${ch.def + (ch.equipped.armor?.def ?? 0) + (ch.equipped.trinket?.def ?? 0)}</b></span><span>Gold <b>${ch.gold}</b></span><span>Potions <b>${ch.potions}</b></span><span>Keys <b>${ch.secretKeys}</b></span><span>Fame <b>${ch.fame}</b></span></div>
    ${synergies.length ? `<p class="syn">🔗 ${synergies.map(esc).join(' · ')}</p>` : ''}
    ${ch.curses.length ? `<p class="bad small">Curses: ${ch.curses.map(esc).join(', ')}</p>` : ''}
    <h3>Powers (${ch.powers.length}/24)</h3>
    <ul class="powers">${ch.powers.map((p) => `<li class="${esc(p.rarity)}"><b>${esc(p.name)}</b> ${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}<br>${esc(p.text)}</li>`).join('') || '<li>None yet. Go get weird.</li>'}</ul>
    <h3>Gear</h3>
    <div class="small">${['weapon', 'armor', 'trinket'].map((s) => `${s}: ${ch.equipped[s] ? esc(ch.equipped[s].name) : '—'}`).join('<br>')}</div>
    <div class="inv">${ch.items.map((i) => `<button data-equip="${esc(i.id)}" title="${esc(i.power?.text ?? '')}">${esc(i.name)} ${i.atk ? '+' + i.atk + 'A' : ''}${i.def ? '+' + i.def + 'D' : ''}${i.power ? ' ✨' : ''}</button>`).join('')}</div>
    ${ch.items.length > 1 ? `<details><summary>Stitch-Mother: splice gear</summary><p class="small">Consume two items of the same slot. Keep the first item's power and the second item's stats. Cost: 30 + 10 × highest tier gold.</p><label for="donor">Power donor</label><select id="donor">${ch.items.map((i) => `<option value="${esc(i.id)}">Power: ${esc(i.name)}</option>`).join('')}</select><label for="shell">Stat donor (same slot)</label><select id="shell">${ch.items.map((i) => `<option value="${esc(i.id)}">Stats: ${esc(i.name)}</option>`).join('')}</select><button id="splice">Splice (consumes both)</button></details>` : ''}
    <div class="actions"><button id="switchChar">Switch Crawler</button></div>`;
  for (const b of buttons('[data-equip]')) b.onclick = () => act({ type: 'equip', choice: b.dataset.equip });
  if ($('#splice')) $('#splice').onclick = () => act({ type: 'craft', left: $('#donor').value, right: $('#shell').value, inherit: 'left' });
  $('#switchChar').onclick = async () => { S.me = await api('/api/me'); renderNoChar(); };
  renderRoom();
  renderMap();
  $('#log').innerHTML = `<h3>Broadcast feed</h3>${ch.log.slice().reverse().map((l) => `<p>${esc(l)}</p>`).join('')}`;
  setBars();
}

function renderRoom() {
  const ch = S.ch, p = ch.pending, el = $('#room');
  if (!ch.alive) {
    const hasRevive = (S.me?.owned ?? []).some((o) => o.sku === 4 && !String(o.order_id).startsWith('used:'));
    el.innerHTML = `<h2>☠️ Deceased</h2><p>${esc(ch.log.at(-2) ?? '')}</p><div class="actions"><button class="primary" id="newc">New Crawler</button>${hasRevive ? '<button id="rev">Use Big Mother Revive (forfeits prizes)</button>' : ''}</div>`;
    $('#newc').onclick = async () => { S.me = await api('/api/me'); renderNoChar(); };
    if (hasRevive) $('#rev').onclick = () => act({ type: 'revive' });
    return;
  }
  const btn = (label, action, cls = '') => `<button class="${cls}" data-act='${esc(JSON.stringify(action))}'>${label}</button>`;
  let html = '';
  if (!p) {
    html = `<h2>${esc(ch.map.biomeName)}</h2><p class="muted">${esc(ch.map.biomeText)} ${esc(ch.map.affliction)}</p><p>Pick a route on the map below.</p>`;
  } else if (p.kind === 'combat') {
    const cb = p.cb;
    html = `<h2>⚔️ Combat · turn ${cb.turn + 1}</h2><div class="enemies">${cb.enemies.map((e) => `<div class="enemy ${e.hp <= 0 ? 'dead' : ''}"><b>${esc(e.name)}</b><div class="bar"><i data-w="${(100 * Math.max(0, e.hp)) / e.maxHp}"></i></div><div class="small">HP ${Math.max(0, e.hp)}/${e.maxHp} · ATK ${e.atk} · ${esc(e.behaviour)}${e.poison ? ' · ☣️' + e.poison : ''}${e.bleed ? ' · 🩸' + e.bleed : ''}${e.burn ? ' · 🔥' + e.burn : ''}${e.stun ? ' · 💫' : ''}</div><div class="small muted">${esc(e.flavour)}</div></div>`).join('')}</div>
      <p class="small">Block ${cb.block} · Minions ${cb.minions.length} · Skill ${cb.skillCd ? 'cooldown ' + cb.skillCd : 'ready'}</p>
      <div class="actions">${btn('🗡️ Attack', { type: 'attack' }, 'primary')}${btn('💥 Skill', { type: 'skill' })}${btn('🗣️ Taunt', { type: 'taunt' })}${btn('🛡️ Defend', { type: 'defend' })}${btn(`🧪 Potion (${ch.potions})`, { type: 'potion' })}${btn('🏃 Flee', { type: 'flee' }, 'danger')}</div>`;
  } else if (p.kind === 'offer') {
    const full = ch.powers.length >= 24;
    html = `<h2>🧬 ${esc(p.reason)}</h2>${full ? '<p class="warn">Power slots full: choosing replaces your first power. (Or skip for gold.)</p>' : ''}<div class="offers">${p.offers.map((o, i) => `<div class="offer ${esc(o.rarity)}"><b>${esc(o.name)}</b><span class="small">${esc(o.rarity)} · ${o.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span><p>${esc(o.text)}</p>${btn('Take perk ' + (i + 1), full ? { type: 'choose', index: i, replace: 0 } : { type: 'choose', index: i })}</div>`).join('')}</div><div class="actions">${btn('Skip (+8 gold)', { type: 'skip' })}</div>`;
  } else if (p.kind === 'quest') {
    html = `<h2>📜 ${esc(p.title)}</h2><p>${esc(p.intro)}</p><div class="actions">${p.choices.map((c) => btn(esc(c.text), { type: 'quest', choice: c.id })).join('')}</div>`;
  } else if (p.kind === 'shop') {
    html = `<h2>🛒 Mama Grub's Cart</h2><div class="actions">${p.stock.map((s) => btn(`${esc(s.name)} — ${s.price}g`, { type: 'buy', choice: s.id })).join('')}${btn('Leave', { type: 'leave' })}</div>`;
  } else if (p.kind === 'sponsor') {
    html = `<h2>📣 ${esc(p.sponsorName)}</h2><div class="offer ${esc(p.deal.rarity)}"><b>${esc(p.deal.name)}</b><p>${esc(p.deal.text)}</p><p class="bad">Fine print: ${esc(p.predatory.text)}</p></div><div class="actions">${btn('✍️ Sign', { type: 'sponsor', choice: 'accept' }, 'primary')}${btn('Walk away', { type: 'sponsor', choice: 'decline' })}</div>`;
  } else if (p.kind === 'shrine') {
    html = `<h2>⛩️ Shrine</h2><div class="actions">${p.options.map((o) => btn(esc(o.text), { type: 'shrine', choice: o.id })).join('')}${btn('Leave', { type: 'leave' })}</div>`;
  } else if (p.kind === 'rest') {
    html = `<h2>🛏️ Rest site</h2><div class="actions">${btn('Sleep (heal)', { type: 'rest', choice: 'heal' }, 'primary')}${btn('Train (+1 ATK)', { type: 'rest', choice: 'train' })}${btn('Leave', { type: 'leave' })}</div>`;
  } else if (p.kind === 'stairs') {
    html = `<h2>🪜 Stairs</h2><p>Descend to floor ${ch.floor + 1}, or if the IDSC hasn't opened it yet, take an Overtime Zone.</p><div class="actions">${btn('🔻 Descend', { type: 'descend' }, 'primary')}${btn('⏱️ Overtime Zone', { type: 'overtime' })}</div>`;
  }
  if (!p || p.kind !== 'combat') html += `<div class="actions">${ch.potions && ch.hp < ch.maxHp ? btn(`🧪 Drink potion (${ch.potions})`, { type: 'potion' }) : ''}</div>`;
  el.innerHTML = html;
  for (const b of el.querySelectorAll('[data-act]')) {
    const action = JSON.parse(b.dataset.act);
    b.onclick = () => act(action);
    if ((action.type === 'skill' && p?.cb?.skillCd > 0) || (action.type === 'potion' && !ch.potions)) b.disabled = true;
  }
}

function renderMap() {
  const ch = S.ch, nodes = ch.map.nodes;
  const here = nodes[ch.node];
  const layers = [];
  for (const n of nodes) {
    if (n.hidden && !here.next.includes(n.id) && !ch.visited.includes(n.id)) continue;
    (layers[n.layer] ??= []).push(n);
  }
  $('#map').innerHTML = `<h3>Floor ${ch.floor} map ${ch.overtime ? `(Overtime #${ch.overtime})` : ''}</h3><div class="layers" role="region" aria-label="Floor routes" tabindex="0">${layers.map((L) => `<div class="layer">${(L ?? []).map((n) => {
    const reach = ch.alive && !ch.pending && here.next.includes(n.id) && unlocked(n, ch);
    const cls = ['node', n.id === ch.node ? 'here' : '', ch.visited.includes(n.id) ? 'visited' : '', reach ? 'reach' : ''].join(' ');
    return `<button class="${cls}" ${reach ? `data-to="${n.id}"` : 'disabled'} aria-label="${esc(n.type)} route ${n.id}${reach ? ' — available' : n.id === ch.node ? ' — current location' : ''}" title="${esc(n.type)}${n.hidden ? ' (secret: ' + esc(n.requires) + ')' : ''}">${ICON[n.type] ?? '?'}</button>`;
  }).join('')}</div>`).join('')}</div><p class="map-hint">Gold outline = available route · Green ring = you · Scroll the map to explore →</p>`;
  for (const b of buttons('[data-to]')) b.onclick = () => act({ type: 'move', to: Number(b.dataset.to) });
}

// ------------------------------------------------------------------ other tabs
async function renderBoard() {
  const lb = await api('/api/leaderboard');
  $('#board').innerHTML = `<h2>Season ${lb.season} · Day ${lb.day + 1}</h2>
    ${practice ? '<p class="warn">Practice rankings on this browser only. No competitive scores or token rewards.</p>' : ''}<h3>Hall of Fame (and Corpses)</h3><table><tr><th>#</th><th>Crawler</th><th>Class</th><th>Depth</th><th>Fame</th><th>Build</th></tr>
    ${!lb.top.length ? '<tr><td colspan="6" class="muted">No Crawlers yet. Enter the dungeon to start a run.</td></tr>' : ''}${lb.top.map((r, i) => `<tr><td>${i + 1}</td><td>${r.alive ? '' : '💀 '}${esc(r.name)}</td><td>${esc(r.className)}</td><td>${r.depth}</td><td>${r.fame}</td><td>${r.build.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</td></tr>`).join('')}</table>
    <h3>Today's fame gains</h3><table>${lb.daily.map((r) => `<tr><td>${r.rank}</td><td>${esc(r.account)}…</td><td>${r.fame}</td></tr>`).join('')}</table>`;
}

async function renderLoot() {
  if (practice) {
    $('#wallet').innerHTML = '<h2>Practice loot stays in the dungeon.</h2><p>No wallet is connected in browser practice. Your gear, gold and powers are saved on this device.</p>';
    $('#rewards').innerHTML = '<h2>Token rewards are off</h2><p class="muted">Practice cannot earn or claim DCP. In the integrated local demo, all purchases and prizes use labelled test balances.</p>';
    $('#shop').innerHTML = '<h2>Try the integrated demo</h2><p>Run the local server from the source README to test simulated purchases, persistent accounts and reward claims.</p><p class="small">Nothing here spends real money. Browser practice saves cannot be imported into ranked play.</p>';
    return;
  }
  const w = S.me?.account?.wallet;
  const demo = S.cfg.demo;
  $('#wallet').innerHTML = `<h2>Wallet</h2>
    <p class="muted">You only need a wallet to receive token prizes or buy cosmetics. Connecting doesn't sign you in: you'll sign a one-time message that costs no gas and approves nothing.</p>
    <p>Linked: ${w ? `<b>${esc(w)}</b>` : 'none'}</p>
    <div class="actions">${S.cfg.chain === 'sim' ? '' : '<button id="connect" class="primary">Connect &amp; sign in</button>'}${demo ? '<button id="demolink">Use simulated demo wallet</button>' : ''}</div>
    <div id="wstate" class="small"></div>`;
  if ($('#connect')) $('#connect').onclick = connectWallet;
  if ($('#demolink')) $('#demolink').onclick = async () => { const r = await api('/api/demo/link-wallet', { method: 'POST' }); banner(r.note); S.me = await api('/api/me'); renderLoot(); renderAcct(); };

  const rw = await api('/api/rewards');
  $('#rewards').innerHTML = `<h2>Prizes</h2><table><tr><th>Kind</th><th>DCP</th><th>Epoch</th><th>Status</th></tr>${rw.rewards.map((r) => `<tr><td>${esc(r.kind)}</td><td>${dcp(r.amount)}</td><td>${r.epoch ?? '—'}</td><td class="${r.status === 'claimed' ? 'ok' : r.status === 'claimable' ? 'warn' : 'muted'}">${esc(r.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No prizes yet. Reach floor 3 for your first milestone.</td></tr>'}</table>
    <div class="actions">${rw.claimTx ? '<button id="claim" class="primary">Claim all (one transaction)</button>' : ''}${demo && rw.rewards.some((r) => r.status === 'claimable') ? '<button id="democlaim" class="primary">Claim (simulated)</button>' : ''}</div>`;
  if ($('#claim')) $('#claim').onclick = async () => { try { const h = await S.wallet.send(rw.claimTx); banner('Claim sent: ' + h); } catch (e) { banner(e.message); } };
  if ($('#democlaim')) $('#democlaim').onclick = async () => { const r = await api('/api/demo/claim', { method: 'POST' }); banner(r.results.map((x) => (x.ok ? 'claimed' : x.error)).join(', ')); renderLoot(); };

  const orders = await api('/api/orders');
  $('#shop').innerHTML = `<h2>DCP Shop</h2><p class="muted">Test DCP buys cosmetics, slots, and Revives (a revived run can't win prizes). Slot fairness remains under review. Each purchase: 30% burned, 50% back to the prize reserve, 20% to operations.</p>
    <table>${S.cfg.skus.map((s) => `<tr><td>${esc(s.name)}</td><td>${dcp(s.price)} DCP</td><td><button data-buy="${s.sku}">Buy</button></td></tr>`).join('')}</table>
    <div class="section-heading"><h3>Orders</h3><button id="refresh-orders">Refresh orders</button></div><table>${orders.map((o) => `<tr><td>${esc(S.cfg.skus.find((s) => s.sku === o.sku)?.name ?? o.sku)}</td><td>${dcp(o.price)}</td><td class="${o.status === 'credited' ? 'ok' : o.status === 'underpaid' || o.status === 'orphaned' ? 'bad' : 'warn'}">${esc(o.status)}</td><td>${demo && o.status === 'created' ? `<button data-pay="${esc(o.order_id)}">Pay (simulated)</button>` : ''}</td></tr>`).join('') || '<tr><td class="muted">None</td></tr>'}</table>`;
  $('#refresh-orders').onclick = () => renderLoot();
  for (const b of buttons('[data-buy]')) b.onclick = () => buy(Number(b.dataset.buy));
  for (const b of buttons('[data-pay]')) b.onclick = async () => { try { const r = await api('/api/demo/pay', { method: 'POST', body: { orderId: b.dataset.pay } }); banner(r.note); } catch (e) { banner(e.message); } renderLoot(); };
}

async function buy(sku) {
  try {
    const r = await api('/api/orders', { method: 'POST', body: { sku } });
    if (S.cfg.demo || !r.txs) { banner('Order created. Pay it below.'); return renderLoot(); }
    if (!S.wallet) await connectWallet();
    $('#wstate').textContent = 'Step 1/2: approve exactly the price in your wallet…';
    await S.wallet.send(r.txs.approve);
    $('#wstate').textContent = 'Step 2/2: confirm the purchase…';
    const h = await S.wallet.send(r.txs.purchase);
    $('#wstate').textContent = `Purchase sent (${h.slice(0, 10)}…). It's credited once final; check Orders.`;
    renderLoot();
  } catch (e) { banner(e.message); }
}

async function connectWallet() {
  try {
    S.wallet = S.wallet ?? new Wallet({ chainId: S.cfg.chainId, onChange: async (why) => { banner(`Wallet ${why}. Please sign in again.`); await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); localStorage.removeItem('dcp.token'); S.token = null; await boot(); } });
    const address = await S.wallet.connect();
    $('#wstate').textContent = 'Connected. Sign the message to prove it\'s you…';
    const { message } = await api('/api/auth/nonce?address=' + address);
    const signature = await S.wallet.signMessage(message, address);
    const r = await api('/api/auth/verify', { method: 'POST', body: { message, signature } });
    S.token = r.token;
    localStorage.setItem('dcp.token', r.token);
    S.me = await api('/api/me');
    renderAcct();
    renderLoot();
  } catch (e) { banner(e.message); }
}

async function renderStatus() {
  if (practice) {
    const world = await api('/api/world');
    $('#status').innerHTML = `<h2>Browser practice</h2><p class="warn">This is an editable local save. No backend, treasury, keeper or paid content service is running here.</p><table><tr><th>Rules</th><td>Accepted engine / base content v1</td></tr><tr><th>Save location</th><td>This browser only</td></tr><tr><th>Depth gate</th><td>Floor ${world.depthGate} + unlimited Overtime</td></tr><tr><th>Token / payment authority</th><td>None</td></tr></table><p>The integrated demo includes operating history, two unattended content cycles, backups and a simulated chain. Mainnet launch remains blocked.</p>`;
    return;
  }
  const s = await api('/api/status');
  const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  $('#status').innerHTML = `<h2>Operating status</h2>${s.app.labelled ? `<p class="warn">${esc(s.app.labelled)}</p>` : ''}
    <table>
      ${row('App / chain', `${esc(s.app.version)} · ${esc(s.app.chain)} (${s.app.chainId})`)}
      ${row('Season / day / depth gate', `${s.season.id} / ${s.day + 1} / ${s.depthGate}`)}
      ${row("Today's event", `${esc(s.dailyEvent.name)}: ${esc(s.dailyEvent.text)}`)}
      ${row('Content version', `${s.content.active} (${s.content.history.length} versions)`)}
      ${row('Runway', `<span class="${s.runway.tier === 'healthy' ? 'ok' : s.runway.tier === 'low' ? 'warn' : 'bad'}">${esc(s.runway.tier)}</span> · ${dcp(s.runway.imd)} IMD · ~${s.runway.days} days paid-content runway · ~${s.runway.essentialDays} days essential`)}
      ${row('Treasury', `${dcp(s.treasury.imd)} IMD · ${dcp(s.treasury.dcp)} DCP`)}
      ${row('Prize reserve', `${dcp(s.reserve.balance)} DCP · outstanding ${dcp(s.reserve.outstanding)} · epoch cap ${dcp(s.reserve.epochCap)}`)}
      ${row('Player liabilities', `pending ${dcp(s.playerLiabilities.pending)} · rooted ${dcp(s.playerLiabilities.rooted)} · claimable ${dcp(s.playerLiabilities.claimable)}`)}
      ${row('Liquidity (simulation)', s.liquidity?.poolDcp != null ? `${dcp(s.liquidity.poolDcp)} DCP / ${dcp(s.liquidity.poolImd)} IMD in fixture pool<br>${dcp(s.liquidity.virtualImd)} virtual IMD depth (not funded liquidity). LP ownership and live depth unverified.` : 'No verified pool depth available')}
      ${row('Settlement', s.settlementHalted ? '<span class="bad">Halted — operator reconciliation required</span>' : 'Local test settlement active')}
      ${row('Keeper', s.keeper ? `${new Date(s.keeper.at).toISOString()} · ${s.keeper.results.map((r) => `<span class="${r.ok ? 'ok' : 'bad'}">${esc(r.name)}</span>`).join(' ')}` : 'not yet run')}
    </table>
    <h3>Content history</h3><table>${s.content.history.map((h) => `<tr><td>v${h.version}</td><td>${esc(h.status)}</td><td>${h.packs.length} packs</td><td>${esc(h.note ?? '')}</td></tr>`).join('')}</table>
    <h3>Ledger (7 days)</h3><p class="small">Income and expenditure, rounded to two decimals. Test balances only.</p><table>${s.spend7d.map((x) => `<tr><td>${esc(x.kind)}</td><td>${esc(x.asset)}</td><td>${Number(x.total).toFixed(2)}</td><td>${x.n}×</td></tr>`).join('') || '<tr><td class="muted">none</td></tr>'}</table>
    <h3>Epochs</h3><table>${s.epochs.map((e) => `<tr><td>${e.epoch}</td><td>${esc(e.status)}</td><td>${e.total ? dcp(e.total) : '—'}</td></tr>`).join('')}</table>
    <h3>Recent outages</h3><table>${s.outages.map((o) => `<tr><td>${esc(o.component)}</td><td>${new Date(o.started_at).toISOString()}</td><td>${esc(o.note)}</td></tr>`).join('') || '<tr><td class="ok">none</td></tr>'}</table>
    <p class="small">${s.disclaimers.map(esc).join('<br>')}</p>
    ${S.cfg.demo ? '<div class="actions"><button id="adv">⏩ Demo: advance 24h (trades, keeper, epochs, content)</button></div>' : ''}`;
  if ($('#adv')) $('#adv').onclick = async () => { await api('/api/demo/advance', { method: 'POST', body: { hours: 24 } }); renderStatus(); };
}

// ------------------------------------------------------------------ tabs / boot
for (const t of buttons('.tab')) {
  t.onclick = async () => {
    for (const x of buttons('.tab')) { x.classList.toggle('active', x === t); if (x === t) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); }
    history.replaceState(null, '', '#' + t.dataset.tab);
    for (const p of buttons('.tabpane')) p.hidden = p.id !== 'tab-' + t.dataset.tab;
    try {
      if (!S.cfg && t.dataset.tab !== 'about' && t.dataset.tab !== 'play') { banner('Choose browser practice or connect to the local server first.'); return; }
      if (t.dataset.tab === 'board') await renderBoard();
      if (t.dataset.tab === 'loot') await renderLoot();
      if (t.dataset.tab === 'status') await renderStatus();
      if (t.dataset.tab === 'play' && S.ch) renderGame();
    } catch (e) { banner(e.message); }
  };
}

$('.brand').onclick = () =>  $('[data-tab="play"]').click();
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || $('#tab-play').hidden || $('#game').hidden || document.querySelector('dialog[open]')) return;
  if ((/** @type {Element} */ (e.target)).closest('input,select,textarea,button,summary,[contenteditable=true]') || !S.ch?.pending) return;
  const map = { a: 'attack', s: 'skill', t: 'taunt', d: 'defend', p: 'potion', f: 'flee' };
  if (S.ch.pending.kind === 'combat' && map[e.key]) { e.preventDefault(); act({ type: map[e.key] }); }
  if (S.ch.pending.kind === 'offer' && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); act({ type: 'choose', index: Number(e.key) - 1 }); }
});
$('#practice').onclick = () => { localStorage.setItem('dcp.mode', 'practice'); boot(); };
$('#retry').onclick = () => boot();

async function boot() {
  if (!localStorage.getItem('dcp.adult')) {
    if (!$('#agegate').open) $('#agegate').showModal();
    $('#ageyes').onclick = () => { localStorage.setItem('dcp.adult', '1'); $('#agegate').close(); boot(); };
    $('#agegate').oncancel = (e) => e.preventDefault();
    return;
  }
  $('#connection').hidden = true;
  $('#retry').disabled = true;
  try {
    if (localStorage.getItem('dcp.mode') === 'practice') { practice ??= practiceApi(); S.charId = localStorage.getItem('dcp.practice.char'); }
    S.cfg = await api('/api/config', { retries: 0 });
    if (!S.cfg.classes) throw Error('Game server is unavailable');
    connectedOnce = !practice;
    S.classId ??= S.cfg.classes[0].id;
    $('#mode-label').textContent = practice ? 'BROWSER PRACTICE · DEVICE SAVE' : 'LOCAL INTEGRATED DEMO';
    $('#ver').textContent = `DCP ${S.cfg.app} · Build & review only`;
    const world = await api('/api/world');
    $('#worldline').textContent = `Season ${world.season.id} / Day ${world.day + 1} / Floors 1–${world.depthGate} + Overtime · ${world.event.name}`;
    await ensureSession();
    renderAcct();
    const alive = (S.me.characters ?? []).filter((c) => c.alive);
    const pick = alive.find((c) => c.id === S.charId) ?? alive[0];
    if (pick) await loadChar(pick.id); else renderNoChar();
    const tab = location.hash.slice(1);
    $(`[data-tab="${['play','board','loot','status','about'].includes(tab) ? tab : 'play'}"]`)?.click();
  } catch (e) {
    $('#connection').hidden = false;
    $('#practice').hidden = connectedOnce || !!practice;
    $('#connection-detail').textContent = (practice ? e.message : "Your server saves are unchanged. Retry the connection, or start a separate practice run saved in this browser.");
  } finally { $('#retry').disabled = false; }
}
window.addEventListener('unhandledrejection', (event) => { event.preventDefault(); banner('Action failed. ' + (event.reason?.message ?? 'Check your connection and try again.')); });
boot();
