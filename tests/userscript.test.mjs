import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

import { chromium } from 'playwright-core'

import { USERSCRIPT, ensureBuilt, locateChromium, root } from './helpers.mjs'
import { startMockServer } from './mock-akinator.mjs'

/** @type {import('playwright-core').Browser} */
let browser
/** @type {Awaited<ReturnType<typeof startMockServer>>} */
let mock

test.before(async () => {
	ensureBuilt()
	mock = await startMockServer()
	browser = await chromium.launch({ executablePath: await locateChromium() })
})

test.after(async () => {
	await browser?.close()
	await mock?.close()
})

/**
 * 打开一个注入了用户脚本的页面。
 * @param {object[]} scenario 剧本
 * @param {(() => void) | { path: string }} [init] 额外的初始化脚本
 * @param {string} [path] 打开的路径
 * @returns {Promise<import('playwright-core').Page>} 页面
 */
async function openPage(scenario, init, path = '/') {
	mock.setScenario(scenario)
	const context = await browser.newContext()
	const page = await context.newPage()
	if (init) await page.addInitScript(init)
	await page.addInitScript({ path: USERSCRIPT })
	await page.goto(`${mock.origin}${path}`)
	await page.waitForFunction(() => !!window.__akinatorAutoRunnerApp, null, { timeout: 20000 })
	return page
}

/**
 * 在既有 context 里再开一个注入了用户脚本的页面（共享 IndexedDB 里的题库）。
 *
 * 页面驱动下「一局 = 一次 akinator 游戏」：同一页面上再开一局会刷新页面并由
 * 「待运行」机制续跑。需要在开跑前装好监听器（录制 / 延时 / 干预）的用例，改用
 * 另开一页把第二局跑在干净的游戏页上，避免监听器随刷新丢失。
 * @param {import('playwright-core').BrowserContext} context 上下文
 * @param {object[]} scenario 剧本
 * @param {string} [path] 路径
 * @returns {Promise<import('playwright-core').Page>} 页面
 */
async function openPageInContext(context, scenario, path = '/') {
	mock.setScenario(scenario)
	const page = await context.newPage()
	await page.addInitScript({ path: USERSCRIPT })
	await page.goto(`${mock.origin}${path}`)
	await page.waitForFunction(() => !!window.__akinatorAutoRunnerApp, null, { timeout: 20000 })
	return page
}

test('模板：views 目录里的模板都已在 views/index.mjs 注册', async () => {
	const dir = path.resolve(root, 'src', 'userscript', 'views')
	const indexSource = await readFile(path.resolve(dir, 'index.mjs'), 'utf8')
	const names = (await readdir(dir)).filter((name) => name.endsWith('.html')).map((name) => name.replace(/\.html$/, ''))
	for (const name of names) {
		const registered = indexSource.includes(`'${name}':`) || new RegExp(`^\\t${name},`, 'm').test(indexSource)
		assert.ok(registered, `模板 ${name} 未在 views/index.mjs 注册（${names.length} 个模板都要登记）`)
	}
})

test('主页面：广告挂在 akinator 页面而非脚本面板', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	await page.locator('#akinator-auto-runner-ad .aki-card').waitFor({ state: 'visible', timeout: 15000 })
	const href = await page.locator('#akinator-auto-runner-ad .aki-card-body').getAttribute('href')
	assert.ok(href?.includes('github.com/steve02081504/fount'), `广告应指向 fount，实际 ${href}`)
	assert.equal(await page.locator('#akinator-auto-runner .aki-card').count(), 0, '脚本面板内不应出现广告')
	await page.locator('#akinator-auto-runner-ad [data-ad-action="close"]').click()
	assert.equal(await page.locator('.aki-card').count(), 0, '关闭后广告应消失')
	await page.context().close()
})

test('回放：候选命中目标时自动选择并记入命中', async () => {
	const page = await openPage([
		{ kind: 'question', question: 'Is it from a video game?' },
		{ kind: 'proposal', id: 'pika', name: 'Pikachu', candidates: [
			{ id: 'pika', name: 'Pikachu', description: 'electric mouse', photo: '' },
			{ id: 'raichu', name: 'Raichu', description: '', photo: '' },
		] },
	])
	const result = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Pikachu', aliases: [] })
		const summary = await app.startRun({ characterId: character.id, mode: 'replay', rounds: 1, askUnknown: false, stepDelayMs: 0 })
		const devotion = app.getDevotionAll().characters[character.id]
		return { summary, confirmed: app.store.getChoice(character.id).guessed, wins: devotion.wins, devotion: app.getDevotion(character.id) }
	})
	assert.equal(result.summary.wins, 1)
	assert.ok(result.confirmed.includes('pika'), '应记录命中的候选 id')
	assert.equal(result.wins, 1)
	assert.equal(result.devotion.winRate, 1)
	assert.equal(result.devotion.sessions, 1)
	await page.context().close()
})

test('录制：逐题询问并写入题库', async () => {
	const page = await openPage([
		{ kind: 'question', question: 'Is it an animal?' },
		{ kind: 'defeat' },
	])
	const result = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'RecordTarget' })
		app.on('ask', () => app.provideAnswer(0))
		const summary = await app.startRun({ characterId: character.id, mode: 'record', rounds: 1, askUnknown: false, stepDelayMs: 0 })
		const saved = app.store.getCharacter(character.id)
		return { summary, answers: Object.keys(saved.answers), weights: Object.values(saved.answers).map((record) => record.weights), devotion: app.getDevotion(character.id) }
	})
	assert.ok(result.answers.length >= 2, `应记录至少两题，实际 ${result.answers.join(' | ')}`)
	assert.ok(result.answers.some((key) => key.includes('mock question')))
	assert.ok(result.answers.some((key) => key.includes('animal')))
	assert.ok(result.weights.every((weights) => Array.isArray(weights) && weights.length === 5), '每题都应带五个回答的权重')
	assert.equal(result.devotion.contributed, result.answers.length)
	await page.context().close()
})

test('录制：不先建角色也能直接开录，结束后按猜测自动成型', async () => {
	const page = await openPage([
		{ kind: 'question', question: 'Is it an animal?' },
		{ kind: 'proposal', id: 'pika', name: 'Pikachu', description: 'electric mouse', photo: 'https://example.com/pika.png', candidates: [
			{ id: 'pika', name: 'Pikachu', description: 'electric mouse', photo: 'https://example.com/pika.png' },
		] },
	])
	const result = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		app.on('ask', () => app.provideAnswer(0))
		app.on('proposal', (payload) => app.provideProposal({ action: 'pick', pickId: payload.proposal.candidates[0].id, manual: true }))
		/** @type {Aki.CreatedCharacter | undefined} */
		let created
		app.on('created', (payload) => {
			created = payload
		})
		const before = Object.keys(app.store.db.characters).length
		await app.startRun({ mode: 'record', rounds: 1, stepDelayMs: 0, draft: {} })
		const character = created ? app.store.getCharacter(created.id) : undefined
		return {
			before,
			created,
			name: character?.name,
			image: character?.image,
			answers: character ? Object.keys(character.answers).length : 0,
			all: Object.keys(app.store.db.characters).length,
		}
	})
	assert.equal(result.before, 0, '开录前不应有角色')
	assert.ok(result.created && !result.created.discarded, '录制结束应广播新角色')
	assert.ok(result.created.questions >= 1, '应至少录到一题')
	assert.equal(result.name, 'Pikachu', '应按 akinator 的猜测自动命名')
	assert.ok(result.image?.includes('pika.png'), `应抓取猜测图片，实际 ${result.image}`)
	assert.equal(result.all, 1, '新角色应出现在题库里')
	await page.context().close()
})

test('录制：与题库里已有的同名角色是同一个时合并结果而不是新建', async () => {
	const page = await openPage([
		{ kind: 'question', question: 'Is it an animal?' },
		{ kind: 'proposal', id: 'pika', name: 'Pikachu', description: 'electric mouse', photo: 'https://example.com/pika.png', candidates: [
			{ id: 'pika', name: 'Pikachu', description: 'electric mouse', photo: 'https://example.com/pika.png' },
		] },
	])
	const result = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const existing = app.store.addCharacter({ name: 'Pikachu', description: 'old', image: 'https://example.com/old.png' })
		app.store.recordAnswer(existing.id, { text: 'Is it a mock question?' }, 1)
		app.on('ask', () => app.provideAnswer(0))
		app.on('proposal', (payload) => app.provideProposal({ action: 'pick', pickId: payload.proposal.candidates[0].id, manual: true }))
		/** @type {Aki.CreatedCharacter | undefined} */
		let created
		app.on('created', (payload) => {
			created = payload
		})
		await app.startRun({ mode: 'record', rounds: 1, stepDelayMs: 0, draft: {} })
		const merged = app.store.getCharacter(existing.id)
		const mockKey = Object.keys(merged.answers).find((key) => key.includes('mock question'))
		return {
			created,
			existingId: existing.id,
			count: Object.keys(app.store.db.characters).length,
			mockWeights: mockKey ? merged.answers[mockKey].weights : [],
			hasAnimal: Object.keys(merged.answers).some((key) => key.includes('animal')),
			description: merged.description,
		}
	})
	assert.equal(result.count, 1, '应合并进现有角色，而不是再建一个')
	assert.equal(result.created?.id, result.existingId, 'created 事件应指向现有角色')
	assert.equal(result.created?.merged, true, 'created 事件应标记合并')
	assert.deepEqual(result.mockWeights, [1, 1, 0, 0, 0], '同题权重应累加')
	assert.ok(result.hasAnimal, '录制到的新题应并入')
	assert.equal(result.description, 'old', '现有非空资料不应被覆盖')
	await page.context().close()
})

