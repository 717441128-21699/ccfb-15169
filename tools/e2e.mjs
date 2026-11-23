// 端到端验证: 各页面交互 + 精度自检
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
    res.end('not found');
  }
});
await new Promise((r) => server.listen(5421, '127.0.0.1', r));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:5421/', { waitUntil: 'networkidle0' });

// 检测页: 连扫 3 张(不同场景)
await page.click('.tab[data-tab="measure"]');
for (let i = 0; i < 3; i++) {
  await page.evaluate((idx) => {
    const sel = document.querySelectorAll('.controls select')[1];
    sel.selectedIndex = idx;
    sel.dispatchEvent(new Event('change'));
  }, i + 1);
  const btns = await page.$$('.controls button');
  await btns[0].click();
  await new Promise((r) => setTimeout(r, 900));
}
const meta = await page.$eval('.measure-page .meta', (el) => el.textContent);
console.log('检测页:', meta);
const advice = await page.$eval('.advice', (el) => el.textContent.slice(0, 120));
console.log('调墨建议:', advice);

// 机台页: 应有检测记录
await page.click('.tab[data-tab="press"]');
await new Promise((r) => setTimeout(r, 300));
const pressInfo = await page.$eval('.press-card', (el) => el.textContent.slice(0, 160));
console.log('\n机台页首卡:', pressInfo);

// 机台页 -> 去检测 跳转
const goBtn = await page.$('.press-card button.primary');
await goBtn.click();
await new Promise((r) => setTimeout(r, 300));
const activeTab = await page.$eval('.tab.active', (el) => el.textContent);
console.log('点击"去检测"后当前页:', activeTab);

// 趋势页: 画布应有内容
await page.click('.tab[data-tab="trend"]');
await new Promise((r) => setTimeout(r, 400));
const hasPixels = await page.evaluate(() => {
  const c = document.querySelector('.trend-chart');
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
  return false;
});
console.log('趋势图已绘制:', hasPixels);

// 校准页: 重新校准
await page.click('.tab[data-tab="calib"]');
await new Promise((r) => setTimeout(r, 300));
const recalBtn = await page.$$('.controls button');
await recalBtn[0].click();
await new Promise((r) => setTimeout(r, 800));
const calibInfo = await page.$$eval('.card table td', (tds) =>
  tds.slice(0, 6).map((t) => t.textContent).join(' | ')
);
console.log('\n重新校准后:', calibInfo);

if (errors.length) {
  console.log('\n页面错误:');
  errors.forEach((e) => console.log(' ', e));
} else {
  console.log('\n无页面错误');
}

await browser.close();
server.close();
