const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const outDir = path.join(__dirname, 'cards-screenshots');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (e) {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  console.log('Opening', BASE);
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('#nameInput', '卡片测试');
  await page.click('button:has-text("创建房间")');
  await page.waitForSelector('#lobby:not(.hidden)', { timeout: 15000 });

  for (let i = 0; i < 3; i++) {
    await page.click('button:has-text("添加机器人")');
    await page.waitForTimeout(300);
  }

  // 选择困难模式
  await page.selectOption('#difficultySelect', 'hard');
  await page.click('button:has-text("开始游戏")');

  // 等待身份选择
  await page.waitForSelector('text=身份选择阶段', { timeout: 15000 });
  // 选择第一个身份卡
  const firstIdentity = await page.locator('#gameBody .action-card').first();
  if (await firstIdentity.count()) {
    await firstIdentity.click();
  }
  await page.waitForTimeout(800);

  // 等待阅读阶段中策略卡出现
  await page.waitForSelector('text=策略卡', { timeout: 15000 });
  await page.screenshot({ path: path.join(outDir, '01-cards-reading.png'), fullPage: true });

  // 选择第一张策略卡
  const cardButtons = page.locator('#gameBody .action-card');
  const count = await cardButtons.count();
  console.log('Strategy card buttons:', count);
  if (count > 0) {
    await cardButtons.first().click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(outDir, '02-card-selected.png'), fullPage: true });

  console.log('Errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(err => {
  console.error('FAILED', err);
  process.exit(1);
});