import { test } from 'node:test';
import assert from 'node:assert/strict';
import { practiceApi, PRACTICE_KEY } from '../dist/practice.js';
function storage() { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v) }; }
const post = body => ({ method:'POST', body });

test('practice persists distinct runs and repeated actions; rejects stale edits and monetary routes', async () => {
  const store = storage(), api = practiceApi(store);
  const a = await api('/api/characters', post({ name:'Wet Audit',classId:'accountant' }));
  const b = await api('/api/characters', post({ name:'Unpaid Frog',classId:'brawler' }));
  assert.notEqual(a.seed, b.seed);
  assert.notDeepEqual(a.character.pending.offers, b.character.pending.offers);
  const body = { charId:a.character.id, rev:0, actionId:'choose-once', action:{type:'choose',index:0} };
  const chosen = await api('/api/act', post(body));
  assert.equal(chosen.character.powers.length, 1);
  assert.deepEqual(await api('/api/act', post(body)), chosen);
  await assert.rejects(api('/api/act', post({...body, action:{type:'skip'}})), /already used/);
  await assert.rejects(api('/api/act', post({...body, actionId:'stale'})), e => e.status === 409);
  const reopened = practiceApi(store);
  assert.deepEqual(await reopened('/api/character?id='+a.character.id), chosen);
  for (const route of ['/api/orders','/api/demo/claim','/api/auth/verify','/api/demo/pay']) await assert.rejects(api(route, post({})), /integrated server/);
});
test('practice rolls back illegal moves and storage failures, never silently resets corrupted saves', async () => {
  const store=storage(), api=practiceApi(store);
  const c=await api('/api/characters', post({ name:'Save Toad',classId:'paladin' }));
  const before=store.getItem(PRACTICE_KEY);
  await assert.rejects(api('/api/act', post({charId:c.character.id,rev:0,actionId:'bad',action:{type:'move',to:999}})));
  assert.equal(store.getItem(PRACTICE_KEY),before);
  const full={...store,setItem(){throw Error('quota');}};
  await assert.rejects(practiceApi(full)('/api/act',post({charId:c.character.id,rev:0,actionId:'quota',action:{type:'choose',index:0}})),/not saved/);
  assert.equal(store.getItem(PRACTICE_KEY),before);
  store.setItem(PRACTICE_KEY,'corrupt');
  await assert.rejects(api('/api/me'),/cannot be read/);
  assert.equal(store.getItem(PRACTICE_KEY),'corrupt');
});