test('回放：已记录的题自动作答不再增加选择次数', async () => {
	const scenario = [
		{ kind: 'question', question: 'Is it an animal?' },
		{ kind: 'defeat' },
	]
	const page = await openPage(scenario)
	const first = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Replay Stable' })
		const off = app.on('ask', () => app.provideAnswer(0))
		await app.startRun({ characterId: character.id, mode: 'record', rounds: 1, stepDelayMs: 0 })
		off()
		return { id: character.id, db: app.store.toJSON() }
	})
	const replayPage = await openPageInContext(page.context(), scenario)
	const result = await replayPage.evaluate(async ({ id, db }) => {
		const app = window.__akinatorAutoRunnerApp
		app.loadText(db, 'test')
		const before = JSON.stringify(app.store.getCharacter(id).answers)
		await app.startRun({ characterId: id, mode: 'replay', rounds: 1, askUnknown: false, askProposal: false, stepDelayMs: 0 })
		return { before, after: JSON.stringify(app.store.getCharacter(id).answers) }
	}, first)
	assert.equal(result.after, result.before, '回放不应改动题库权重 / 计数')
	await page.context().close()
})

test('面板：切到录制模式后无需选角色即可开录，结果卡自动出现', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	await page.locator('[data-mode="record"]').waitFor({ state: 'visible', timeout: 15000 })
	await page.locator('[data-mode="record"]').click()
	await page.locator('[data-action="start"]').click()
	await page.locator('[data-action="answer"][data-index="0"]').waitFor({ state: 'visible', timeout: 15000 })
	await page.locator('[data-action="answer"][data-index="0"]').click()
	await page.locator('.aar-created').waitFor({ state: 'visible', timeout: 15000 })
	const characters = await page.evaluate(() => Object.keys(window.__akinatorAutoRunnerApp.store.db.characters).length)
	assert.equal(characters, 1, '应自动创建一个角色')
	await page.context().close()
})

test('录制：一个字都没录到时会丢弃占位角色', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	const result = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		app.on('ask', () => app.provideAnswer(null))
		await app.startRun({ mode: 'record', rounds: 1, stepDelayMs: 0, draft: { name: 'Half-baked' } })
		return Object.keys(app.store.db.characters).length
	})
	assert.equal(result, 0, '未录到任何答案时应丢弃占位角色')
	await page.context().close()
})

test('回放：未记录的问题会询问用户并可补充', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	const result = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'UnknownTarget' })
		let asked = ''
		app.on('ask', (payload) => {
			asked = payload.question.text
			app.provideAnswer(3)
		})
		await app.startRun({ characterId: character.id, mode: 'replay', rounds: 1, askUnknown: true, stepDelayMs: 0 })
		const saved = app.store.getCharacter(character.id)
		const key = Object.keys(saved.answers)[0]
		return { asked, key, answer: saved.answers[key]?.answer, devotion: app.getDevotion(character.id) }
	})
	assert.ok(result.asked.length > 0, '应向用户提问')
	assert.equal(result.answer, 3, '应记录用户补充的答案')
	assert.equal(result.devotion.contributed, 1)
	await page.context().close()
})

test('候选：无匹配时记录「都不是」并继续', async () => {
	const page = await openPage([
		{ kind: 'proposal', id: 'other', name: 'Someone Else', candidates: [
			{ id: 'other', name: 'Someone Else', description: '', photo: '' },
		] },
		{ kind: 'defeat' },
	])
	const result = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Obscure Character' })
		await app.startRun({ characterId: character.id, mode: 'replay', rounds: 1, askUnknown: false, askProposal: false, stepDelayMs: 0 })
		return { history: app.store.getChoice(character.id).history }
	})
	assert.equal(result.history.length, 1)
	assert.equal(result.history[0].action, 'exclude')
	assert.equal(result.history[0].candidates[0].id, 'other')
	await page.context().close()
})

test('录制：手动排除候选不会把策略锁死为 exclude，回放仍能命中', async () => {
	const scenario = [
		{ kind: 'question', question: 'Is it a video game character?' },
		{ kind: 'proposal', id: 'other', name: 'Someone Else', candidates: [
			{ id: 'other', name: 'Someone Else', description: '', photo: '' },
		] },
		{ kind: 'proposal', id: 'pika', name: 'Pikachu', candidates: [
			{ id: 'pika', name: 'Pikachu', description: '', photo: '' },
		] },
		{ kind: 'defeat' },
	]
	const page = await openPage(scenario)
	const recorded = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Recorded Target' })
		app.on('ask', () => app.provideAnswer(0))
		app.on('proposal', (payload) => {
			const candidate = payload.proposal.candidates[0]
			app.provideProposal(candidate.id === 'pika'
				? { action: 'pick', pickId: candidate.id, manual: true }
				: { action: 'exclude', manual: true })
		})
		await app.startRun({ characterId: character.id, mode: 'record', rounds: 1, stepDelayMs: 0 })
		await app.saveNow()
		return { id: character.id, policy: app.store.getChoice(character.id).policy }
	})
	assert.equal(recorded.policy, 'auto', '录制时手动排除不应锁定策略')
	// 第二局在干净的游戏页上跑（页面驱动下同一页再开一局会刷新页面）。
	const replayPage = await openPageInContext(page.context(), scenario)
	const summary = await replayPage.evaluate(async (id) => {
		const app = window.__akinatorAutoRunnerApp
		return await app.startRun({ characterId: id, mode: 'replay', rounds: 1, askUnknown: false, askProposal: false, stepDelayMs: 0, maxSteps: 5 })
	}, recorded.id)
	assert.equal(summary.wins, 1, '回放仍应命中正确候选')
	await page.context().close()
})

test('题库数据只含角色信息与题库，运行期字段留在本机状态', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	const result = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Clean Target' })
		const offAsk = app.on('ask', () => app.provideAnswer(0))
		await app.startRun({ characterId: character.id, mode: 'record', rounds: 1, stepDelayMs: 0 })
		offAsk()
		app.store.recordChoice(character.id, { at: Date.now(), baseId: 'b', candidates: [], action: 'exclude', manual: true })
		const db = JSON.parse(app.store.toJSON())
		return {
			topKeys: Object.keys(db),
			characterKeys: Object.keys(db.characters[character.id]),
			policy: app.store.getChoice(character.id).policy,
		}
	})
	assert.deepEqual(result.topKeys.sort(), ['characters', 'name', 'updatedAt', 'version'], '数据库顶层只应有信封 + 角色')
	assert.ok(!['choice', 'stats', 'guessed'].some((key) => result.characterKeys.includes(key)), `角色只应有基本信息与 answers，实际 ${result.characterKeys.join(', ')}`)
	assert.equal(result.policy, 'exclude', '候选策略应保存在本机状态里')
	await page.context().close()
})

test('回放：akinator 偶发返回非 JSON 时会重试而不是中断整局', async () => {
	const page = await openPage([
		{ kind: 'proposal', id: 'other', name: 'Someone Else', candidates: [
			{ id: 'other', name: 'Someone Else', description: '', photo: '' },
		] },
		{ kind: 'garbage' },
		{ kind: 'defeat' },
	])
	const result = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Flaky Target' })
		const summary = await app.startRun({ characterId: character.id, mode: 'replay', rounds: 1, askUnknown: false, askProposal: false, stepDelayMs: 0 })
		return { summary, errors: app.logs.filter((entry) => entry.level === 'error').map((entry) => entry.message) }
	})
	assert.equal(result.summary.losses, 1, '重试后应正常走完这一局')
	assert.equal(result.errors.length, 0, `不应报错，实际 ${result.errors.join(' | ')}`)
	await page.context().close()
})

