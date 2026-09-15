/**
 * GitHub Pages 站点入口：装配本地化 / 主题、渲染题库、绑定事件，并通过
 * `window.open` 打开 akinator 窗口 + postMessage 驱动录制与回放。
 * @module site/scripts/index
 */

import { LOG_FILE_PREFIX } from '../shared/constants.mjs'
import { i18nElement } from '../shared/i18n/index.mjs'
import { icon } from '../shared/icons.mjs'
import { MessageType } from '../shared/protocol.mjs'
import { fileStamp, formatLogReport } from '../shared/report.mjs'
import { ensureDatabase } from '../shared/schema.mjs'
import { templatesFor } from '../shared/template.mjs'
import { download } from '../shared/util.mjs'

import { characterJson, contributeToGithub, downloadCharacter, exportDatabase, initDataControls, loadPacks, loadText, refreshSubscription, refreshSubscriptions, reloadPacks } from './actions.mjs'
import { onMessage, openWindow, send, startPinging, startPopupWatch, updateConnection } from './bridge.mjs'
import { currentLocale, geti18n, initLocale, LOCALE_CODES, localeLabel, setLocale } from './i18n/index.mjs'
import { elementById, valueOf } from './lib/dom.mjs'
import { onAdAction, renderSponsor } from './parts/sponsor.mjs'
import { renderCharacters, renderContribute, renderCreated, renderIcons, renderLogs, renderProposal, renderRegionFilter, renderRunCharacters, renderRunMode, renderStats, renderSubscriptions } from './render.mjs'
import { state } from './state.mjs'
import { cycleTheme, initTheme } from './theme/index.mjs'

/** 渲染 API（运行时 fetch `views/` 下的模板）。 */
const templates = templatesFor('views')

/**
 * 渲染头部（语言、主题与图标）。
 * @returns {Promise<void>} 完成
 */
async function renderChrome() {
	const localeSelect = elementById('locale-select')
	if (localeSelect instanceof HTMLSelectElement)
		localeSelect.innerHTML = await templates.renderListAsHtmlString('option', LOCALE_CODES.map((code) => ({
			value: code,
			label: localeLabel(code),
			selected: code === currentLocale(),
		})))

	const themeButton = elementById('toggle-theme')
	if (themeButton) themeButton.innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'moon' : 'sun', { size: 17 })

	renderIcons()

	const kicker = elementById('hero-kicker')
	if (kicker) i18nElement(kicker)
}

/**
 * 渲染全部动态视图。
 * @returns {Promise<void>} 完成
 */
function renderAll() {
	return Promise.all([
		renderChrome(),
		renderStats(),
		renderCharacters(),
		renderRunCharacters(),
		renderRunMode(),
		renderRegionFilter(),
		renderSubscriptions(),
		renderCreated(),
		renderContribute(characterJson),
		renderSponsor(),
	])
}

/**
 * 切换标签页。
 * @param {string} name 标签名
 * @returns {void}
 */
function switchTab(name) {
	for (const button of document.querySelectorAll('.tab')) button.classList.toggle('tab-active', button.getAttribute('data-tab') === name)
	for (const panel of document.querySelectorAll('.panel')) panel.classList.toggle('hidden', panel.getAttribute('data-panel') !== name)
	if (name === 'contribute') renderContribute(characterJson)
}

/**
 * 开始运行。
 *
 * 录制模式无需先选角色：留空即由脚本自动建一个占位角色边录边建。
 * @returns {void}
 */
function startRun() {
	if (!state.connected) {
		alert(geti18n('run.needScript'))
		return
	}
	/** @type {Aki.StartRunRequest} */
	const options = { mode: state.runMode }
	if (state.runMode === 'record') {
		// 下拉里选定已有角色就续录它；选「新建角色」（空值）才用名字（留空则自动命名）建占位角色。
		const select = elementById('run-character')
		const selected = select instanceof HTMLSelectElement ? select.value : ''
		if (selected) options.characterId = selected
		else options.draft = { name: valueOf('run-name').trim() }
	} else {
		const select = elementById('run-character')
		if (!(select instanceof HTMLSelectElement) || !select.value) {
			alert(geti18n('run.noCharacter'))
			return
		}
		options.characterId = select.value
	}
	state.logs = []
	state.created = undefined
	renderCreated()
	send(MessageType.command, { action: 'start', options })
}

