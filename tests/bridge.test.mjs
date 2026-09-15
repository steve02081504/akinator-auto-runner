import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { chromium } from 'playwright-core'

import { buildSite, locateChromium, startStaticServer, USERSCRIPT } from './helpers.mjs'
import { startMockServer } from './mock-akinator.mjs'

/** @type {import('playwright-core').Browser} */
let browser
/** @type {import('playwright-core').BrowserContext} */
let context
/** @type {Awaited<ReturnType<typeof startStaticServer>>} */
let site
/** @type {Awaited<ReturnType<typeof startMockServer>>} */
let mock

test.before(async () => {
	site = await startStaticServer(await buildSite(), '/akinator-auto-runner')
	mock = await startMockServer()
	browser = await chromium.launch({ executablePath: await locateChromium() })
	context = await browser.newContext()
	// 把油猴脚本注入每一个文档，等价于用户在浏览器里装好脚本后打开站点。
	await context.addInitScript({ content: readFileSync(USERSCRIPT, 'utf8') })
	// akinator 会拒绝被 iframe 嵌入，站点改用 window.open；这里把弹窗请求转给模拟服务器。
	await context.route('https://en.akinator.com/**', async (route) => {
		const request = route.request()
		const { pathname, search } = new URL(request.url())
		const headers = request.headers()
		const response = await fetch(`${mock.origin}${pathname}${search}`, {
			method: request.method(),
			headers: headers['content-type'] ? { 'content-type': headers['content-type'] } : {},
			body: ['GET', 'HEAD'].includes(request.method()) ? undefined : request.postData() ?? undefined,
		})
		await route.fulfill({
			status: response.status,
			headers: { 'content-type': response.headers.get('content-type') ?? 'text/plain; charset=utf-8' },
			body: await response.text(),
		})
	})
})

test.after(async () => {
	await context?.close()
	await browser?.close()
	await mock?.close()
	await site?.close()
})

/**
 * 打开站点并点击「连接」，返回站点页与弹出的 akinator 页。
 * @param {import('playwright-core').Page} page 站点页
 * @returns {Promise<import('playwright-core').Page>} akinator 弹窗
 */
async function connect(page) {
	await page.goto(`${site.origin}/`)
	const [popup] = await Promise.all([
		page.waitForEvent('popup', { timeout: 20000 }),
		(async () => {
			await page.locator('.tab[data-tab="run"]').click()
			await page.locator('#connect').click()
		})(),
	])
	await page.waitForFunction(() => document.getElementById('connection')?.classList.contains('is-connected'), null, { timeout: 20000 })
	await popup.waitForFunction(() => !!window.__akinatorAutoRunnerApp, null, { timeout: 20000 })
	// 真实环境里脚本靠 @match 只跑在 akinator 页；这里全文档注入，站点页上的那份
	// 会挂出面板挡住站点控件，测试里先把它移除。
	await page.evaluate(() => document.getElementById('akinator-auto-runner')?.remove())
	return popup
}

test('弹窗桥：连接后站点检测到脚本并下发初始化数据', async () => {
	const page = await context.newPage()
	try {
		const popup = await connect(page)
		assert.equal(await page.locator('#connection').getAttribute('data-i18n'), 'app.connected')
		assert.equal(await page.locator('#install-hint').isVisible(), false, '连上后不再显示安装提示')
		assert.equal(await popup.evaluate(() => window.__akinatorAutoRunner?.top), false, '弹窗里的脚本应处于「站点驱动」模式')
		// 站点在 pong 后下发 init（站点侧题库名为 packs），弹窗脚本载入后库名会跟着变。
		await popup.waitForFunction(() => window.__akinatorAutoRunnerApp.store.db.name === 'packs', null, { timeout: 20000 })
	} finally {
		await page.close()
	}
})

test('弹窗桥：弹窗内跳转后桥仍然连着（referrer 变成 akinator 自己）', async () => {
	const page = await context.newPage()
	try {
		const popup = await connect(page)
		// 真实场景是「开始」时在弹窗内 POST /game 跳到游戏页；这里用一次同源跳转复现。
		await popup.goto('https://en.akinator.com/theme-selection')
		await popup.waitForFunction(() => !!window.__akinatorAutoRunnerApp, null, { timeout: 20000 })
		assert.equal(await popup.evaluate(() => window.__akinatorAutoRunner?.top), false, '跳转后弹窗里的脚本仍应是「站点驱动」模式')
		assert.equal(await popup.locator('#akinator-auto-runner').count(), 0, '站点驱动的弹窗不挂脚本面板')
	} finally {
		await page.close()
	}
})

test('弹窗桥：站点能远程驱动一次录制运行', async () => {
	const page = await context.newPage()
	try {
		mock.setScenario([{ kind: 'defeat' }])
		const popup = await connect(page)
		await page.locator('#run-mode [data-mode="record"]').click()
		await page.locator('#run-name').fill('BridgeRec')
		await page.locator('#start-run').click()
		// 站点把脚本发来的「需要作答」渲染成按钮，作答再经 postMessage 回传给脚本。
		await page.locator('#run-question [data-answer]').first().click()
		await popup.waitForFunction(() => window.__akinatorAutoRunnerApp.lastSession?.running === false, null, { timeout: 20000 })
		const answered = await popup.evaluate(() => {
			const app = window.__akinatorAutoRunnerApp
			const character = app.store.listCharacters({}).find((item) => item.name === 'BridgeRec')
			return Object.keys(character?.answers ?? {}).length
		})
		assert.ok(answered >= 1, `站点驱动应录到答案，实际 ${answered}`)
	} finally {
		await page.close()
	}
})

test('弹窗桥：站点能显示自动作答倒计时并远程干预', async () => {
	const page = await context.newPage()
	try {
		mock.setScenario([{ kind: 'defeat' }])
		const popup = await connect(page)
		// 先录一局，把 mock 的首题答案写进题库。
		await page.locator('#run-mode [data-mode="record"]').click()
		await page.locator('#run-name').fill('BridgeDelay')
		await page.locator('#start-run').click()
		await page.locator('#run-question [data-answer]').first().click()
		await popup.waitForFunction(() => window.__akinatorAutoRunnerApp.lastSession?.running === false, null, { timeout: 20000 })
		// 再回放该角色：首题已有记录，会先倒计时再自动作答。
		await page.locator('#run-mode [data-mode="replay"]').click()
		await page.locator('#run-character').selectOption({ label: 'BridgeDelay' })
		await page.locator('#start-run').click()
		await page.locator('#run-delay .countdown').waitFor({ state: 'visible', timeout: 20000 })
		// 倒计时期间改选「否」→ 站点弹出「纠正 / 追加」，选追加。
		await page.locator('#run-question [data-answer="1"]').click()
		await page.locator('#run-delay [data-intervene="append"]').waitFor({ state: 'visible', timeout: 20000 })
		await page.locator('#run-delay [data-intervene="append"]').click()
		await popup.waitForFunction(() => window.__akinatorAutoRunnerApp.lastSession?.running === false, null, { timeout: 20000 })
		const result = await popup.evaluate(() => {
			const app = window.__akinatorAutoRunnerApp
			const character = app.store.listCharacters({}).find((item) => item.name === 'BridgeDelay')
			const key = Object.keys(character?.answers ?? {}).find((item) => item.includes('mock question'))
			return { key, weights: key ? character.answers[key].weights : [] }
		})
		assert.ok(result.key, '角色应包含该问题')
		assert.ok(Number(result.weights?.[1] ?? 0) >= 1, '站点上的改选应经 postMessage 写回脚本（追加权重）')
	} finally {
		await page.close()
	}
})

test('弹窗桥：关掉 akinator 窗口后回到未连接', async () => {
	const page = await context.newPage()
	try {
		const popup = await connect(page)
		await popup.close()
		await page.waitForFunction(() => document.getElementById('connection')?.classList.contains('is-connected') === false, null, { timeout: 10000 })
		assert.equal(await page.locator('#install-hint').isVisible(), true, '窗口关掉后应重新提示安装 / 连接')
	} finally {
		await page.close()
	}
})
