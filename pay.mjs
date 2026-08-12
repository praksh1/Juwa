import { chromium } from 'playwright';
import { press, login } from './lib.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 220)));
await login(p);
await press(p, p.getByLabel(/^Juwa Classic,/));
await p.waitForTimeout(2200);
await p.screenshot({ path: '/tmp/pay-intro.png' });
const txt = await p.locator('body').innerText();
console.log('has decimals like 43.96 or 0.36:', /\b\d+\.\d{2}\b(?!%)/.test(txt.replace(/RTP [\d.]+%/g,'')));
const play = p.getByText('PLAY', { exact: true });
if (await play.count()) { await press(p, play); await p.waitForTimeout(1000); }
await press(p, p.getByLabel('Paytable'));
await p.waitForTimeout(900);
await p.screenshot({ path: '/tmp/pay-sheet.png' });
const sheet = await p.locator('body').innerText();
console.log('mentions current bet:', /current bet of/.test(sheet));
console.log(sheet.split('\n').filter(l=>l.trim()).slice(0,18).join(' | '));
await b.close();