test('录制：改选后「追加概率」会累计题库分布并留下最后一次答案', async () => {
	const scenario = [
		{ kind: 'question', question: 'Same question?' },
		{ kind: 'defeat' },
	]
	const page = await openPage(scenario)
	const first = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Distribution Target' })
		const offAsk = app.on('ask', () => app.provideAnswer(0))
		await app.startRun({ characterId: character.id, mode: 'record', rounds: 1, stepDelayMs: 0 })
		offAsk()
		return { id: character.id, db: app.store.toJSON() }
	})
	// 第二局在干净的游戏页上跑：这题已有记录会被自动预选，用户在倒计时里改选「否」并选择“追加”。
	const replayPage = await openPageInContext(page.context(), scenario)
	const result = await replayPage.evaluate(async ({ id, db }) => {
		const app = window.__akinatorAutoRunnerApp
		app.loadText(db, 'test')
		const offDelay = app.on('delay', () => app.provideAnswer(1))
		const offIntervene = app.on('intervention', () => app.resolveIntervention('append'))
		await app.startRun({ characterId: id, mode: 'record', rounds: 1, stepDelayMs: 60000 })
		offDelay()
		offIntervene()
		const saved = app.store.getCharacter(id)
		const key = Object.keys(saved.answers).find((item) => item.includes('same question'))
		return { key, weights: key ? saved.answers[key].weights : [], answer: key ? saved.answers[key].answer : undefined }
	}, first)
	assert.ok(result.key, '角色应包含该问题')
	assert.ok(Number(result.weights?.[0]) >= 1, `应累计「是」的权重，实际 ${JSON.stringify(result.weights)}`)
	assert.ok(Number(result.weights?.[1]) >= 1, '应累计「否」的权重')
	assert.equal(result.answer, 1, '追加后角色自身的答案取最后一次')
	await page.context().close()
})

test('录制：改选后「纠正错误回答」会清空该题概览并覆盖角色答案', async () => {
	const scenario = [
		{ kind: 'question', question: 'Correct me?' },
		{ kind: 'defeat' },
	]
	const page = await openPage(scenario)
	const first = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Correct Target' })
		const offAsk = app.on('ask', () => app.provideAnswer(0))
		await app.startRun({ characterId: character.id, mode: 'record', rounds: 1, stepDelayMs: 0 })
		offAsk()
		return { id: character.id, db: app.store.toJSON() }
	})
	const replayPage = await openPageInContext(page.context(), scenario)
	const result = await replayPage.evaluate(async ({ id, db }) => {
		const app = window.__akinatorAutoRunnerApp
		app.loadText(db, 'test')
		const offDelay = app.on('delay', () => app.provideAnswer(4))
		const offIntervene = app.on('intervention', () => app.resolveIntervention('correct'))
		await app.startRun({ characterId: id, mode: 'record', rounds: 1, stepDelayMs: 60000 })
		offDelay()
		offIntervene()
		const saved = app.store.getCharacter(id)
		const key = Object.keys(saved.answers).find((item) => item.includes('correct me'))
		return {
			key,
			weights: key ? saved.answers[key].weights : [],
			answer: key ? saved.answers[key].answer : undefined,
		}
	}, first)
	assert.ok(result.key, '角色应包含该问题')
	assert.equal(Number(result.weights?.[0] ?? 0), 0, '纠正后旧的权重应被清空')
	assert.equal(Number(result.weights?.[4] ?? 0), 1, '纠正后只保留这次答案的权重')
	assert.equal(result.answer, 4, '纠正后角色答案应被覆盖')
	await page.context().close()
})

test('录制：已答过的题会倒计时自动预选，面板出现倒计时进度条', async () => {
	const scenario = [
		{ kind: 'question', question: 'Auto pick me?' },
		{ kind: 'defeat' },
	]
	const page = await openPage(scenario)
	const first = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Auto Pick Target' })
		const offAsk = app.on('ask', () => app.provideAnswer(1))
		await app.startRun({ characterId: character.id, mode: 'record', rounds: 1, stepDelayMs: 0 })
		offAsk()
		return { id: character.id, db: app.store.toJSON() }
	})
	const replayPage = await openPageInContext(page.context(), scenario)
	await replayPage.evaluate(async ({ id, db }) => {
		const app = window.__akinatorAutoRunnerApp
		app.loadText(db, 'test')
		window.__autoAsked = 0
		window.__offAsk = app.on('ask', () => {
			window.__autoAsked += 1
		})
		app.startRun({ characterId: id, mode: 'record', rounds: 1, stepDelayMs: 60000 })
	}, first)
	await replayPage.locator('#akinator-auto-runner .aar-delay .aar-countdown').waitFor({ state: 'visible', timeout: 15000 })
	const label = await replayPage.locator('#akinator-auto-runner .aar-delay').innerText()
	assert.ok(label.includes('正在自动作答'), `倒计时卡应说明正在自动作答，实际 ${label}`)
	const asked = await replayPage.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		window.__offAsk?.()
		const count = window.__autoAsked
		app.provideAnswer(1)
		return count
	})
	assert.equal(asked, 0, '已答过的题不应再手动作答')
	await page.context().close()
})

test('面板：自动作答倒计时期间可点答案按钮并弹出「纠正 / 追加」对话框', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Panel Intervene' })
		const first = app.on('ask', () => app.provideAnswer(0))
		await app.startRun({ characterId: character.id, mode: 'record', rounds: 1, stepDelayMs: 0 })
		first()
		app.startRun({ characterId: character.id, mode: 'record', rounds: 1, stepDelayMs: 60000 })
	})
	await page.locator('#akinator-auto-runner .aar-delay .aar-countdown').waitFor({ state: 'visible', timeout: 15000 })
	const button = page.locator('#akinator-auto-runner .aar-ask [data-action="answer"][data-index="1"]')
	assert.equal(await button.isDisabled(), false, '倒计时期间答案按钮应可点击')
	await button.click()
	await page.locator('#akinator-auto-runner .aar-intervene [data-action="intervene"][data-id="append"]').waitFor({ state: 'visible', timeout: 15000 })
	await page.locator('#akinator-auto-runner .aar-intervene [data-action="intervene"][data-id="append"]').click()
	await page.waitForFunction(() => window.__akinatorAutoRunnerApp.lastSession?.running === false, null, { timeout: 15000 })
	const weights = await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.listCharacters({}).find((item) => item.name === 'Panel Intervene')
		const key = Object.keys(character?.answers ?? {}).find((item) => item.includes('mock question'))
		return key ? character.answers[key].weights : []
	})
	assert.ok(Number(weights?.[0] ?? 0) >= 1, '应保留「是」的权重')
	assert.ok(Number(weights?.[1] ?? 0) >= 1, '追加后应记录「否」的权重')
	await page.context().close()
})

test('面板：答题卡会显示该题的历史答案分布', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	const first = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Distribution UI' })
		const off = app.on('ask', () => app.provideAnswer(0))
		await app.startRun({ characterId: character.id, mode: 'record', rounds: 1, stepDelayMs: 0 })
		off()
		return { id: character.id, db: app.store.toJSON() }
	})
	// 再开一局：该题已有记录，会先在倒计时里停一下，答题卡应显示分布。
	const replayPage = await openPageInContext(page.context(), [{ kind: 'defeat' }])
	await replayPage.evaluate(({ id, db }) => {
		const app = window.__akinatorAutoRunnerApp
		app.loadText(db, 'test')
		app.startRun({ characterId: id, mode: 'record', rounds: 1, stepDelayMs: 60000 })
	}, first)
	await replayPage.locator('#akinator-auto-runner .aar-ask-dist').waitFor({ state: 'visible', timeout: 15000 })
	await page.context().close()
})

test('面板：自动作答只刷新题目相关区块，不重建顶部控件', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	const result = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'ReplayTarget' })
		const shadow = document.querySelector('#akinator-auto-runner').shadowRoot
		const state = { running: true, mode: 'replay', characterId: character.id, round: 1, rounds: 1, step: 1, progression: 20, wins: 0, losses: 0, awaitingUser: false, question: { text: 'Is it a mock question?', step: 1, progression: 20 } }
		// 运行开始时控件要进入「运行中」态：这一次整体重建运行页。
		app.emit('state', state)
		await new Promise((resolve) => setTimeout(resolve, 100))
		const seg = shadow.querySelector('.aar-seg')
		const details = shadow.querySelector('.aar-advanced')
		const askBefore = shadow.querySelector('.aar-ask')
		seg.dataset.mark = '1'
		details.open = true
		// 之后每步自动作答只广播新状态：顶部控件与展开态应原样保留，只刷新题目相关区块。
		app.emit('state', { ...state, step: 2, progression: 40, question: { text: 'Q two?', step: 2, progression: 40 } })
		await new Promise((resolve) => setTimeout(resolve, 100))
		const askAfter = shadow.querySelector('.aar-ask')
		return {
			controlsKept: shadow.querySelector('.aar-seg') === seg && seg.dataset.mark === '1',
			detailsKept: shadow.querySelector('.aar-advanced') === details && details.open,
			questionRefreshed: !!askBefore && askAfter !== askBefore && askAfter?.querySelector('.aar-question')?.textContent === 'Q two?',
		}
	})
	assert.deepEqual(result, { controlsKept: true, detailsKept: true, questionRefreshed: true })
	await page.context().close()
})

