// 浏览器端验证: 启动无头 Chrome, 打开应用, 运行精度自检并抓取结果。
// 用法: node tools/verify.mjs [url]  (无 url 时内置静态服务器服务 dist/)
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

let url = process.argv[2];
let server = null;
if (!url) {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  server = createServer(async (req, res) => {
    try {
      let p = req.url.split('?')[0];
      if (p === '/') p = '/index.html';
      const data = await readFile(join('dist', p));
      res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((r) => server.listen(5419, '127.0.0.1', r));
  url = 'http://127.0.0.1:5419/';
}
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1400,1000',
  ],
});

const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

// 切到检测页
await page.click('.tab[data-tab="measure"]');
await new Promise((r) => setTimeout(r, 300));

// 单张扫描检测
const scanBtn = await page.$$('.controls button');
await scanBtn[0].click();
await new Promise((r) => setTimeout(r, 1500));
const meta = await page.$eval('.measure-page .meta', (el) => el.textContent);
console.log('单张检测:', meta);

// 精度自检
const buttons = await page.$$('.controls button');
await buttons[1].click();
await page.waitForFunction(
  () => document.querySelector('.selftest .spec-line') !== null,
  { timeout: 120000 }
);
const specLine = await page.$eval('.selftest .spec-line', (el) => el.textContent);
const title = await page.$eval('.selftest h3', (el) => el.textContent);
const rows = await page.$$eval('.selftest table tr', (trs) =>
  trs.map((tr) => Array.from(tr.children).map((td) => td.textContent).join(' | '))
);
console.log('\n=== ' + title + ' ===');
console.log(specLine);
for (const r of rows) console.log(r);
const cross = await page.$eval('.selftest .card', (el) => {
  const m = el.querySelector('.meta');
  return m ? m.textContent : '';
});
if (cross) console.log(cross);

// 色卡校准页残差
await page.click('.tab[data-tab="calib"]');
await new Promise((r) => setTimeout(r, 500));
const calibRows = await page.$$eval('.card table tr', (trs) =>
  trs.slice(0, 6).map((tr) => Array.from(tr.children).map((td) => td.textContent).join(': '))
);
console.log('\n=== 校准残差 ===');
for (const r of calibRows) console.log(r);

if (errors.length) {
  console.log('\n=== 控制台告警/错误 ===');
  for (const e of errors.slice(0, 10)) console.log(e);
}

await browser.close();
if (server) server.close();