/**
 * 下载日志报告（把 akinator 窗口里脚本的日志 + 站点侧上下文一起带出）。
 * @returns {void}
 */
function downloadLogs() {
	const meta = {
		version: state.hello?.version ?? 'unknown',
		page: location.href,
		region: state.region,
		characters: state.hello?.characters ?? 0,
		source: state.remoteStore.db.name ?? '',
		settings: JSON.stringify(state.settings ?? {}),
	}
	download(`${LOG_FILE_PREFIX}-${fileStamp()}.txt`, formatLogReport(meta, state.logs), 'text/plain')
}

/**
 * 切换运行模式。
 * @param {string} mode 模式
 * @returns {void}
 */
function setRunMode(mode) {
	state.runMode = mode === 'record' ? 'record' : 'replay'
	// 用户没显式选过角色时，切到录制默认「新建角色」，免得顺手把首题录进题库里的第一个角色。
	if (state.runMode === 'record' && !state.runCharacterPicked) {
		const select = elementById('run-character')
		if (select instanceof HTMLSelectElement) select.value = ''
	}
	renderRunCharacters()
	renderRunMode()
}

/**
 * 连接 akinator：记录区域、打开（或聚焦）独立窗口并开始探测脚本。
 * @returns {void}
 */
function connect() {
	state.region = valueOf('region-select') || 'en'
	state.connected = false
	updateConnection()
	if (!openWindow()) {
		alert(geti18n('run.popupBlocked'))
		return
	}
	startPinging()
}

/**
 * 绑定全部事件。
 * @returns {void}
 */