test('面板：出题等运行事件不会把用户从其他标签页拽回运行页', async () => {
	const page = await openPage([
		{ kind: 'question', question: 'Will this steal focus?' },
		{ kind: 'defeat' },
	])
	await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Tab Target' })
		window.__askCount = 0
		window.__release = false
		// 先扣住出题不作答，好让用户有时间切走；放行后才继续跑。
		app.on('ask', () => {
			window.__askCount += 1
			if (window.__release) app.provideAnswer(0)
			else window.__awaitingAnswer = true
		})
		app.startRun({ characterId: character.id, mode: 'record', rounds: 1, askUnknown: false, stepDelayMs: 0 })
	})
	await page.waitForFunction(() => window.__askCount >= 1)
	// 用户切到角色页；脚本仍在运行，后面还会再出题。
	await page.locator('.aar-tabs [data-tab="characters"]').click()
	await page.evaluate(() => {
		window.__release = true
		if (window.__awaitingAnswer) window.__akinatorAutoRunnerApp.provideAnswer(0)
	})
	await page.waitForFunction(() => window.__askCount >= 2)
	const result = await page.evaluate(() => {
		const shadow = document.querySelector('#akinator-auto-runner').shadowRoot
		return {
			active: shadow.querySelector('.aar-tab.active')?.getAttribute('data-tab'),
			askVisible: !!shadow.querySelector('.aar-ask'),
		}
	})
	assert.equal(result.active, 'characters', '运行事件不应把标签页切回运行页')
	assert.equal(result.askVisible, false, '不在运行页时不应渲染出题区块')
	await page.context().close()
})

test('面板：未知题需要人补充答案时才把标签页切回运行页', async () => {
	const page = await openPage([
		{ kind: 'question', question: 'Second unknown question?' },
		{ kind: 'defeat' },
	])
	await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Focus Target' })
		window.__asks = 0
		// 第一道未知题先扣住，等用户切走后再放行；第二道未知题应把运行页拉回来。
		app.on('ask', () => {
			window.__asks += 1
			if (window.__asks >= 2) app.provideAnswer(3)
		})
		app.startRun({ characterId: character.id, mode: 'replay', rounds: 1, askUnknown: true, stepDelayMs: 0 })
	})
	await page.waitForFunction(() => window.__asks >= 1)
	await page.locator('.aar-tabs [data-tab="player"]').click()
	await page.evaluate(() => window.__akinatorAutoRunnerApp.provideAnswer(3))
	await page.waitForFunction(() => window.__asks >= 2)
	// 未知题要人补充答案：应把标签页切回运行页并渲染出题区块。
	await page.locator('#akinator-auto-runner .aar-ask').waitFor({ state: 'visible', timeout: 15000 })
	const active = await page.evaluate(() => document.getElementById('akinator-auto-runner').shadowRoot.querySelector('.aar-tab.active')?.getAttribute('data-tab'))
	assert.equal(active, 'run', '未知题应把标签页切回运行页')
	await page.context().close()
})

test('面板：点播放不会把标签页切回运行页', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Play Stays' })
		// 首题已有记录，回放时自动作答，不会因未知题触发「切回运行页」的例外。
		app.store.recordAnswer(character.id, { text: 'Is it a mock question?' }, 0)
	})
	await page.locator('.aar-tabs [data-tab="characters"]').click()
	await page.locator('[data-action="run-character"]').first().click()
	await page.waitForTimeout(500)
	const active = await page.evaluate(() => document.getElementById('akinator-auto-runner').shadowRoot.querySelector('.aar-tab.active')?.getAttribute('data-tab'))
	assert.equal(active, 'characters', '点播放不应把标签页切回运行页')
	await page.context().close()
})

test('面板：标签页与展开态在 akinator 刷新后保持', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	await page.locator('.aar-tabs [data-tab="player"]').click()
	await page.locator('[data-action="expand"]').click()
	await page.waitForFunction(() => document.getElementById('akinator-auto-runner').classList.contains('aar-expanded'), null, { timeout: 15000 })
	await page.reload()
	await page.waitForFunction(() => !!window.__akinatorAutoRunnerApp, null, { timeout: 20000 })
	const restored = await page.evaluate(() => {
		const host = document.getElementById('akinator-auto-runner')
		return {
			active: host.shadowRoot.querySelector('.aar-tab.active')?.getAttribute('data-tab'),
			expanded: host.classList.contains('aar-expanded'),
		}
	})
	assert.equal(restored.active, 'player', '刷新后应回到刷新前的播放器页')
	assert.ok(restored.expanded, '刷新后应保持展开态')
	await page.context().close()
})

test('跨页面：日志与会话快照在刷新后仍然存在，可续跑', async () => {
	const page = await openPage([{ kind: 'question', question: 'Persisted question?' }])
	await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		// 不 await、也不作答：让运行停在等待作答处，模拟刷新打断
		app.startRun({ mode: 'record', rounds: 1, stepDelayMs: 0, draft: { name: 'Interrupted Target' } })
	})
	// 日志 / 会话是防抖写入存储的，等到真正落盘再断言。
	await page.waitForFunction(() => {
		const logs = localStorage.getItem('akinator-auto-runner:logs') ?? ''
		const session = localStorage.getItem('akinator-auto-runner:session') ?? ''
		return logs.length > 2 && session.includes('"running":true')
	}, null, { timeout: 15000 })
	const before = await page.evaluate(() => ({
		logs: window.__akinatorAutoRunnerApp.logs.length,
		session: window.__akinatorAutoRunnerApp.lastSession,
		storedLogs: localStorage.getItem('akinator-auto-runner:logs')?.length ?? 0,
		storedSession: localStorage.getItem('akinator-auto-runner:session') ?? '',
	}))
	assert.ok(before.logs > 0, '运行应产生日志')
	assert.ok(before.storedLogs > 0, '日志应写入存储')
	assert.ok(before.session?.running, '运行中应留下会话快照')
	assert.ok(before.storedSession.includes('characterId'), '会话快照应写入存储')

	// 题库本身走本地文件 / IndexedDB，这里强制落盘后再刷新。
	await page.evaluate(() => window.__akinatorAutoRunnerApp.saveNow())
	await page.reload()
	await page.waitForFunction(() => !!window.__akinatorAutoRunnerApp, null, { timeout: 20000 })
	const after = await page.evaluate(() => ({
		logs: window.__akinatorAutoRunnerApp.logs.length,
		interrupted: window.__akinatorAutoRunnerApp.sessionInterrupted,
		name: window.__akinatorAutoRunnerApp.store.listCharacters({})[0]?.name,
	}))
	assert.ok(after.logs > 0, '刷新后日志应从存储恢复')
	assert.equal(after.interrupted, true, '刷新后应标记上次会话被中断')
	assert.equal(after.name, 'Interrupted Target', '刷新后角色仍在')

	await page.locator('[data-action="resume-session"]').waitFor({ state: 'visible', timeout: 15000 })
	await page.locator('[data-action="resume-session"]').click()
	await page.locator('[data-action="answer"][data-index="0"]').waitFor({ state: 'visible', timeout: 15000 })
	await page.context().close()
})

test('会话：正常完成后不标记中断，续跑接着原角色而非新建', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		app.on('ask', () => app.provideAnswer(0))
		await app.startRun({ mode: 'record', rounds: 1, stepDelayMs: 0, draft: { name: 'Resume Target' } })
	})
	// 会话快照是防抖写入的，等 running:false 真正落盘。
	await page.waitForFunction(() => (localStorage.getItem('akinator-auto-runner:session') ?? '').includes('"running":false'), null, { timeout: 15000 })
	await page.evaluate(() => window.__akinatorAutoRunnerApp.saveNow())
	await page.reload()
	await page.waitForFunction(() => !!window.__akinatorAutoRunnerApp, null, { timeout: 20000 })
	const after = await page.evaluate(() => ({
		interrupted: window.__akinatorAutoRunnerApp.sessionInterrupted,
		characters: Object.keys(window.__akinatorAutoRunnerApp.store.db.characters).length,
	}))
	assert.equal(after.interrupted, false, '正常完成的运行不应被标记为中断')
	assert.equal(after.characters, 1)
	await page.locator('[data-action="resume-session"]').waitFor({ state: 'visible', timeout: 15000 })
	// 已答过的题会自动预选，这里不需要作答；关掉延时让续跑立刻走完。
	await page.evaluate(() => window.__akinatorAutoRunnerApp.updateSettings({ stepDelayMs: 0 }))
	await page.locator('[data-action="resume-session"]').click()
	await page.waitForFunction(() => window.__akinatorAutoRunnerApp.lastSession?.running === false, null, { timeout: 15000 })
	const characters = await page.evaluate(() => Object.keys(window.__akinatorAutoRunnerApp.store.db.characters).length)
	assert.equal(characters, 1, '续跑录制应接着同一个角色，不应新建占位角色')
	await page.context().close()
})

