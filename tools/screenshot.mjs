// 截取检测页界面用于 README
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const data = await readFile(join('dist', p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(5423, '127.0.0.1', r));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1600 });
await page.goto('http://127.0.0.1:5423/', { waitUntil: 'networkidle0' });
await page.click('.tab[data-tab="measure"]');
await page.evaluate(() => {
  const sel = document.querySelectorAll('.controls select')[1];
  sel.selectedIndex = 5; // 四色综合偏差
  sel.dispatchEvent(new Event('change'));
});
const btns = await page.$$('.controls button');
await btns[0].click();
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: 'docs/measure-page.png' });
await browser.close();
server.close();
console.log('saved docs/measure-page.png');