function bindEvents() {
	window.addEventListener('message', onMessage)
	document.addEventListener('click', onAdAction)

	elementById('tabs')?.addEventListener('click', (event) => {
		if (!(event.target instanceof Element)) return
		const tab = event.target.closest('.tab')
		if (tab) switchTab(tab.getAttribute('data-tab') ?? '')
	})

	elementById('locale-select')?.addEventListener('change', (event) => {
		if (event.target instanceof HTMLSelectElement) setLocale(event.target.value)
	})
	elementById('toggle-theme')?.addEventListener('click', () => {
		cycleTheme()
		renderChrome()
	})

	elementById('hero-run')?.addEventListener('click', () => {
		switchTab('run')
		elementById('start-run')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
	})

	elementById('search')?.addEventListener('input', () => renderCharacters())
	elementById('region-filter')?.addEventListener('change', () => renderCharacters())
	elementById('source-filter')?.addEventListener('change', () => {
		state.sourceFilter = valueOf('source-filter')
		renderCharacters()
		renderRunCharacters()
	})
	elementById('reload-packs')?.addEventListener('click', reloadPacks)

	elementById('character-grid')?.addEventListener('click', (event) => {
		if (!(event.target instanceof Element)) return
		const button = event.target.closest('[data-action]')
		if (!button) return
		const id = button.getAttribute('data-id') ?? ''
		const action = button.getAttribute('data-action')
		if (action === 'run') {
			switchTab('run')
			setRunMode('replay')
			const select = elementById('run-character')
			if (select instanceof HTMLSelectElement) select.value = id
			state.runCharacterPicked = true
			renderRunMode()
		} else if (action === 'download')
			downloadCharacter(id)
		else
			contributeToGithub(id)
	})

	elementById('connect')?.addEventListener('click', connect)
	elementById('start-run')?.addEventListener('click', startRun)
	elementById('stop-run')?.addEventListener('click', () => send(MessageType.command, { action: 'stop' }))
	elementById('logs-download')?.addEventListener('click', downloadLogs)
	elementById('logs-clear')?.addEventListener('click', () => {
		if (!state.logs.length || !confirm(geti18n('logs.clearConfirm'))) return
		state.logs = []
		renderLogs()
	})

	elementById('run-mode')?.addEventListener('click', (event) => {
		if (!(event.target instanceof Element)) return
		const button = event.target.closest('[data-mode]')
		if (button) setRunMode(button.getAttribute('data-mode') ?? 'replay')
	})

	elementById('run-character')?.addEventListener('change', () => {
		state.runCharacterPicked = true
		renderRunMode()
	})

	elementById('run-created')?.addEventListener('click', (event) => {
		if (!(event.target instanceof Element)) return
		const button = event.target.closest('[data-action]')
		if (!button) return
		const id = button.getAttribute('data-id') ?? ''
		if (button.getAttribute('data-action') === 'replay-created') {
			setRunMode('replay')
			const select = elementById('run-character')
			if (select instanceof HTMLSelectElement) select.value = id
			state.runCharacterPicked = true
			renderRunMode()
		} else {
			switchTab('contribute')
			const select = elementById('contribute-character')
			if (select instanceof HTMLSelectElement) select.value = id
			renderContribute(characterJson)
		}
	})

	elementById('run-question')?.addEventListener('click', (event) => {
		if (!(event.target instanceof Element)) return
		const button = event.target.closest('[data-answer]')
		if (!button) return
		state.askQuestion = undefined
		send(MessageType.command, { action: 'answer', answer: Number(button.getAttribute('data-answer')) })
	})

	elementById('run-delay')?.addEventListener('click', (event) => {
		if (!(event.target instanceof Element)) return
		const intervene = event.target.closest('[data-intervene]')
		if (intervene) {
			state.intervention = undefined
			send(MessageType.command, { action: 'intervene', treatment: intervene.getAttribute('data-intervene') === 'correct' ? 'correct' : 'append' })
			return
		}
		const pick = event.target.closest('[data-pick]')
		if (pick) send(MessageType.command, { action: 'proposal', decision: { action: 'pick', pickId: pick.getAttribute('data-pick') ?? '', manual: true } })
	})

	elementById('run-proposal')?.addEventListener('click', (event) => {
		if (!(event.target instanceof Element)) return
		const pick = event.target.closest('[data-pick]')
		if (pick) {
			state.proposal = undefined
			send(MessageType.command, { action: 'proposal', decision: { action: 'pick', pickId: pick.getAttribute('data-pick') ?? '', manual: true } })
			return
		}
		if (event.target.closest('#exclude-proposal')) {
			state.proposal = undefined
			send(MessageType.command, { action: 'proposal', decision: { action: 'exclude', manual: true } })
		}
	})

	elementById('pack-list')?.addEventListener('click', async (event) => {
		if (!(event.target instanceof Element)) return
		const button = event.target.closest('[data-pack]')
		if (!button) return
		const url = button.getAttribute('data-pack') ?? ''
		try {
			const response = await fetch(url, { cache: 'no-cache' })
			loadText(await response.text(), { url, name: url })
			await renderCharacters()
			await renderRunCharacters()
			await renderStats()
		} catch (error) {
			alert(String(error))
		}
	})

	elementById('sub-list')?.addEventListener('click', (event) => {
		if (!(event.target instanceof Element)) return
		const button = event.target.closest('[data-action]')
		if (!button) return
		const id = button.closest('[data-id]')?.getAttribute('data-id')
		if (!id) return
		if (button.getAttribute('data-action') === 'remove') {
			state.subscriptions = state.subscriptions.filter((item) => item.id !== id)
			renderSubscriptions()
		} else
			refreshSubscription(id)
	})
	elementById('sub-add')?.addEventListener('click', () => {
		const url = valueOf('sub-url').trim()
		if (!url) return
		state.subscriptions.push({
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			kind: 'character',
			url,
			name: url,
			enabled: true,
			autoUpdate: true,
		})
		renderSubscriptions()
	})
	elementById('sub-refresh')?.addEventListener('click', refreshSubscriptions)

	elementById('local-file')?.addEventListener('change', async (event) => {
		const { target } = event
		if (!(target instanceof HTMLInputElement) || !target.files?.[0]) return
		const text = await target.files[0].text()
		try {
			const database = ensureDatabase(JSON.parse(text), target.files[0].name)
			state.pageStore.replace(database)
			await renderAll()
		} catch (error) {
			alert(String(error))
		}
	})
	elementById('export-local')?.addEventListener('click', exportDatabase)

	elementById('contribute-character')?.addEventListener('change', () => renderContribute(characterJson))
	elementById('contribute-pr')?.addEventListener('click', () => contributeToGithub(valueOf('contribute-character')))
	elementById('contribute-copy')?.addEventListener('click', async () => {
		await navigator.clipboard.writeText(valueOf('contribute-preview'))
	})
	elementById('contribute-download')?.addEventListener('click', () => downloadCharacter(valueOf('contribute-character')))
}

/**
 * 入口。
 * @returns {Promise<void>} 完成
 */
async function init() {
	initTheme()
	await initLocale()
	bindEvents()
	updateConnection()
	startPopupWatch()
	renderProposal()
	initDataControls()
	await renderAll()
	loadPacks()
}

init()
