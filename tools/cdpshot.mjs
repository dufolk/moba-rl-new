// Decode the newest CDP Page.captureScreenshot response into shots/latest.jpg (dev helper).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = path.join(os.homedir(), '.cursor', 'browser-logs');
const files = fs.readdirSync(dir).filter((f) => f.startsWith('cdp-response-Page.captureScreenshot')).sort();
const j = JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
const data = j.data || (j.result && j.result.data);
fs.mkdirSync('shots', { recursive: true });
const out = path.join('shots', (process.argv[2] || 'latest') + '.jpg');
fs.writeFileSync(out, Buffer.from(data, 'base64'));
console.log(path.resolve(out));
