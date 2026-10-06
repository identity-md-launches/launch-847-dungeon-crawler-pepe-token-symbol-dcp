// Local-only rendered verification of the finished static export and integrated demo.
// Optional external tool paths avoid committing installed dependencies.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server/src/app.js';
const modulePath = process.env.DCP_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : '../web/node_modules/playwright/index.mjs');
process.chdir(new URL('../', import.meta.url).pathname);
const artifact = resolve('artifacts'); mkdirSync(artifact,{recursive:true});
const directory = mkdtempSync(join(tmpdir(),'dcp-browser-'));
const app = createApp({ demo:true, dbPath:join(directory,'demo.sqlite'), webRoot:resolve('dist'), domain:'localhost', origin:'http://localhost', confirmations:3, econ:{minAccountAgeMs:0,minActions:5} });
const server = await app.listen(0,'127.0.0.1');
const types={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.html':'text/html','.webmanifest':'application/manifest+json'};
const staticServer=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/config'){res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Static preview has no API'}));return;}
  const file=resolve('dist', decodeURIComponent(url.pathname.replace(/^\/preview\//,'')) || 'index.html');
  if(!file.startsWith(resolve('dist')+'/')){res.writeHead(404).end();return;}
  try{res.writeHead(200,{'content-type':types[extname(file)]??'application/octet-stream'}).end(readFileSync(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>staticServer.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.DCP_CHROMIUM_PATH||undefined,args:['--no-sandbox']});
const report={date:new Date().toISOString(),browser:browser.version(),checks:[],screenshots:[],viewports:[],errors:[],resources:[],axe:[],contrast:[]};
const check=(name)=>{report.checks.push(name); console.log('PASS',name);};
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',e=>report.errors.push(e.message));
page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/api/config'))report.resources.push({url:r.url().replace(/:\d+/,':PORT'),status:r.status()});});
async function shot(name){await page.screenshot({path:join(artifact,name),fullPage:true});report.screenshots.push(name);}
async function audit(label){
  const axePath=process.env.DCP_AXE_PATH ?? resolve('web/node_modules/axe-core/axe.min.js');
  if(!axePath)return;
  await page.evaluate(readFileSync(axePath, 'utf8')); // DevTools injection; keep the site's CSP intact.
  const result=await page.evaluate(async()=>await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
  report.axe.push({label,violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})),incomplete:result.incomplete.map(v=>v.id),passes:result.passes.length});
  assert.equal(result.violations.length,0,JSON.stringify(report.axe.at(-1)));
}
async function reflow(label){
  const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1&&!e.closest('.layers')&&!e.closest('dialog:not([open])');}).map(e=>e.tagName+'.'+e.className)}));
  report.viewports.push({label,...result});assert.ok(result.scroll<=result.width+1,JSON.stringify(result));
}
try {
  await page.goto(`http://127.0.0.1:${staticServer.address().port}/preview/`);
  await page.locator('#ageyes').waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'ageyes');
  await page.keyboard.press('Tab'); assert.ok(await page.evaluate(()=>document.activeElement===document.body || document.activeElement.closest('dialog')?.id==='agegate'));
  await page.locator('#ageyes').click();
  await page.locator('#connection').waitFor({state:'visible'});
  check('Adult dialog traps focus; static outage offers an explicit practice choice');
  await page.locator('#practice').click();
  await page.locator('.class').first().waitFor();
  assert.equal(await page.locator('.class').count(),8);
  await shot('desktop-onboarding.png'); await audit('onboarding');
  for(const width of [1440,900,390,320]){await page.setViewportSize({width,height:900});await reflow('onboarding');}
  await shot('mobile-onboarding.png');
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-id=paladin]').click();
  assert.equal(await page.locator('[data-id=paladin]').getAttribute('aria-pressed'),'true');
  await page.locator('#cname').fill('Moist Gregory'); await page.locator('#cname').press('Enter');
  await page.locator('.offer').first().waitFor();
  await page.locator('.offer button').first().click();
  await page.locator('[data-to]').first().waitFor();
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('dcp.practice.v1')).characters[0]);
  await page.reload(); await page.locator('[data-to]').first().waitFor();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('dcp.practice.v1')).characters[0]),state);
  check('Class selection, keyboard creation, perk selection and reload preserve practice state');
  // UI actions only; all combat outcomes are resolved by the copied engine.
  let moves=0;
  for(let i=0;i<24;i++){
    const action=await page.evaluate(()=>{
      const d=JSON.parse(localStorage.getItem('dcp.practice.v1')).characters[0].character;
      if(!d.alive)return null;
      if(!d.pending)return '[data-to]';
      const p=d.pending.kind;
      if(p==='combat')return `[data-act*='"type":"${d.hp<d.maxHp*.3&&d.potions?'potion':d.pending.cb.skillCd===0?'skill':'attack'}"']`;
      if(p==='offer')return '.offer button';
      if(p==='quest') { const choice=d.pending.choices.find(c=>!/(pay|give|spend|donate|bribe|gold)/i.test(c.text)) ?? d.pending.choices.at(-1); return `[data-act*='"choice":"${choice.id}"']`; }
      if(p==='sponsor')return '[data-act*="decline"]';
      if(p==='rest')return '[data-act*="heal"]';
      if(p==='stairs')return d.floor>=3?'[data-act*="overtime"]':'[data-act*="descend"]';
      return '[data-act*="leave"]';
    });
    if(!action)break;
    const previous = await page.evaluate(()=>JSON.parse(localStorage.getItem('dcp.practice.v1')).characters[0].rev);
    await page.locator(action).first().click();
    assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('dcp.practice.v1')).characters[0].rev) > previous, 'UI action must advance the persisted revision: '+action+' / '+await page.locator('#banner-text').innerText()); moves++;
  }
  assert.ok(moves>=6);check(`Played ${moves} route/combat/quest actions through visible controls`);
  await shot('desktop-game.png');await audit('game');
  for(const width of [900,390,320]){await page.setViewportSize({width,height:900});await reflow('game');}
  await shot('mobile-game.png');
  await page.locator('[data-tab=board]').click(); await page.locator('#board h2').waitFor();await reflow('rankings');
  assert.match(await page.locator('#board').innerText(),/Moist Gregory/);
  const before=await page.evaluate(()=>localStorage.getItem('dcp.practice.v1'));
  await page.keyboard.press('a');await page.keyboard.press('1');
  assert.equal(await page.evaluate(()=>localStorage.getItem('dcp.practice.v1')),before);
  await page.locator('[data-tab=loot]').click();assert.match(await page.locator('#rewards').innerText(),/Token rewards are off/);await reflow('practice shop');
  await page.locator('[data-tab=status]').click();assert.match(await page.locator('#status').innerText(),/No backend/);await reflow('practice status');
  await page.locator('[data-tab=about]').click();await reflow('field guide');
  check('Rankings, shop, operations and rules work; background hotkeys cannot mutate a run');
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('#ageyes').click();await page.locator('.class').first().waitFor();
  const recovery=(await page.locator('#banner-text').innerText()).split(': ').at(-1);
  assert.ok(recovery.length>10);
  await page.locator('#dismiss-banner').click();
  await page.locator('#cname').fill('Server Gregory');await page.locator('#create').click();await page.locator('.offer button').first().click();
  await page.locator('[data-tab=loot]').click();await page.locator('#demolink').click();await page.locator('[data-buy]').first().waitFor();
  await page.locator('[data-buy]').first().click();await page.locator('[data-pay]').first().click();
  app.chain.mine(5);await app.keeper.tick(app.now());
  await page.locator('[data-tab=status]').click();await page.locator('#status h2').waitFor();
  await page.locator('[data-tab=loot]').click();await page.waitForFunction(()=>document.querySelector('#shop')?.textContent.includes('credited'));
  check('Integrated server: guest create, character save, simulated wallet, order, payment and finalized inventory credit');
  await page.locator('[data-tab=status]').click();await page.locator('#status h2').waitFor();await shot('integrated-status.png');await audit('integrated status');
  for(const tab of ['loot','status','board','about']){await page.setViewportSize({width:320,height:900});await page.locator(`[data-tab=${tab}]`).click();await page.locator(`#tab-${tab}`).waitFor({state:'visible'});await reflow('integrated '+tab);}
  await page.locator('#recoverBtn').click();await page.locator('#recovery-code').fill('wrong-code');await page.locator('#recovery-form button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#recovery-error').textContent.length>0);assert.equal(await page.evaluate(()=>document.activeElement.id),'recovery-code');
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'recoverBtn');
  check('Recoverable sign-in error; Escape restores dialog focus');
  const device=await browser.newPage();await device.goto(`http://127.0.0.1:${server.address().port}/`);await device.locator('#ageyes').click();await device.locator('#recoverBtn').click();await device.locator('#recovery-code').fill(recovery);await device.locator('#recovery-form button[type=submit]').click();await device.waitForFunction(()=>document.querySelector('#sheet')?.textContent.includes('Server Gregory'));await device.close();
  check('Second browser context recovers the server account and saved Crawler');
  await page.setViewportSize({width:720,height:500});await page.locator('[data-tab=play]').click();await reflow('200% equivalent CSS viewport');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.tab').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
  await page.emulateMedia({forcedColors:'active'});await page.keyboard.press('Tab');await page.locator('[data-tab=play]').focus();assert.notEqual(await page.locator('[data-tab=play]').evaluate(e=>getComputedStyle(e).outlineStyle),'none');
  check('Reduced motion removes transitions; forced colors retains focus; 720px reflow');
  await page.emulateMedia({forcedColors:'none', reducedMotion:'reduce'});
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  report.contrast=await page.evaluate(()=>{
    const luminance=rgb=>{const a=rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return a[0]*.2126+a[1]*.7152+a[2]*.0722;};
    return ['body','.worldline','.tab.active','.sheet .small','#recoverBtn'].map(selector=>{
      const el=document.querySelector(selector),s=getComputedStyle(el);let bg=el;
      while(bg.parentElement&&getComputedStyle(bg).backgroundColor==='rgba(0, 0, 0, 0)')bg=bg.parentElement;
      const foreground=s.color,background=getComputedStyle(bg).backgroundColor,a=luminance(foreground),b=luminance(background);return{selector,foreground,background,ratio:Math.round((Math.max(a,b)+.05)/(Math.min(a,b)+.05)*100)/100};
    });
  });
  assert.equal(report.errors.length,0,report.errors.join('\n'));
  // The deliberately invalid recovery request is an expected HTTP 404, not a failed asset.
  assert.ok(report.resources.every(r=>r.url.endsWith('/api/auth/recover')),JSON.stringify(report.resources));
  report.result='passed';
} catch(error) {report.result='failed';report.failure=String(error.stack);throw error;}
finally { writeFileSync(join(artifact,'browser-checks.json'),JSON.stringify(report,null,2)+'\n');await browser.close();await new Promise(r=>server.close(r));await new Promise(r=>staticServer.close(r));app.db.close();rmSync(directory,{recursive:true,force:true}); }