test('面板：可以下载日志报告', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	await page.locator('[data-action="download-logs"]').waitFor({ state: 'visible', timeout: 15000 })
	const [download] = await Promise.all([
		page.waitForEvent('download', { timeout: 15000 }),
		page.locator('[data-action="download-logs"]').click(),
	])
	assert.ok(download.suggestedFilename().startsWith('akinator-auto-runner-logs-'), `文件名应带前缀，实际 ${download.suggestedFilename()}`)
	assert.ok(download.suggestedFilename().endsWith('.txt'), '报告应为纯文本')
	const report = await download.createReadStream().then(async (stream) => {
		let text = ''
		for await (const chunk of stream) text += chunk
		return text
	})
	assert.ok(report.includes('Akinator Auto Runner — log report'), '报告应带标题')
	assert.ok(report.includes('--- logs ('), '报告应带日志区')
	await download.delete()
	await page.context().close()
})

test('面板：清空日志后日志区为空', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	await page.locator('[data-action="clear-logs"]').waitFor({ state: 'visible', timeout: 15000 })
	page.on('dialog', (dialog) => dialog.accept())
	await page.locator('[data-action="clear-logs"]').click()
	await page.waitForFunction(() => window.__akinatorAutoRunnerApp.logs.length === 0, null, { timeout: 15000 })
	await page.context().close()
})

test('面板：语言切换即时生效并持久化设置', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	await page.locator('[data-role="locale"]').waitFor({ state: 'visible', timeout: 15000 })
	await page.locator('[data-role="locale"]').selectOption('zh-CN')
	const title = await page.locator('.aar-title').innerText()
	assert.equal(title.trim(), 'Akinator 自动答题')
	const language = await page.evaluate(() => window.__akinatorAutoRunnerApp.settings.language)
	assert.equal(language, 'zh-CN')
	await page.context().close()
})

test('面板：主题按钮循环切换日夜模式', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	await page.locator('[data-action="toggle-theme"]').waitFor({ state: 'visible', timeout: 15000 })
	const before = await page.evaluate(() => window.__akinatorAutoRunnerApp.settings.theme)
	await page.locator('[data-action="toggle-theme"]').click()
	const after = await page.evaluate(() => window.__akinatorAutoRunnerApp.settings.theme)
	assert.notEqual(after, before, '主题模式应发生切换')
	const hostTheme = await page.locator('#akinator-auto-runner').getAttribute('data-theme')
	assert.ok(hostTheme === 'dark' || hostTheme === 'light', `宿主应有具体明暗，实际 ${hostTheme}`)
	await page.context().close()
})

test('面板：展开按钮把面板半透明铺满屏幕，四周留一圈透明边', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	await page.locator('[data-action="expand"]').waitFor({ state: 'visible', timeout: 15000 })
	await page.locator('[data-action="expand"]').click()
	const expanded = await page.evaluate(() => {
		const host = document.getElementById('akinator-auto-runner')
		const panel = host.shadowRoot.querySelector('.aar-panel')
		const rect = host.getBoundingClientRect()
		const background = getComputedStyle(panel).backgroundColor
		const alpha = Number(background.slice(background.lastIndexOf(',') + 1, -1))
		return {
			expanded: host.classList.contains('aar-expanded'),
			inset: { left: rect.left, top: rect.top, right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.bottom },
			alpha,
		}
	})
	assert.ok(expanded.expanded, '宿主应带展开态类')
	assert.deepEqual(expanded.inset, { left: 8, top: 8, right: 8, bottom: 8 }, '四周应留 8px 透明边')
	assert.ok(expanded.alpha < 1, `展开态面板应半透明，实际 alpha=${expanded.alpha}`)
	await page.locator('[data-action="expand"]').click()
	const restored = await page.evaluate(() => {
		const host = document.getElementById('akinator-auto-runner')
		return { expanded: host.classList.contains('aar-expanded'), right: host.style.right, bottom: host.style.bottom }
	})
	assert.ok(!restored.expanded, '再次点击应退出展开态')
	assert.equal(restored.right, '16px')
	assert.equal(restored.bottom, '16px')
	await page.context().close()
})

test('录制：答案权重随作答累计', async () => {
	const page = await openPage([
		{ kind: 'question', question: 'Will this be counted?' },
		{ kind: 'defeat' },
	])
	const result = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'StatsTarget' })
		app.on('ask', () => app.provideAnswer(1))
		await app.startRun({ characterId: character.id, mode: 'record', rounds: 1, askUnknown: false, stepDelayMs: 0 })
		const key = Object.keys(character.answers).find((item) => item.includes('counted'))
		return { key, weights: key ? character.answers[key].weights : [] }
	})
	assert.ok(result.key, '角色应包含该问题')
	assert.ok(Number(result.weights?.[1] ?? 0) >= 1, '应累计「否」的权重')
	await page.context().close()
})

test('角色编辑：题目概率列表虚拟队列分批渲染，滚动到底再追加', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
	await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Chunk Target' })
		for (let index = 0; index < 60; index++)
			app.store.recordAnswer(character.id, { text: `Chunk question ${index} <with> "quotes"` }, index % 5)
	})
	await page.locator('.aar-tabs [data-tab="characters"]').click()
	await page.locator('[data-action="edit-character"]').first().click()
	await page.locator('.aar-q-editable').first().waitFor({ state: 'visible', timeout: 15000 })
	const initial = await page.locator('.aar-q-editable').count()
	assert.equal(initial, 20, '首批只渲染一页，不会一次性铺满整份题库')

	await page.locator('.aar-body').evaluate((element) => { element.scrollTop = element.scrollHeight })
	await page.waitForFunction(() => document.getElementById('akinator-auto-runner').shadowRoot.querySelectorAll('.aar-q-editable').length > 20, null, { timeout: 15000 })
	// 改一个权重并失焦（触发 change）：不应把已加载的分块重置回第一页。
	const weightInput = page.locator('.aar-weight-input').first()
	await weightInput.fill('7')
	await weightInput.press('Tab')
	await page.waitForTimeout(150)
	const afterEdit = await page.locator('.aar-q-editable').count()
	assert.ok(afterEdit > 20, `编辑概率后不应重置为第一页，实际 ${afterEdit}`)
	assert.equal(errors.filter((text) => !text.includes('404')).length, 0, '编辑器渲染不应产生脚本错误')
	await page.context().close()
})

test('角色编辑：编辑途中切到其他标签页看到的是该标签页，切回仍保留草稿', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Tab Edit Target' })
		app.store.recordAnswer(character.id, { text: 'Is it a tab edit question?' }, 0)
	})
	await page.locator('.aar-tabs [data-tab="characters"]').click()
	await page.locator('[data-action="edit-character"]').first().click()
	const nameInput = page.locator('#akinator-auto-runner [data-field="name"]')
	await nameInput.waitFor({ state: 'visible', timeout: 15000 })
	await nameInput.fill('Tab Edit Renamed')

	// 临时切到答题页补充问题：应看到答题页而不是编辑器。
	await page.locator('.aar-tabs [data-tab="run"]').click()
	await page.waitForFunction(() => document.querySelector('#akinator-auto-runner').shadowRoot.querySelector('.aar-tab.active')?.getAttribute('data-tab') === 'run', null, { timeout: 15000 })
	const onRun = await page.evaluate(() => {
		const shadow = document.querySelector('#akinator-auto-runner').shadowRoot
		return {
			active: shadow.querySelector('.aar-tab.active')?.getAttribute('data-tab'),
			startVisible: !!shadow.querySelector('[data-action="start"]'),
			editorVisible: !!shadow.querySelector('[data-action="save-character"]'),
		}
	})
	assert.equal(onRun.active, 'run', '应切到答题页')
	assert.equal(onRun.startVisible, true, '答题页应渲染出来')
	assert.equal(onRun.editorVisible, false, '不在角色页时不应显示编辑器')

	// 切回角色页：编辑器应带回未保存的草稿。
	await page.locator('.aar-tabs [data-tab="characters"]').click()
	const back = page.locator('#akinator-auto-runner [data-field="name"]')
	await back.waitFor({ state: 'visible', timeout: 15000 })
	assert.equal(await back.inputValue(), 'Tab Edit Renamed', '切回角色页应保留未保存的草稿')
	await page.context().close()
})

test('角色编辑：改答案概率后保存，回放按权重概率作答', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	const characterId = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Weight Target' })
		const off = app.on('ask', () => app.provideAnswer(0))
		await app.startRun({ characterId: character.id, mode: 'record', rounds: 1, stepDelayMs: 0 })
		off()
		const key = Object.keys(character.answers)[0]
		// 只留「否」有权重，采样回放必然作答「否」。
		character.answers[key].weights = [0, 5, 0, 0, 0]
		app.store.changed()
		return character.id
	})
	// 编辑页把「否」的权重改成 9，保存后回放应改答「否」。
	await page.locator('.aar-tabs [data-tab="characters"]').click()
	await page.locator('[data-action="edit-character"]').first().click()
	const input = page.locator('#akinator-auto-runner .aar-weight-input[data-index="1"]').first()
	await input.waitFor({ state: 'visible', timeout: 15000 })
	await input.fill('9')
	await page.locator('[data-action="save-character"]').click()
	const db = await page.evaluate(() => window.__akinatorAutoRunnerApp.store.toJSON())
	const replayPage = await openPageInContext(page.context(), [{ kind: 'defeat' }])
	const used = await replayPage.evaluate(async ({ id, text }) => {
		const app = window.__akinatorAutoRunnerApp
		app.loadText(text, 'test')
		let answer
		app.on('answer', (info) => { answer = info.answerIndex })
		await app.startRun({ characterId: id, mode: 'replay', rounds: 1, askUnknown: false, stepDelayMs: 0 })
		return answer
	}, { id: characterId, text: db })
	assert.equal(used, 1, '回放应按编辑后的权重作答')
	await page.context().close()
})

