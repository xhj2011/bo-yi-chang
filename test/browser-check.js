const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://182.92.127.15:3000';
const outDir = path.join(__dirname, 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (e) {
    console.log('Chrome channel failed, trying Edge...');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  console.log('Opening', BASE);
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.screenshot({ path: path.join(outDir, '01-landing-desktop.png'), fullPage: true });

  // 创建房间
  await page.fill('#nameInput', '测试玩家');
  await page.click('button:has-text("创建房间")');
  await page.waitForSelector('#lobby:not(.hidden)', { timeout: 15000 });

  // 添加3个机器人
  for (let i = 0; i < 3; i++) {
    await page.click('button:has-text("添加机器人")');
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: path.join(outDir, '02-lobby.png'), fullPage: true });

  // 开始游戏
  await page.click('button:has-text("开始游戏")');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // 如果是阅读阶段，点“我已读完”
  const readBtn = await page.$('button:has-text("我已读完")');
  if (readBtn) {
    await readBtn.click();
    await page.waitForTimeout(500);
    console.log('Clicked 我已读完');
  }
  await page.screenshot({ path: path.join(outDir, '03-game-desktop.png'), fullPage: true });
  console.log('Desktop screenshots done');

  // 手机端截图
  const iphone = devices['iPhone 13'];
  const mctx = await browser.newContext({ ...iphone });
  const mpage = await mctx.newPage();
  await mpage.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await mpage.screenshot({ path: path.join(outDir, '04-landing-mobile.png'), fullPage: true });
  await mctx.close();

  console.log('Mobile screenshot done');
  console.log('Screenshots saved to:', outDir);
  console.log('Errors:', errors.length ? errors : 'none');

  await browser.close();
})().catch(err => {
  console.error('FAILED', err);
  process.exit(1);
});