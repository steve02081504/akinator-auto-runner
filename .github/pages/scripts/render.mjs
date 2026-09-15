/**
 * 站点所有渲染函数（角色库、运行面板、数据源、贡献）。
 * @module site/scripts/render
 */

import { ANSWER_I18N_KEYS } from '../shared/constants.mjs'
import { devotionFor, devotionSummary } from '../shared/devotion.mjs'
import { icon } from '../shared/icons.mjs'
import { templatesFor } from '../shared/template.mjs'
import { matchesQuery } from '../shared/util.mjs'

import { geti18n } from './i18n/index.mjs'
import { elementById, valueOf } from './lib/dom.mjs'
import { state } from './state.mjs'

/** 渲染 API（运行时 fetch `views/` 下的模板）。 */
const templates = templatesFor('views')

/** renderAsk 的渲染序号，用于丢弃被后续渲染覆盖的过期结果。 */
let askRenderToken = 0

/**
 * 取全部角色（云端 + 脚本，按 id 去重）。
 * @returns {Promise<Aki.Character[]>} 角色数组
 */
export async function allCharacters() {
	/** @type {Map<string, Aki.Character>} */
	const map = new Map()
	for (const character of state.pageStore.listCharacters({})) map.set(character.id, character)

	if (state.sourceFilter !== 'packs')
		for (const character of state.remoteStore.listCharacters({}))
			if (!map.has(character.id)) map.set(character.id, character)

	return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 角色卡数据。
 * @param {Aki.Character} character 角色
 * @returns {Promise<object>} 模板数据
 */
async function cardData(character) {
	const devotion = devotionSummary(devotionFor(state.remoteDevotion, character.id))
	return {
		id: character.id,
		image: character.image
			? `<img class="avatar" src="${character.image}" alt="" loading="lazy">`
			: `<span class="avatar" aria-hidden="true">${icon('image', { size: 24 })}</span>`,
		name: character.name,
		region: character.region,
		questionCount: geti18n('characters.questionCount', { count: Object.keys(character.answers).length }),
		devotion: devotion.answers ? geti18n('devotion.summary', {
			score: devotion.score,
			answers: devotion.answers,
			contributed: devotion.contributed,
			avgLength: Math.round(devotion.recentAvgLength),
			activeDays: devotion.activeDays,
		}) : '',
		devotionLabel: geti18n('devotion.label'),
		tags: await templates.renderListAsHtmlString('tag', character.tags.map((text) => ({ text }))),
	}
}

/**
 * 渲染按钮与图标等静态填充。
 * @returns {void}
 */
export function renderIcons() {
	const brand = elementById('brand-mark')
	if (brand) brand.innerHTML = icon('sparkles', { size: 21 })

	const locale = elementById('locale-icon')
	if (locale) locale.innerHTML = icon('languages', { size: 14 })

	const github = elementById('github-link')
	if (github) github.innerHTML = icon('github', { size: 18 })

	const search = elementById('search-icon')
	if (search) search.innerHTML = icon('search', { size: 15 })

	const logsDownload = elementById('logs-download')
	if (logsDownload) logsDownload.innerHTML = icon('download', { size: 14 })

	const logsClear = elementById('logs-clear')
	if (logsClear) logsClear.innerHTML = icon('trash', { size: 14 })

	const kicker = elementById('hero-kicker')
	if (kicker) kicker.innerHTML = `${icon('flame', { size: 13 })}<span data-i18n="hero.kicker"></span>`
}

/**
 * 渲染 hero 统计。
 * @returns {Promise<void>} 完成
 */
export async function renderStats() {
	const characters = await allCharacters()
	const answers = characters.reduce((sum, character) => sum + Object.keys(character.answers).length, 0)
	const regions = new Set(characters.map((character) => character.region)).size
	const numbers = { 'stat-characters': characters.length, 'stat-answers': answers, 'stat-regions': regions }
	for (const [id, value] of Object.entries(numbers)) {
		const element = elementById(id)
		if (element) element.textContent = String(value)
	}
}

/**
 * 渲染角色库。
 * @returns {Promise<void>} 完成
 */
export async function renderCharacters() {
	const grid = elementById('character-grid')
	if (!grid) return
	const query = valueOf('search').trim()
	const region = valueOf('region-filter')
	const characters = (await allCharacters()).filter((character) => {
		if (region && character.region !== region) return false
		return matchesQuery(query, [character.name, ...character.aliases, ...character.tags])
	})
	if (characters.length === 0)
		return grid.innerHTML = await templates.renderListAsHtmlString('message', [{ text: geti18n('characters.emptySite') }])

	grid.innerHTML = await templates.renderListAsHtmlString('character-card', await Promise.all(characters.map(cardData)))
}

/**
 * 渲染云端题库列表。
 * @returns {Promise<void>} 完成
 */
export async function renderPacks() {
	const list = elementById('pack-list')
	if (!list) return
	list.innerHTML = state.packs.length
		? await templates.renderListAsHtmlString('pack', state.packs)
		: await templates.renderListAsHtmlString('message', [{ text: geti18n('data.noPacks') }])
}

/**
 * 渲染订阅列表。
 * @returns {Promise<void>} 完成
 */
export async function renderSubscriptions() {
	const list = elementById('sub-list')
	if (!list) return
	if (state.subscriptions.length === 0)
		return list.innerHTML = await templates.renderListAsHtmlString('message', [{ text: geti18n('data.noSubscriptions') }])

	list.innerHTML = await templates.renderListAsHtmlString('subscription', state.subscriptions)
}

/**
 * 渲染运行角色下拉。
 * @returns {Promise<void>} 完成
 */
export async function renderRunCharacters() {
	const select = elementById('run-character')
	if (!(select instanceof HTMLSelectElement)) return
	const current = select.value
	/** @type {object[]} */
	const items = (await allCharacters()).map((character) => ({ value: character.id, label: character.name, selected: character.id === current }))
	// 录制模式也允许选定已有角色续录；用一条空值选项表示「新建角色」。
	if (state.runMode === 'record') items.unshift({ value: '', label: geti18n('run.newCharacterOption'), selected: !current })
	select.innerHTML = await templates.renderListAsHtmlString('option', items)
	if (current && select.querySelector(`option[value="${CSS.escape(current)}"]`)) select.value = current
	renderRunMode()
}

/**
 * 渲染运行状态。
 * @returns {Promise<void>} 完成
 */
export async function renderRunStatus() {
	const box = elementById('run-status')
	if (!box) return
	const run = state.runState
	if (!run)
		return box.innerHTML = await templates.renderListAsHtmlString('message', [{ text: geti18n('run.notStarted') }])

	const progress = Math.round(run.progression || 0)
	box.innerHTML = await templates.renderTemplateAsHtmlString('run-status', {
		progress,
		roundLabel: geti18n('run.roundOf', { round: run.round, rounds: run.rounds || '∞' }),
		stepLabel: geti18n('run.step', { step: run.step }),
		winLabel: geti18n('run.winChip', { count: run.wins }),
		lossLabel: geti18n('run.lossChip', { count: run.losses }),
	})
}

/**
 * 渲染当前问题与作答按钮。
 *
 * `state`（带题目文本）与 `ask`（可作答）两条消息几乎同时到，两次渲染都是异步的；
 * 用序号保证只有最后一次渲染能落盘，免得「可点」的按钮被前一次「不可点」的覆盖掉。
 * @returns {Promise<void>} 完成
 */
export async function renderAsk() {
	const box = elementById('run-question')
	if (!box) return
	const token = ++askRenderToken
	const question = state.askQuestion ?? state.runState?.question
	if (!question)
		return box.innerHTML = await templates.renderListAsHtmlString('message', [{ text: geti18n('run.waiting') }])

	const labels = ANSWER_I18N_KEYS.map((key) => geti18n(key))
	const html = await templates.renderTemplateAsHtmlString('ask', {
		text: question.text,
		buttons: await templates.renderListAsHtmlString('answer-button', labels.map((label, index) => ({
			index,
			label,
			// 自动倒计时期间按钮保持可点，用户才能抢答改选。
			disabled: !state.askQuestion && state.delay?.kind !== 'answer',
		}))),
	})
	if (token !== askRenderToken) return
	box.innerHTML = html
}

/**
 * 渲染候选列表 HTML（命题与倒计时抢答共用）。
 * @param {Aki.Proposal} proposal 候选
 * @param {Aki.Guess} [suggested] 命中候选
 * @returns {Promise<string>} HTML
 */
function candidatesHtml(proposal, suggested) {
	return templates.renderListAsHtmlString('candidate', proposal.candidates.slice(0, 24).map((candidate) => ({
		id: candidate.id,
		name: candidate.name,
		photo: candidate.photo,
		hit: !!suggested && candidate.id === suggested.id,
	})))
}

/**
 * 渲染自动决策倒计时与「纠正 / 追加」询问。
 * @returns {Promise<void>} 完成
 */
export async function renderDelay() {
	const box = elementById('run-delay')
	if (!box) return
	const labels = ANSWER_I18N_KEYS.map((key) => geti18n(key))
	const parts = []
	if (state.delay) parts.push(await templates.renderTemplateAsHtmlString('delay', {
		durationMs: Math.max(0, Math.round(state.delay.durationMs)),
		label: geti18n(state.delay.kind === 'answer' ? 'run.delayAnswer' : 'run.delayProposal', { answer: labels[state.delay.answer ?? 2] ?? '' }),
		candidates: state.delay.kind === 'proposal' && state.delay.proposal ? await candidatesHtml(state.delay.proposal, state.delay.suggested) : '',
	}))
	if (state.intervention) parts.push(await templates.renderTemplateAsHtmlString('intervention', {
		title: geti18n('run.interveneTitle', { answer: labels[state.intervention.clicked] ?? '', original: labels[state.intervention.original] ?? '' }),
	}))
	box.innerHTML = parts.join('')
}

/**
 * 渲染候选选择。
 * @returns {Promise<void>} 完成
 */
export async function renderProposal() {
	const box = elementById('run-proposal')
	if (!box) return
	if (!state.proposal) return box.replaceChildren()

	box.innerHTML = await templates.renderTemplateAsHtmlString('proposal', {
		candidates: await candidatesHtml(state.proposal, state.suggested),
	})
}

/**
 * 渲染「边录边建」结果卡。
 * @returns {Promise<void>} 完成
 */
export async function renderCreated() {
	const box = elementById('run-created')
	if (!box) return
	const created = state.created
	if (!created) return box.replaceChildren()

	box.innerHTML = await templates.renderTemplateAsHtmlString('created', {
		id: created.id,
		title: geti18n(created.merged ? 'run.mergedTitle' : 'run.createdTitle', { name: created.name ?? '' }),
		hint: geti18n(created.merged ? 'run.mergedHint' : 'run.createdHint', { count: created.questions }),
	})
}

/**
 * 渲染日志。
 * @returns {Promise<void>} 完成
 */
export async function renderLogs() {
	const box = elementById('run-logs')
	if (!box) return
	box.innerHTML = await templates.renderListAsHtmlString('log', state.logs.slice(-200))
	box.scrollTop = box.scrollHeight
	const count = elementById('logs-count')
	if (count) count.textContent = geti18n('logs.count', { count: state.logs.length })
}

/**
 * 刷新区域过滤下拉。
 * @returns {Promise<void>} 完成
 */
export async function renderRegionFilter() {
	const select = elementById('region-filter')
	if (!(select instanceof HTMLSelectElement)) return
	const regions = [...new Set((await allCharacters()).map((character) => character.region))].sort()
	const current = select.value
	select.innerHTML = await templates.renderListAsHtmlString('option', [
		{ value: '', label: geti18n('characters.allRegions'), selected: current === '' },
		...regions.map((region) => ({ value: region, label: region, selected: region === current })),
	])
}

/**
 * 渲染贡献预览（选择角色并展示 JSON）。
 * @param {(id: string) => string} characterJson 生成单角色 JSON 的函数
 * @returns {Promise<void>} 完成
 */
export async function renderContribute(characterJson) {
	const select = elementById('contribute-character')
	const preview = elementById('contribute-preview')
	if (!(select instanceof HTMLSelectElement) || !(preview instanceof HTMLTextAreaElement)) return
	const current = select.value
	select.innerHTML = await templates.renderListAsHtmlString('option', (await allCharacters()).map((character) => ({ value: character.id, label: character.name, selected: character.id === current })))
	select.value = current
	preview.value = characterJson(select.value)
}

/**
 * 渲染运行模式（回放 / 录制）对应的控件。
 * @returns {void}
 */
export function renderRunMode() {
	const record = state.runMode === 'record'
	for (const button of document.querySelectorAll('#run-mode .seg-item'))
		button.classList.toggle('active', button.getAttribute('data-mode') === state.runMode)

	const select = elementById('run-character')
	const selectedValue = select instanceof HTMLSelectElement ? select.value : ''
	const selectedName = select instanceof HTMLSelectElement ? select.selectedOptions[0]?.textContent ?? '' : ''
	// 录制模式下只有在选「新建角色」（空值）时才显示名字输入；选定已有角色则直接续录它。
	elementById('run-name-field')?.classList.toggle('hidden', !record || !!selectedValue)

	const hint = elementById('run-mode-hint')
	if (hint) {
		const key = record ? selectedValue ? 'run.recordIntoHint' : 'run.newCharacterHint' : 'run.replayHint'
		hint.dataset.i18n = key
		// 带上参数：语言切换时 i18n 会拿 dataset 重新插值，否则 ${name} 会留成字面量。
		if (selectedName) hint.dataset.name = selectedName
		else delete hint.dataset.name
		hint.textContent = geti18n(key, { name: selectedName })
	}
}