test('页面接管：运行时把问题渲染到 akinator 页面，点页面按钮即可作答', async () => {
	const page = await openPage([
		{ kind: 'question', question: 'Second page question?' },
		{ kind: 'defeat' },
	])
	await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		app.startRun({ mode: 'record', rounds: 1, stepDelayMs: 0, draft: { name: 'Page Target' } })
	})
	await page.waitForFunction(() => document.getElementById('question-label')?.textContent === 'Is it a mock question?', null, { timeout: 15000 })
	await page.locator('#a_yes').click()
	await page.waitForFunction(() => document.getElementById('question-label')?.textContent === 'Second page question?', null, { timeout: 15000 })
	const answers = await page.evaluate(() => Object.keys(window.__akinatorAutoRunnerApp.store.listCharacters({})[0]?.answers ?? {}).length)
	assert.ok(answers >= 1, '页面上点「是」应被记录进题库')
	await page.context().close()
})

test('页面驱动：运行只点 akinator 页面按钮、不另开会话', async () => {
	const page = await openPage([
		{ kind: 'question', question: 'Driven by the page?' },
		{ kind: 'defeat' },
	])
	const result = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Page Driven' })
		const summary = await app.startRun({ characterId: character.id, mode: 'replay', rounds: 1, askUnknown: false, stepDelayMs: 0 })
		return { summary, clicks: window.__pageClicks.slice() }
	})
	assert.equal(mock.getGamePosts(), 0, '脚本不应自己 POST /game 另开会话')
	assert.ok(result.clicks.some((click) => click.kind === 'answer'), '应由 akinator 页面自身的按钮处理作答')
	assert.ok(result.summary.rounds >= 1, '这一局应当正常跑完')
	await page.context().close()
})

test('页面驱动：切题过渡态不会被误判为认输', async () => {
	const page = await openPage([
		{ kind: 'question', question: 'Second page question?' },
		{ kind: 'defeat' },
	])
	const result = await page.evaluate(async () => {
		// 把切题过渡拉长到远超任何「定时器式认输」的阈值：真正的结束来自页面自身的响应。
		window.__mockTransitionMs = 3000
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Transition Target' })
		const seen = []
		app.on('state', (state) => state.question?.text && seen.push(state.question.text))
		const summary = await app.startRun({ characterId: character.id, mode: 'replay', rounds: 1, askUnknown: false, stepDelayMs: 0 })
		return { seen, summary }
	})
	assert.ok(result.seen.includes('Second page question?'), '过渡后应继续读第二题，而不是判成认输')
	await page.context().close()
})

test('页面驱动：候选「否」后的「继续?」确认会自动点确定', async () => {
	const page = await openPage([
		{ kind: 'proposal', id: 'other', name: 'Someone Else', candidates: [
			{ id: 'other', name: 'Someone Else', description: '', photo: '' },
		] },
		{ kind: 'question', question: 'Second page question?' },
		{ kind: 'defeat' },
	])
	const result = await page.evaluate(async () => {
		window.__mockRequireContinueConfirm = true
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Continue Target' })
		const seen = []
		app.on('state', (state) => state.question?.text && seen.push(state.question.text))
		const summary = await app.startRun({ characterId: character.id, mode: 'replay', rounds: 1, askUnknown: false, askProposal: false, stepDelayMs: 0 })
		return { seen, summary, clicks: window.__pageClicks.slice() }
	})
	assert.ok(result.clicks.some((click) => click.kind === 'continue_yes'), '应自动点击「继续?」的确定')
	assert.ok(result.seen.includes('Second page question?'), '确认后应继续到下一题，而不是卡住')
	await page.context().close()
})

test('页面驱动：命中后先等 akinator 的 /choice 汇报完再开下一局', async () => {
	const page = await openPage([
		{ kind: 'proposal', id: 'pika', name: 'Pikachu', candidates: [
			{ id: 'pika', name: 'Pikachu', description: 'electric mouse', photo: '' },
		] },
	])
	// akinator 的 /choice 汇报要花点时间：脚本若抢在它返回前就 POST /game，会中断这条汇报。
	mock.setChoiceDelay(400)
	await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Pikachu' })
		// 多局 + 不因命中停止：第一局跑完会 POST /game 刷新续跑，正好观察「汇报 vs 开下一局」的先后。
		app.startRun({ characterId: character.id, mode: 'replay', rounds: 2, stopOnWin: false, askUnknown: false, stepDelayMs: 0 })
	})
	const deadline = Date.now() + 20000
	while (mock.getGamePosts() < 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
	assert.ok(mock.getGamePosts() >= 1, '命中后应重新 POST /game 开下一局')
	const timeline = mock.getTimeline()
	const choiceIndex = timeline.findIndex((entry) => entry.kind === 'choice')
	const gameIndex = timeline.findIndex((entry) => entry.kind === 'game')
	assert.ok(choiceIndex >= 0, '页面自身的 /choice 汇报应完成，不能被开下一局的导航中断')
	assert.ok(choiceIndex < gameIndex, '/choice 汇报应先于脚本开下一局的 POST /game')
	await page.context().close()
})

/**
 * 模拟窗口被遮挡 / 标签切到后台：rAF 不再回调、`document` 报隐藏且失焦。
 * 必须早于用户脚本注入，用户脚本应在此基础上把页面「骗回」前台。
 * @returns {void} 无
 */
function simulateBackground() {
	/**
	 * 被暂停的动画帧：只返回 id，永不回调。
	 * @returns {number} 帧 id
	 */
	function pausedFrame() {
		return 0
	}
	/**
	 * 空实现。
	 * @returns {void} 无
	 */
	function noop() {}
	/**
	 * 报告页面隐藏。
	 * @returns {boolean} 恒为 true
	 */
	function hidden() {
		return true
	}
	/**
	 * 报告页面已失焦。
	 * @returns {boolean} 恒为 false
	 */
	function unfocused() {
		return false
	}
	/**
	 * 报告页面隐藏状态。
	 * @returns {string} 恒为 'hidden'
	 */
	function hiddenState() {
		return 'hidden'
	}
	window.requestAnimationFrame = pausedFrame
	window.cancelAnimationFrame = noop
	Object.defineProperty(document, 'hidden', { configurable: true, get: hidden })
	Object.defineProperty(document, 'visibilityState', { configurable: true, get: hiddenState })
	Object.defineProperty(document, 'hasFocus', { configurable: true, value: unfocused })
}

test('前台欺骗：窗口被遮挡 / 后台时切题过渡不再停摆', async () => {
	const page = await openPage(
		[
			{ kind: 'question', question: 'Second page question?' },
			{ kind: 'defeat' },
		],
		simulateBackground,
	)
	const result = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Background Target' })
		const seen = []
		app.on('state', (state) => state.question?.text && seen.push(state.question.text))
		const summary = await app.startRun({ characterId: character.id, mode: 'replay', rounds: 1, askUnknown: false, stepDelayMs: 0 })
		return {
			seen,
			summary,
			hidden: document.hidden,
			visibilityState: document.visibilityState,
			hasFocus: document.hasFocus(),
			rafShimmed: !!window.requestAnimationFrame.__akinatorAutoRunnerRafShim,
		}
	})
	assert.equal(result.hidden, false, '应覆盖 document.hidden 报告前台')
	assert.equal(result.visibilityState, 'visible', '应覆盖 visibilityState 报告前台')
	assert.equal(result.hasFocus, true, '应覆盖 hasFocus 报告前台')
	assert.ok(result.rafShimmed, '应把 rAF 换成 setTimeout 版，绕开遮挡窗口的 rAF 暂停')
	assert.ok(result.seen.includes('Second page question?'), '过渡应在被遮挡时也完成')
	assert.ok(result.summary.rounds >= 1, '这一局应当正常跑完')
	await page.context().close()
})

test('提供商：clientProvider=api 时改用内置会话、不点页面按钮', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	const result = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		app.updateSettings({ clientProvider: 'api' })
		const character = app.store.addCharacter({ name: 'Api Target' })
		const summary = await app.startRun({ characterId: character.id, mode: 'replay', rounds: 1, askUnknown: false, stepDelayMs: 0 })
		return { summary, clicks: window.__pageClicks.length }
	})
	assert.ok(mock.getGamePosts() >= 1, '内置会话会自己 POST /game')
	assert.equal(result.clicks, 0, '内置会话不应点 akinator 页面按钮')
	await page.context().close()
})

