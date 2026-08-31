const { chromium } = require('playwright');
(async () => {
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
  catch (e) { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const logs = [];
  page.on('console', m => logs.push(m.type()+': '+m.text()));
  page.on('pageerror', e => logs.push('pageerror: '+e.message));
  await page.goto('http://182.92.127.15:3000', { waitUntil: 'networkidle', timeout: 30000 });
  console.log('Title:', await page.title());
  console.log('Has difficulty select:', await page.locator('#difficultySelect').count());
  await page.fill('#nameInput', '公网测试');
  await page.click('button:has-text("创建房间")');
  await page.waitForSelector('#lobby:not(.hidden)', { timeout: 15000 });
  for (let i=0;i<3;i++) { await page.click('button:has-text("添加机器人")'); await page.waitForTimeout(200); }
  if (await page.locator('#difficultySelect').count()) {
    await page.selectOption('#difficultySelect', 'hard');
    console.log('Selected hard');
  } else {
    console.log('NO difficulty select');
  }
  await page.click('button:has-text("开始游戏")');
  await page.waitForTimeout(2000);
  console.log('Trait select visible:', await page.locator('text=身份选择阶段').count());
  console.log('Action cards:', await page.locator('#gameBody .action-card').count());
  console.log('Text visible sample:', (await page.locator('#gameBody').innerText()).slice(0,200));
  console.log('Errors:', logs.filter(l=>l.startsWith('pageerror')||l.startsWith('error')).slice(0,5));
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
