// Dev harness: drive the client in headless Edge/Chrome and capture screenshots + console errors.
// Usage: node tools/shot.mjs "goto / ;; click #start ;; wait 3000 ;; shot play ;; key q ;; rclick 800 400"
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8137';
const W = Number(process.env.W || 1600), H = Number(process.env.H || 900);
const steps = (process.argv[2] || 'goto / ;; wait 2000 ;; shot menu').split(';;').map((s) => s.trim()).filter(Boolean);

fs.mkdirSync('shots', { recursive: true });
const browser = await chromium.launch({
  channel: process.env.CHANNEL || 'msedge',
  headless: process.env.HEADED ? false : true,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => { if (m.text().includes('Failed to load resource')) return; if (m.text().includes('X4122')) return; if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('[dbg]')) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) logs.push(`[http ${r.status()}] ${r.url()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack || e.message}`));

for (const step of steps) {
  const [cmd, ...rest] = step.split(/\s+/);
  const arg = rest.join(' ');
  switch (cmd) {
    case 'goto': await page.goto(BASE + arg); break;
    case 'click': await page.click(arg); break;
    case 'wait': await page.waitForTimeout(Number(arg)); break;
    case 'shot': await page.screenshot({ path: `shots/${arg}.png` }); console.log('shot', `shots/${arg}.png`); break;
    case 'key': await page.keyboard.press(arg); break;
    case 'down': await page.keyboard.down(arg); break;
    case 'up': await page.keyboard.up(arg); break;
    case 'move': { const [x, y] = rest.map(Number); await page.mouse.move(x, y); break; }
    case 'lclick': { const [x, y] = rest.map(Number); await page.mouse.click(x, y); break; }
    case 'rclick': { const [x, y] = rest.map(Number); await page.mouse.click(x, y, { button: 'right' }); break; }
    case 'rclickat': { const [x, y] = await page.evaluate(arg); await page.mouse.move(x, y); await page.mouse.click(x, y, { button: 'right' }); console.log('rclickat', x.toFixed(0), y.toFixed(0)); break; }
    case 'eval': console.log('eval', JSON.stringify(await page.evaluate(arg))); break;
    default: console.log('unknown step', step);
  }
}
const counts = new Map();
for (const l of logs) counts.set(l, (counts.get(l) || 0) + 1);
console.log(counts.size ? [...counts].map(([l, n]) => (n > 1 ? `(x${n}) ` : '') + l).join('\n') : '(no console errors)');
await browser.close();