test('提供商：auto 在页面驱动失败时回退到内置会话', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	const result = await page.evaluate(async () => {
		// 让页面按钮「点了不响应」，并缩短等待，尽快触发兜底。
		window.__akinatorAutoRunnerStepTimeoutMs = 300
		/**
		 * 空实现，让页面按钮点了不响应。
		 * @returns {void} 无
		 */
		function noop() {}
		window.mockChooseAnswer = noop
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Fallback Target' })
		const summary = await app.startRun({ characterId: character.id, mode: 'replay', rounds: 1, askUnknown: false, stepDelayMs: 0 })
		return { summary, fallbacks: app.logs.filter((entry) => entry.message.includes('兜底')).length }
	})
	assert.ok(mock.getGamePosts() >= 1, '兜底时应改用内置 HTTP 会话开会话')
	assert.ok(result.fallbacks >= 1, '应记录一条兜底日志')
	assert.equal(result.summary.rounds, 1)
	await page.context().close()
})

test('面板：高级设置里可切换底层提供商', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	await page.locator('#akinator-auto-runner .aar-advanced summary').click()
	const select = page.locator('#akinator-auto-runner [data-field="clientProvider"]')
	await select.waitFor({ state: 'visible', timeout: 15000 })
	assert.equal(await select.inputValue(), 'auto', '默认应为 auto（页面驱动 + 兜底）')
	await select.selectOption('api')
	const value = await page.evaluate(() => window.__akinatorAutoRunnerApp.settings.clientProvider)
	assert.equal(value, 'api', '切换后应写入设置')
	await page.context().close()
})

test('面板：一键导出页面信息（调试）', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	const button = page.locator('#akinator-auto-runner [data-action="dump-page"]')
	await button.waitFor({ state: 'visible', timeout: 15000 })
	const before = await page.evaluate(() => window.__akinatorAutoRunnerApp.logs.length)
	await button.click()
	await page.waitForFunction((count) => window.__akinatorAutoRunnerApp.logs.length > count, before, { timeout: 15000 })
	await page.context().close()
})

test('页面接管：非游戏页开始时先跳到游戏页再自动开跑，问答画在游戏页上', async () => {
	const page = await openPage(
		[
			{ kind: 'question', question: 'Second page question?' },
			{ kind: 'defeat' },
		],
		undefined,
		'/theme-selection',
	)
	// 主题选择页没有游戏区块：开始时脚本应复刻 akinator 的「开始」跳到 /game。
	await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Nav Target' })
		window.__navTargetId = character.id
	})
	await page.evaluate(() => {
		window.__akinatorAutoRunnerApp.startRun({ characterId: window.__navTargetId, mode: 'replay', rounds: 1, askUnknown: false, stepDelayMs: 0 })
	})
	await page.waitForURL('**/game', { timeout: 15000 })
	// 跳转后脚本自动续跑，由 akinator 页面自身的按钮作答并走完这一局。
	await page.waitForFunction(() => window.__akinatorAutoRunnerApp?.lastSession?.running === false, null, { timeout: 20000 })
	const session = await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		return {
			mode: app.lastSession?.mode,
			name: app.store.getCharacter(app.lastSession?.characterId)?.name,
			driven: (window.__pageClicks?.length ?? 0) >= 1,
		}
	})
	assert.equal(session.mode, 'replay', '跳转后应自动续跑')
	assert.equal(session.name, 'Nav Target', '续跑应接着原角色而不是新建')
	assert.ok(session.driven, '续跑应由 akinator 页面自身的按钮驱动')
	await page.context().close()
})

test('页面接管：自动作答倒计时浮层出现在 akinator 页面上，可抢答并选「追加」', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Page Delay Target' })
		const first = app.on('ask', () => app.provideAnswer(0))
		await app.startRun({ characterId: character.id, mode: 'record', rounds: 1, stepDelayMs: 0 })
		first()
		app.startRun({ characterId: character.id, mode: 'record', rounds: 1, stepDelayMs: 60000 })
	})
	await page.locator('#akinator-auto-runner-delay').waitFor({ state: 'visible', timeout: 15000 })
	// 页面上点「否」，与自动预选的「是」不同 → 浮出「纠正 / 追加」。
	await page.locator('#a_no').click()
	await page.locator('#akinator-auto-runner-delay [data-action="intervene"][data-id="append"]').waitFor({ state: 'visible', timeout: 15000 })
	await page.locator('#akinator-auto-runner-delay [data-action="intervene"][data-id="append"]').click()
	await page.waitForFunction(() => window.__akinatorAutoRunnerApp.lastSession?.running === false, null, { timeout: 15000 })
	const answer = await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.listCharacters({}).find((item) => item.name === 'Page Delay Target')
		const key = Object.keys(character?.answers ?? {}).find((item) => item.includes('mock question'))
		return key ? character.answers[key].answer : undefined
	})
	assert.equal(answer, 1, '页面改选「否」后应记下新答案')
	await page.context().close()
})

test('页面接管：页面上的候选「是」按钮驱动选择并让新角色成型', async () => {
	const page = await openPage([
		{ kind: 'proposal', id: 'pika', name: 'Pikachu', description: 'electric mouse', photo: '', candidates: [
			{ id: 'pika', name: 'Pikachu', description: 'electric mouse', photo: '' },
		] },
	])
	await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		app.startRun({ mode: 'record', rounds: 1, stepDelayMs: 0, draft: {} })
	})
	await page.waitForFunction(() => document.getElementById('question-label')?.textContent === 'Is it a mock question?', null, { timeout: 15000 })
	await page.locator('#a_yes').click()
	await page.locator('#proposeGameBlock').waitFor({ state: 'visible', timeout: 15000 })
	assert.equal((await page.locator('#name_proposition').innerText()).trim(), 'Pikachu')
	// 等面板的候选卡出现（引擎已进入等待选择），再点页面上的「是」，避免抢在接管就绪之前点。
	await page.locator('#akinator-auto-runner .aar-proposal').waitFor({ state: 'visible', timeout: 15000 })
	await page.locator('#a_propose_yes').click()
	await page.locator('.aar-created').waitFor({ state: 'visible', timeout: 15000 })
	const name = await page.evaluate(() => window.__akinatorAutoRunnerApp.store.listCharacters({})[0]?.name)
	assert.equal(name, 'Pikachu', '页面点「是」应作为命中并自动命名')
	await page.context().close()
})

/**
 * 注入假通知，记录被创建的通知。
 * @returns {void} 无
 */
function fakeNotificationInit() {
	window.__notifications = []
	/** 假通知，仅记录调用。 */
	class FakeNotification {
		/** @type {string} */
		static permission = 'granted'
		/**
		 * @param {string} title 标题
		 * @param {object} options 选项
		 */
		constructor(title, options) {
			window.__notifications.push({ title, options })
		}
	}
	Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true })
}

test('通知：录制候选不响铃', async () => {
	const page = await openPage(
		[{ kind: 'proposal', id: 'other', name: 'Someone Else', candidates: [{ id: 'other', name: 'Someone Else', description: '', photo: '' }] }],
		fakeNotificationInit,
	)
	await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		app.updateSettings({ bellEnabled: true })
		app.startRun({ mode: 'record', rounds: 1, stepDelayMs: 0, draft: { name: 'Quiet Target' } })
	})
	await page.waitForFunction(() => document.getElementById('question-label')?.textContent === 'Is it a mock question?', null, { timeout: 15000 })
	await page.locator('#a_yes').click()
	await page.locator('#proposeGameBlock').waitFor({ state: 'visible', timeout: 15000 })
	assert.equal(await page.evaluate(() => window.__notifications.length), 0, '录制模式不应响铃 / 发通知')
	await page.context().close()
})

test('通知：回放候选在静默满期后才响铃', async () => {
	const page = await openPage(
		[{ kind: 'proposal', id: 'other', name: 'Someone Else', candidates: [{ id: 'other', name: 'Someone Else', description: '', photo: '' }] }],
		fakeNotificationInit,
	)
	await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		app.updateSettings({ bellEnabled: true, bellDelayMs: 1500, askProposal: true })
		app.provideProposal(null)
		const character = app.store.addCharacter({ name: 'Unknown Target' })
		app.startRun({ characterId: character.id, mode: 'replay', rounds: 1, stepDelayMs: 0, askUnknown: false })
	})
	await page.locator('#proposeGameBlock').waitFor({ state: 'visible', timeout: 15000 })
	assert.equal(await page.evaluate(() => window.__notifications.length), 0, '候选刚出现时不应立即响铃')
	await page.waitForFunction(() => window.__notifications.length >= 1, null, { timeout: 6000 })
	await page.context().close()
})

