const { chromium } = require('playwright');
(async () => {
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
  catch (e) { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.fill('#nameInput', '情报测试');
  await page.click('button:has-text("创建房间")');
  await page.waitForSelector('#lobby:not(.hidden)');
  for (let i=0;i<3;i++) { await page.click('button:has-text("添加机器人")'); await page.waitForTimeout(200); }
  await page.selectOption('#difficultySelect', 'hard');
  await page.click('button:has-text("开始游戏")');
  await page.waitForSelector('text=身份选择阶段');
  await page.locator('#gameBody .action-card').first().click();
  await page.waitForTimeout(400);
  const skillCards = page.locator('#gameBody .action-card');
  await skillCards.nth(0).click();
  await skillCards.nth(1).click();
  await page.waitForTimeout(200);
  const confirmBtn = page.locator('button:has-text("确认主动技能")');
  if (await confirmBtn.count()) await confirmBtn.first().click();
  await page.waitForTimeout(800);

  // 找公布身份按钮
  const pubBtn = page.locator('button:has-text("公布身份")');
  if (await pubBtn.count()) {
    await pubBtn.first().click();
    await page.waitForTimeout(800);
    console.log('Clicked 公布身份');
  } else {
    console.log('NO 公布身份 button');
  }

  // 检查情报板是否出现
  const boardVisible = await page.locator('#infoBoard').evaluate(el => !el.classList.contains('hidden')).catch(() => false);
  console.log('InfoBoard visible:', boardVisible);
  const boardText = await page.locator('#infoBoardList').innerText().catch(() => '');
  console.log('InfoBoard text:', boardText.trim() || '(empty)');
  console.log('Errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });