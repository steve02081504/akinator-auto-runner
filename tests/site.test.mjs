import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chromium } from 'playwright-core'

import { buildSite, locateChromium, startStaticServer } from './helpers.mjs'

/** @type {import('playwright-core').Browser} */
let browser
/** @type {Awaited<ReturnType<typeof startStaticServer>>} */
let site

test.before(async () => {
	site = await startStaticServer(await buildSite())
	browser = await chromium.launch({ executablePath: await locateChromium() })
})

test.after(async () => {
	await browser?.close()
	await site?.close()
})

test('站点：加载云端题库并渲染角色', async () => {
	const page = await browser.newPage()
	try {
		await page.goto(`${site.origin}/`)
		await page.waitForFunction(() => (document.getElementById('character-grid')?.textContent ?? '').includes('龙胆'), null, { timeout: 15000 })
		const cards = await page.locator('.character-card').count()
		assert.ok(cards >= 1, `应渲染内置角色，实际 ${cards}`)
		const text = await page.locator('#character-grid').innerText()
		assert.ok(text.includes('龙胆'))
		const regions = await page.locator('#region-filter option').allTextContents()
		assert.ok(regions.includes('cn'))
	} finally {
		await page.close()
	}
})

test('站点：搜索忽略中圆点 / 空白 / 全半角差异', async () => {
	const page = await browser.newPage()
	try {
		await page.goto(`${site.origin}/`)
		await page.waitForSelector('.character-card', { timeout: 15000 })
		for (const query of ['龙胆', '阿芙萝黛蒂', '龙胆·阿芙萝黛蒂', '龙胆 阿芙萝黛蒂']) {
			await page.fill('#search', query)
			await page.waitForTimeout(50)
			assert.equal(await page.locator('.character-card').count(), 1, `「${query}」应命中内置角色`)
		}
		await page.fill('#search', '不存在的角色')
		await page.waitForTimeout(50)
		assert.equal(await page.locator('.character-card').count(), 0)
	} finally {
		await page.close()
	}
})

test('站点：广告位可展示与关闭', async () => {
	const page = await browser.newPage()
	try {
		await page.goto(`${site.origin}/`)
		await page.locator('#ad-slot .aki-card').waitFor({ state: 'visible', timeout: 15000 })
		const href = await page.locator('#ad-slot .aki-card-body').getAttribute('href')
		assert.ok(href?.includes('github.com/steve02081504/fount'), `广告应指向 fount，实际 ${href}`)
		await page.locator('#ad-slot [data-ad-action="close"]').click()
		assert.equal(await page.locator('#ad-slot .aki-card').count(), 0, '关闭后广告应消失')
	} finally {
		await page.close()
	}
})

test('站点：hero 统计随题库更新', async () => {
	const page = await browser.newPage()
	try {
		await page.goto(`${site.origin}/`)
		await page.waitForFunction(() => Number(document.getElementById('stat-characters')?.textContent ?? '0') >= 1, null, { timeout: 15000 })
		const answers = Number(await page.locator('#stat-answers').innerText())
		const regions = Number(await page.locator('#stat-regions').innerText())
		assert.ok(Number.isFinite(answers) && answers >= 0, `应统计答案数，实际 ${answers}`)
		assert.ok(regions >= 1, `应统计区域数，实际 ${regions}`)
	} finally {
		await page.close()
	}
})

test('站点：录制模式默认新建角色，选定已有角色后改为续录', async () => {
	const page = await browser.newPage()
	try {
		await page.goto(`${site.origin}/`)
		await page.locator('.tab[data-tab="run"]').click()
		await page.waitForFunction(() => document.querySelectorAll('#run-character option').length > 0, null, { timeout: 15000 })
		// 没显式选过角色：切到录制默认「新建角色」，显示名字输入。
		await page.locator('#run-mode [data-mode="record"]').click()
		assert.equal(await page.locator('#run-character').inputValue(), '', '未选角色时录制默认新建')
		assert.equal(await page.locator('#run-name-field').isVisible(), true, '新建角色应显示名字输入')
		assert.ok((await page.locator('#run-mode-hint').innerText()).length > 0, '应显示模式说明')
		// 显式选定已有角色后再切到录制：续录该角色，不再显示名字输入。
		await page.locator('#run-character').selectOption({ index: 1 })
		await page.locator('#run-mode [data-mode="replay"]').click()
		await page.locator('#run-mode [data-mode="record"]').click()
		assert.ok((await page.locator('#run-character').inputValue()).length > 0, '应保留已选角色')
		assert.equal(await page.locator('#run-name-field').isVisible(), false, '续录已有角色时不显示名字输入')
	} finally {
		await page.close()
	}
})

test('站点：日志工具条可下载报告', async () => {
	const page = await browser.newPage()
	try {
		await page.goto(`${site.origin}/`)
		await page.locator('.tab[data-tab="run"]').click()
		const button = page.locator('#logs-download')
		await button.waitFor({ state: 'visible', timeout: 15000 })
		const [download] = await Promise.all([
			page.waitForEvent('download', { timeout: 15000 }),
			button.click(),
		])
		assert.ok(download.suggestedFilename().startsWith('akinator-auto-runner-logs-'), `文件名应带前缀，实际 ${download.suggestedFilename()}`)
		await download.delete()
	} finally {
		await page.close()
	}
})

test('站点：未安装脚本时显示安装提示', async () => {
	const page = await browser.newPage()
	try {
		await page.goto(`${site.origin}/`)
		await page.locator('.tab[data-tab="run"]').click()
		const hint = page.locator('#install-hint')
		await hint.waitFor({ state: 'visible', timeout: 15000 })
		const installHref = await page.locator('#install').getAttribute('href')
		assert.ok(installHref?.endsWith('akinator-auto-runner.user.js'), `安装链接指向脚本，实际 ${installHref}`)
	} finally {
		await page.close()
	}
})

test('站点：切换语言会本地化界面文案', async () => {
	const page = await browser.newPage()
	try {
		await page.goto(`${site.origin}/`)
		await page.locator('#locale-select').waitFor({ state: 'visible', timeout: 15000 })
		await page.locator('#locale-select').selectOption('zh-CN')
		const brand = await page.locator('h1').innerText()
		assert.ok(brand.includes('Akinator'), `中文标题，实际 ${brand}`)
		const runTab = await page.locator('.tab[data-tab="run"]').innerText()
		assert.equal(runTab.trim(), '运行')
		assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN')
		await page.locator('#locale-select').selectOption('en-UK')
		assert.equal((await page.locator('.tab[data-tab="run"]').innerText()).trim(), 'Run')
	} finally {
		await page.close()
	}
})

test('站点：主题切换写入 data-theme 并持久化', async () => {
	const page = await browser.newPage()
	try {
		await page.goto(`${site.origin}/`)
		await page.locator('#toggle-theme').waitFor({ state: 'visible', timeout: 15000 })
		await page.evaluate(() => localStorage.removeItem('akinator-auto-runner:theme'))
		await page.locator('#toggle-theme').click()
		const theme = await page.locator('html').getAttribute('data-theme')
		assert.ok(theme === 'dark' || theme === 'light', `data-theme 应为具体明暗，实际 ${theme}`)
		assert.equal(await page.evaluate(() => localStorage.getItem('akinator-auto-runner:theme')), theme)
	} finally {
		await page.close()
	}
})

test('站点：挂在项目子路径下也不缺资源（GitHub Pages 项目站场景）', async () => {
	const subSite = await startStaticServer(await buildSite(), '/akinator-auto-runner')
	const page = await browser.newPage()
	try {
		/** @type {string[]} */
		const failures = []
		page.on('response', (response) => {
			if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`)
		})
		await page.goto(`${subSite.origin}/`)
		await page.waitForFunction(() => (document.getElementById('character-grid')?.textContent ?? '').includes('龙胆'), null, { timeout: 15000 })
		assert.deepEqual(failures, [], `子路径下不应有资源加载失败：${failures.join(' | ')}`)
	} finally {
		await page.close()
		await subSite.close()
	}
})