test('通知：静默期内作答会取消提醒', async () => {
	const page = await openPage([{ kind: 'question', question: 'Ring me?' }, { kind: 'defeat' }], fakeNotificationInit)
	const count = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		app.updateSettings({ bellEnabled: true, bellDelayMs: 300, askUnknown: true })
		app.provideAnswer(null)
		const character = app.store.addCharacter({ name: 'Silent Target' })
		app.on('ask', () => app.provideAnswer(2))
		await app.startRun({ characterId: character.id, mode: 'replay', rounds: 1, askUnknown: true, stepDelayMs: 0 })
		await new Promise((resolve) => setTimeout(resolve, 900))
		return window.__notifications.length
	})
	assert.equal(count, 0, '用户在静默期内作答后不应再响铃')
	await page.context().close()
})

test('面板：答案按钮使用界面语言而非 akinator 的英文标签', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	await page.locator('[data-role="locale"]').waitFor({ state: 'visible', timeout: 15000 })
	await page.locator('[data-role="locale"]').selectOption('zh-CN')
	await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		app.startRun({ mode: 'record', rounds: 1, stepDelayMs: 0, draft: { name: 'Localised' } })
	})
	const label = await page.locator('[data-action="answer"][data-index="0"]').innerText({ timeout: 15000 })
	assert.equal(label.trim(), '是', `答案按钮应本地化，实际 ${label}`)
	await page.context().close()
})

test('订阅：角色列表只建占位，用到时按需拉取并覆盖', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	const result = await page.evaluate(async (origin) => {
		const app = window.__akinatorAutoRunnerApp
		const subscription = app.addSubscription({ kind: 'list', url: `${origin}/pack/index.json`, name: 'remote pack' })
		await app.refreshSubscriptions({ ids: [subscription.id] })
		const placeholder = app.store.listCharacters({}).find((character) => character.name === 'Remote Hero')
		const before = { answers: placeholder ? Object.keys(placeholder.answers).length : -1, loadedAt: placeholder?.source?.loadedAt }
		const loaded = await app.loadRemoteCharacter(placeholder.id)
		return { before, url: loaded.source.url, loadedAt: loaded.source.loadedAt, answers: Object.keys(loaded.answers) }
	}, mock.origin)
	assert.equal(result.before.answers, 0, '列表订阅只登记基础信息，不带答案')
	assert.equal(result.before.loadedAt, 0, '占位角色应标记为尚未加载')
	assert.ok(result.url.endsWith('/pack/remote-hero.json'), `占位应记住角色数据地址，实际 ${result.url}`)
	assert.ok(result.loadedAt > 0, '按需拉取后应打上加载标记')
	assert.deepEqual(result.answers, ['is it a remote?'], '按需拉取应填入真实答案')
	await page.context().close()
})

test('订阅：单个角色数据整体覆盖本地副本', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	const result = await page.evaluate(async (origin) => {
		const app = window.__akinatorAutoRunnerApp
		const character = app.store.addCharacter({ name: 'Remote Hero' })
		app.store.recordAnswer(character.id, { text: 'a local question' }, 1)
		const local = Object.keys(app.store.getCharacter(character.id).answers).length
		const subscription = app.addSubscription({ kind: 'character', url: `${origin}/pack/remote-hero.json`, name: 'remote hero' })
		await app.refreshSubscriptions({ ids: [subscription.id] })
		const updated = app.store.getCharacter(character.id)
		return { local, answers: Object.keys(updated.answers), id: updated.id }
	}, mock.origin)
	assert.equal(result.local, 1, '本地原本有一道自录答案')
	assert.deepEqual(result.answers, ['is it a remote?'], '订阅的单角色数据应整体覆盖本地答案')
	await page.context().close()
})

test('歌单：角色卡加入歌单 + 播放器视图与播放模式切换', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	const first = await page.evaluate(() => window.__akinatorAutoRunnerApp.store.addCharacter({ name: 'Alpha' }).id)
	await page.evaluate(() => window.__akinatorAutoRunnerApp.store.addCharacter({ name: 'Beta' }))
	await page.locator('.aar-tabs [data-tab="characters"]').click()
	const addButton = page.locator(`.aar-card[data-id="${first}"] [data-action="toggle-playlist"]`)
	await addButton.click()
	assert.deepEqual(await page.evaluate(() => window.__akinatorAutoRunnerApp.playlist.ids), [first], '加入歌单后应记录角色 id')
	assert.ok(await page.locator(`.aar-card[data-id="${first}"] [data-action="toggle-playlist"]`).evaluate((element) => element.classList.contains('aar-in-playlist')), '已加入的角色按钮应高亮')

	await page.locator('.aar-tabs [data-tab="player"]').click()
	await page.locator('[data-role="player"]').waitFor({ state: 'visible', timeout: 15000 })
	assert.equal(await page.locator('.aar-playlist .aar-track').count(), 1, '歌单视图应列出队列里的角色')
	assert.equal(await page.locator('[data-role="player-disc"] .aar-disc-photo').count(), 1, '唱片中心应放角色头像')

	const modes = []
	for (let index = 0; index < 3; index++) {
		modes.push(await page.evaluate(() => window.__akinatorAutoRunnerApp.playlist.mode))
		await page.locator('[data-action="playlist-mode"]').click()
	}
	assert.deepEqual(modes, ['loop', 'shuffle', 'single'], '播放模式按钮应按 循环→随机→单曲 轮换')
	await page.context().close()
})

test('歌单：一首跑完按模式自动续播下一首（跨刷新）', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	const ids = await page.evaluate(() => {
		const app = window.__akinatorAutoRunnerApp
		app.updateSettings({ stepDelayMs: 0, askUnknown: true })
		const first = app.store.addCharacter({ name: 'Track A' })
		// A 有这道题的记录，会自己作答；B 没有，会在首题停下等用户——正好让「当前曲目 = B」可观测。
		app.store.recordAnswer(first.id, { text: 'Is it a mock question?' }, 0)
		const second = app.store.addCharacter({ name: 'Track B' })
		app.togglePlaylist(first.id)
		app.togglePlaylist(second.id)
		return { first: first.id, second: second.id }
	})
	await page.evaluate(() => window.__akinatorAutoRunnerApp.playPlaylist().catch(() => undefined))
	// 续播后当前曲目应变成 B，且 B 的这局在首题停下等用户（面板出现出题卡）。
	await page.waitForFunction((second) => {
		const app = window.__akinatorAutoRunnerApp
		if (!app || !app.playlist.active || app.playlist.currentId !== second) return false
		return !!document.getElementById('akinator-auto-runner')?.shadowRoot?.querySelector('.aar-ask')
	}, ids.second, { timeout: 30000 })
	assert.ok(mock.getGamePosts() > 0, '续播应重新 POST /game 跳游戏页（而不是接着旧会话）')
	assert.equal(await page.evaluate(() => window.__akinatorAutoRunnerApp.playlist.currentId), ids.second)
	await page.evaluate(() => window.__akinatorAutoRunnerApp.stopPlaylist())
	assert.equal(await page.evaluate(() => window.__akinatorAutoRunnerApp.playlist.active), false, '停止后歌单应退出播放状态')
	await page.context().close()
})

test('歌单：刷新后没有「待运行」参数也会自动续播，停止按钮退出播放', async () => {
	const page = await openPage([{ kind: 'defeat' }])
	const ids = await page.evaluate(async () => {
		const app = window.__akinatorAutoRunnerApp
		app.updateSettings({ stepDelayMs: 0, askUnknown: true })
		const first = app.store.addCharacter({ name: 'Resume A' })
		// A 有这道题的记录会自己作答；B 没有，会在首题停下等用户——让「续播到了 B」可观测。
		app.store.recordAnswer(first.id, { text: 'Is it a mock question?' }, 0)
		const second = app.store.addCharacter({ name: 'Resume B' })
		app.togglePlaylist(first.id)
		app.togglePlaylist(second.id)
		app.updatePlaylist({ active: true, currentId: first.id })
		await app.saveNow()
		return { first: first.id, second: second.id }
	})
	// 手动刷新：这次加载既没有「待运行」参数，也没有任何运行中的引擎，只剩歌单的播放状态。
	await page.reload()
	await page.waitForFunction(() => !!window.__akinatorAutoRunnerApp, null, { timeout: 20000 })
	await page.waitForFunction((second) => {
		const app = window.__akinatorAutoRunnerApp
		if (!app || !app.playlist.active || app.playlist.currentId !== second) return false
		return !!document.getElementById('akinator-auto-runner')?.shadowRoot?.querySelector('.aar-ask')
	}, ids.second, { timeout: 30000 })
	assert.equal(await page.evaluate(() => window.__akinatorAutoRunnerApp.playlist.currentId), ids.second, '刷新后应接着播放歌单')
	// 运行页的停止按钮要一并退出歌单播放，否则歌单仍标记为播放中、下次加载又会自动续播。
	await page.locator('[data-action="stop"]').click()
	assert.equal(await page.evaluate(() => window.__akinatorAutoRunnerApp.playlist.active), false, '停止按钮应退出歌单播放')
	await page.context().close()
})
