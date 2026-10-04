/** Browser regression against a running demo Vite server; never connects to a user profile. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

// Accept an external Playwright installation without adding it to the shipped renderer.
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.LING_PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const origin = process.env.LING_DEMO_URL || 'http://127.0.0.1:5183'
const fixture = `
import { mountLingApp } from '/src/client.tsx';
import { createDemoRuntimeAdapter } from '/src/runtime/demo-adapter.ts';
import '/src/styles.css';
window.dshDesktop = {};
HTMLElement.prototype.send = () => {};
const runtime = createDemoRuntimeAdapter();
const dispatch = runtime.dispatch;
let fail = true;
window.commands = [];
runtime.dispatch = async command => {
  window.commands.push(command);
  if (fail && command.type === 'task.create') {
    fail = false;
    return {accepted:false, requestId:command.requestId, reason:'runtime-unavailable', message:'Annotation retry fixture', retryable:true};
  }
  return dispatch(command);
};
mountLingApp(document.getElementById('root'), runtime);
`

try {
  for (const entry of ['browser', 'composer']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(10000)
    await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: fixture }))
    await page.goto(origin)
    await page.getByRole('button', { name: '新任务', exact: true }).click()
    await page.getByRole('button', { name: '展开工作面', exact: true }).click()
    await page.getByRole('button', { name: '添加标签页', exact: true }).click()
    await page.getByRole('menuitem', { name: '打开内置浏览器', exact: true }).click()
    const panel = page.getByRole('region', { name: '内置浏览器', exact: true })
    await panel.getByRole('textbox', { name: '网页地址', exact: true }).fill('https://example.org')
    await page.keyboard.press('Enter')
    await panel.getByRole('button', { name: '注释', exact: true }).click()
    // Chromium has no Electron webview; inject only the guest's element-selection event.
    await page.locator('webview').evaluate(element => {
      const event = new Event('ipc-message')
      event.channel = 'ling-browser-element-selected'
      event.args = [{ element: { selector: '#target', tagName: 'h1', text: 'Fixture', id: 'target', className: '', role: '', ariaLabel: '', href: '', rect: { x: 20, y: 20, width: 200, height: 30 } } }]
      element.dispatchEvent(event)
    })
    await panel.getByRole('textbox', { name: '网页注释评论', exact: true }).fill('Keep annotation on failure')
    await page.keyboard.press('Enter')
    await page.getByText('网页注释 1', { exact: true }).waitFor()
    const sender = entry === 'browser' ? panel : page.locator('.composer')
    await sender.getByRole('button', { name: '发送', exact: true }).click()
    await page.getByText('Annotation retry fixture', { exact: true }).waitFor()
    await page.getByText('网页注释 1', { exact: true }).waitFor()
    assert.equal(await panel.getByRole('button', { name: '清空当前页面批注', exact: true }).isEnabled(), true)
    assert.equal(await page.evaluate(() => window.commands.filter(command => command.type === 'task.create').length), 1, 'Failure must not dispatch an automatic retry')
    await page.getByRole('button', { name: '重试', exact: true }).click()
    await page.getByText('网页注释 1', { exact: true }).waitFor({ state: 'hidden' })
    const commands = await page.evaluate(() => window.commands.filter(command => command.type === 'task.create'))
    assert.equal(commands.length, 2)
    assert.equal(commands[1].prompt, commands[0].prompt)
    assert.match(commands[1].prompt, /Keep annotation on failure/)
    console.log(`PASS ${entry}: one failed request, retained annotation, explicit retry, clear after acceptance`)
    await page.close()
  }
} finally {
  await browser.close()
}
