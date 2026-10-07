// Adversarial fixture only: inflated survival stats isolate fame accumulation.
import { makeApp, simplePolicy } from '../test/helpers.mjs';
import { createGuest } from '../server/src/auth.js';
import { run, one, setMeta } from '../server/src/db.js';
const app = makeApp();
setMeta(app.db, 'season', { id:1, startMs:app.now() });
const g = createGuest(app.db);
const c = app.game.createCharacter(g.accountId, {name:'Farm Probe', classId:'brawler'});
const id = c.character.id;
let { ch, row } = app.game.load(g.accountId, id);
ch.floor = 3; ch.pending = {kind:'stairs'}; ch.hp = ch.maxHp = 100000; ch.atk = 10000;
run(app.db, 'UPDATE characters SET state = ? WHERE id = ?', JSON.stringify(ch), id);
let rev = row.rev, actions = 0;
function act(action) {
 const r = app.game.act(g.accountId, {charId:id, rev, actionId:`farm-${String(actions++).padStart(6,'0')}`, action});
 ch = r.character; rev = r.rev;
}
for (let n=0;n<30;n++) {
 act({type:'overtime'});
 for (let i=0;ch.pending?.kind !== 'stairs' && i<200;i++) {
  act(ch.pending?.kind === 'combat' ? {type:'attack'} : ch.pending?.kind === 'offer' ? {type:'skip'} : simplePolicy(ch,0));
 }
 if(ch.pending?.kind !== 'stairs') throw Error('route did not finish');
}
console.log(JSON.stringify({floor:ch.floor,overtime:ch.overtime,actions,dailyFame:one(app.db,'SELECT fame FROM daily_fame WHERE account_id = ?',g.accountId).fame}));
app.db.close();
