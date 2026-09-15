/**
 * 面板的 DOM 事件 -> 应用动作。
 * @module userscript/ui/events
 */

import { LOG_FILE_PREFIX, SID } from '../../shared/constants.mjs'
import { fileStamp, formatLogReport } from '../../shared/report.mjs'
import { answerWeights, normalizeAnswerRecord } from '../../shared/schema.mjs'
import { applyTheme, nextTheme } from '../../shared/theme.mjs'
import { asRecord, deepClone, download, now } from '../../shared/util.mjs'
import { dumpPage } from '../debug.mjs'
import { geti18n, setLocale } from '../i18n.mjs'

/** 播放器「切换播放模式」按钮的循环顺序。 */
const PLAYLIST_MODE_CYCLE = ['loop', 'shuffle', 'single']

/**
 * 点击处理。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @param {Event} event 事件
 * @returns {void}
 */
export function handleClick(ui, event) {
	if (!(event.target instanceof Element)) return
	const button = event.target.closest('[data-action]')
	if (!button) return
	const action = button.getAttribute('data-action')
	const id = button.getAttribute('data-id') ?? button.getAttribute('data-index') ?? undefined
	switch (action) {
		case 'collapse':
			ui.toggleCollapsed()
			return
		case 'expand':
			ui.setExpanded(!ui.expanded)
			if (ui.expanded) ui.collapsed = false
			ui.host?.classList.toggle('aar-collapsed', ui.collapsed)
			ui.render()
			return
		case 'toggle-theme':
			ui.app.updateSettings({ theme: nextTheme(ui.app.settings.theme) })
			applyTheme(ui.app.settings.theme, ui.host)
			ui.render()
			return
		case 'mode': {
			const mode = button.getAttribute('data-mode') === 'record' ? 'record' : 'replay'
			ui.app.updateSettings({ mode })
			ui.renderBody()
			return
		}
		case 'dismiss-created':
			ui.created = undefined
			ui.renderBody()
			return
		case 'view-character':
			ui.created = undefined
			ui.editing = undefined
			ui.setTab('characters')
			return
		case 'tab': {
			const tab = button.getAttribute('data-tab')
			if (tab === 'run' || tab === 'characters' || tab === 'data' || tab === 'player') ui.setTab(tab)
			return
		}
		default:
			handleAction(ui, action, id)
	}
}

/**
 * 执行动作。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @param {string} action 动作名
 * @param {string | undefined} id 关联 id
 * @returns {void}
 */
function handleAction(ui, action, id) {
	switch (action) {
		case 'start':
			startRun(ui)
			break
		case 'stop':
			// 停止即退出歌单播放：否则歌单仍标记为播放中，页面重载后会自动续播回来。
			ui.app.stopPlaylist()
			break
		case 'answer':
			ui.askQuestion = undefined
			ui.askRecorded = undefined
			ui.askReason = undefined
			ui.app.provideAnswer(Number(id))
			ui.renderBody()
			break
		case 'pick-candidate':
			ui.proposal = undefined
			ui.app.provideProposal({ action: 'pick', pickId: id, manual: true })
			ui.renderBody()
			break
		case 'exclude-proposal':
			ui.proposal = undefined
			ui.app.provideProposal({ action: 'exclude', manual: true })
			ui.renderBody()
			break
		case 'intervene':
			ui.intervention = undefined
			ui.app.resolveIntervention(id === 'correct' ? 'correct' : 'append')
			ui.renderBody()
			break
		case 'run-character':
			// 点播放不强行切到运行页：留在当前标签页；只有需要人补充答案 / 纠正时才切过去。
			ui.selectedCharacterId = id ?? ''
			ui.editing = undefined
			ui.created = undefined
			ui.render()
			startRun(ui, 'replay')
			break
		case 'edit-character':
			editCharacter(ui, id)
			break
		case 'export-character':
			if (id) ui.app.exportCharacter(id)
			break
		case 'delete-character':
			if (id && confirm(geti18n('characters.deleteConfirm'))) ui.app.store.removeCharacter(id)
			break
		case 'toggle-playlist':
			if (id) ui.app.togglePlaylist(id)
			break
		case 'playlist-play':
			reportPlaylistError(ui, ui.app.playPlaylist())
			break
		case 'playlist-pause':
			ui.app.stopPlaylist()
			break
		case 'playlist-prev':
			reportPlaylistError(ui, ui.app.stepTrack(-1))
			break
		case 'playlist-next':
			reportPlaylistError(ui, ui.app.stepTrack(1))
			break
		case 'playlist-play-track':
			if (id) reportPlaylistError(ui, ui.app.playTrack(id))
			break
		case 'playlist-remove':
			if (id) ui.app.removePlaylistItem(id)
			break
		case 'playlist-mode':
			ui.app.setPlaylistMode(nextPlaylistMode(ui.app.playlist.mode))
			break
		case 'playlist-clear':
			if (ui.app.playlist.ids.length && confirm(geti18n('playlist.clearConfirm'))) ui.app.clearPlaylist()
			break
		case 'new-character':
			ui.editing = { draft: { name: '', aliases: [], tags: [], answers: {}, region: ui.app.currentRegion(), sid: SID.character } }
			ui.renderBody()
			break
		case 'save-character':
			saveCharacter(ui)
			break
		case 'cancel-edit':
			ui.editing = undefined
			ui.renderBody()
			break
		case 'link-folder':
			ui.app.linkFolder().then(() => ui.render()).catch((error) => alert(String(error)))
			break
		case 'save-now':
			ui.app.saveNow().then(() => ui.renderLogs())
			break
		case 'export-folder':
			ui.app.exportDatabaseFolder().catch((error) => alert(String(error)))
			break
		case 'add-sub':
			addSubscription(ui)
			break
		case 'refresh-subs':
			ui.app.refreshSubscriptions().then(() => ui.renderBody())
			break
		case 'sub-refresh':
			ui.app.refreshSubscriptions({ ids: id ? [id] : undefined }).then(() => ui.renderBody())
			break
		case 'sub-delete':
			if (id) {
				ui.app.removeSubscription(id)
				ui.renderBody()
			}
			break
		case 'download-logs':
			downloadLogs(ui)
			break
		case 'dump-page':
			dumpPage(ui.app).catch((error) => console.error('[akinator-auto-runner]', error))
			break
		case 'clear-logs':
			if (ui.app.logs.length && confirm(geti18n('logs.clearConfirm'))) ui.app.clearLogs()
			break
		case 'resume-session': {
			const session = ui.app.lastSession
			if (!session || !ui.app.store.getCharacter(session.characterId)) break
			ui.selectedCharacterId = session.characterId
			ui.newName = ''
			ui.app.updateSettings({ mode: session.mode })
			startRun(ui, session.mode, session.characterId)
			break
		}
		case 'dismiss-session':
			ui.app.clearSession()
			ui.renderBody()
			break
		default:
			break
	}
}

/**
 * 开始运行。
 *
 * 录制模式无需先选角色：留空即自动建一个占位角色边录边建；回放模式仍须选定角色。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @param {'record' | 'replay'} [modeOverride] 强制指定模式（角色卡上的「运行 / 回放」按钮用）
 * @param {string} [characterIdOverride] 强制指定角色（续跑上次会话时用来接着同一个角色录）
 * @returns {void}
 */
function startRun(ui, modeOverride, characterIdOverride) {
	ui.askQuestion = undefined
	ui.askRecorded = undefined
	ui.askReason = undefined
	ui.lastGuess = undefined
	ui.created = undefined
	const mode = modeOverride ?? (ui.app.settings.mode === 'record' ? 'record' : 'replay')
	/** @type {Aki.StartRunRequest} */
	const options = { mode }
	if (mode === 'record') {
		// 下拉里选定已有角色就续录它；选「新建角色」才用名字（留空则自动命名）建占位角色。
		const selected = characterIdOverride || ui.selectedCharacterId
		if (selected && ui.app.store.getCharacter(selected)) options.characterId = selected
		else options.draft = { name: ui.newName.trim() }
	} else {
		const characterId = characterIdOverride || ui.selectedCharacterId || ui.app.store.listCharacters({})[0]?.id
		if (!characterId) {
			alert(geti18n('run.noCharacter'))
			return
		}
		ui.selectedCharacterId = characterId
		options.characterId = characterId
	}
	ui.renderBody()
	ui.app.startRun(options).catch((error) => {
		ui.app.pushLog({ time: now(), level: 'error', message: String(error) })
	})
}

/**
 * 计算下一个播放模式（循环 → 随机 → 单曲）。
 * @param {string} mode 当前模式
 * @returns {Aki.PlaylistMode} 下一个模式
 */
function nextPlaylistMode(mode) {
	const index = PLAYLIST_MODE_CYCLE.indexOf(mode)
	return PLAYLIST_MODE_CYCLE[(index + 1) % PLAYLIST_MODE_CYCLE.length]
}

/**
 * 执行一个可能失败的歌单动作（播放 / 切歌），失败时记进日志。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @param {Promise<void>} promise 动作
 * @returns {void} 无
 */
function reportPlaylistError(ui, promise) {
	promise.catch((error) => ui.app.pushLog({ time: now(), level: 'error', message: String(error) }))
}

/**
 * 保存角色编辑器内容。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {void}
 */
function saveCharacter(ui) {
	if (!ui.shadow) return
	const draft = {
		name: readField(ui, 'name').trim(),
		aliases: splitList(readField(ui, 'aliases')),
		description: readField(ui, 'description'),
		image: readField(ui, 'image').trim(),
		tags: splitList(readField(ui, 'tags')),
		region: readField(ui, 'region').trim() || ui.app.currentRegion(),
		sid: Number(readField(ui, 'sid')) || SID.character,
		answers: ui.editing?.draft?.answers ?? {},
	}
	if (!draft.name) {
		alert(geti18n('characters.nameRequired'))
		return
	}
	if (ui.editing?.id) ui.app.store.updateCharacter(ui.editing.id, draft)
	else ui.app.store.addCharacter(draft)
	ui.app.store.simplifyWeights()
	ui.editing = undefined
	ui.render()
}

/**
 * 读取编辑器中某个字段的值。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @param {string} field 字段名
 * @returns {string} 值
 */
function readField(ui, field) {
	const element = ui.shadow?.querySelector(`[data-field="${field}"]`)
	if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value
	return ''
}

/**
 * 读取面板里某个控件的值。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @param {string} selector 选择器
 * @returns {string} 值
 */
function readValue(ui, selector) {
	const element = ui.shadow?.querySelector(selector)
	if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return element.value
	return ''
}

/**
 * 把选择的图片读成 data URL 填进编辑器。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @param {File} file 图片文件
 * @returns {void}
 */
function readImage(ui, file) {
	const reader = new FileReader()
	/** 读取完成后把 data URL 填入编辑器草稿。 */
	reader.onload = () => {
		if (ui.editing && typeof reader.result === 'string') {
			ui.editing.draft.image = reader.result
			ui.renderBody()
		}
	}
	reader.readAsDataURL(file)
}

/**
 * 打开角色编辑器；远程订阅的角色先按需拉取最新数据并覆盖本地副本。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @param {string | undefined} id 角色 id
 * @returns {void}
 */
function editCharacter(ui, id) {
	if (!id) return
	ui.app.loadRemoteCharacter(id).then((character) => {
		if (!character || ui.editing) return
		ui.editing = {
			id: character.id,
			draft: { ...character, aliases: [...character.aliases], tags: [...character.tags], answers: deepClone(character.answers) },
		}
		ui.renderBody()
	}).catch((error) => alert(String(error)))
}

/**
 * 新增一条订阅。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {void}
 */
function addSubscription(ui) {
	const url = readValue(ui, '[data-role="sub-url"]').trim()
	if (!url) return
	const kind = readValue(ui, '[data-role="sub-kind"]') === 'character' ? 'character' : 'list'
	ui.app.addSubscription({ kind, url })
	ui.renderBody()
}

/**
 * 下载日志报告（含环境信息与运行上下文，便于汇报 / 排查）。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {void}
 */
function downloadLogs(ui) {
	download(`${LOG_FILE_PREFIX}-${fileStamp()}.txt`, formatLogReport(logReportMeta(ui), ui.app.logs), 'text/plain')
	ui.app.pushLog({ time: now(), level: 'info', message: geti18n('logs.downloaded', { count: ui.app.logs.length }) })
}

/**
 * 日志报告头部信息。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {Record<string, string>} 键值对
 */
function logReportMeta(ui) {
	const marker = asRecord(globalThis.__akinatorAutoRunner)
	const session = ui.app.lastSession
	const characters = Object.values(ui.app.store.db.characters)
	const answers = characters.reduce((sum, character) => sum + Object.keys(character.answers).length, 0)
	return {
		version: String(marker.version ?? 'unknown'),
		page: location.href,
		region: ui.app.currentRegion(),
		database: `${characters.length} characters / ${answers} answers`,
		source: ui.app.sourceName,
		settings: JSON.stringify(ui.app.settings),
		session: session
			? `${session.mode} ${session.characterId} · round ${session.round} · step ${session.step} · ${session.wins}W/${session.losses}L · running=${session.running}`
			: '',
	}
}

/**
 * 选项变化处理。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @param {Event} event 事件
 * @returns {void}
 */
export function handleChange(ui, event) {
	const { target } = event
	if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return
	const action = target.getAttribute('data-action')
	const field = target.getAttribute('data-field')
	const id = target.closest('[data-id]')?.getAttribute('data-id') ?? undefined
	switch (action) {
		case 'select-character':
			ui.selectedCharacterId = target.value
			ui.renderBody()
			return
		case 'locale':
			setLocale(target.value, (locale) => ui.app.updateSettings({ language: locale }))
			return
		case 'image-file':
			if (target.files?.[0]) readImage(ui, target.files[0])
			return
		case 'sub-enabled':
			if (id) ui.app.updateSubscription(id, { enabled: target.checked })
			return
		case 'sub-auto':
			if (id) ui.app.updateSubscription(id, { autoUpdate: target.checked })
			return
		case 'search':
			ui.query = target.value
			ui.renderBody()
			return
		default: {
			if (!field || inEditor(ui)) return
			const patch = settingsPatch(field, target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value)
			if (Object.keys(patch).length) ui.app.updateSettings(patch)
		}
	}
}

/**
 * 输入处理（用于编辑器实时缓冲）。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @param {Event} event 事件
 * @returns {void}
 */
export function handleInput(ui, event) {
	const { target } = event
	if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return
	const field = target.getAttribute('data-field')
	if (!field) return
	const { value } = target
	if (field === 'new-name') {
		ui.newName = value
		return
	}
	if (field === 'weight') {
		updateWeight(ui, target)
		return
	}
	if (!inEditor(ui)) return
	if (field === 'aliases') ui.editing.draft.aliases = splitList(value)
	else if (field === 'tags') ui.editing.draft.tags = splitList(value)
	else ui.editing.draft[field] = value
}

/**
 * 更新角色编辑器里某题某个回答的权重，并就地刷新该题的百分比与分布条。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @param {HTMLInputElement} input 权重输入框
 * @returns {void} 无
 */
function updateWeight(ui, input) {
	const answers = ui.editing?.draft?.answers
	const key = input.getAttribute('data-key') ?? ''
	const index = Number(input.getAttribute('data-index'))
	const record = answers?.[key]
	if (!record || !Number.isInteger(index) || index < 0) return
	const weights = answerWeights(record)
	weights[index] = Math.max(0, Number(input.value) || 0)
	const updated = normalizeAnswerRecord({ ...record, weights })
	answers[key] = updated
	const row = input.closest('.aar-q-editable')
	if (!row) return
	const total = updated.weights.reduce((sum, item) => sum + item, 0)
	for (const node of row.querySelectorAll('.aar-weight')) {
		const item = Number(node.getAttribute('data-index'))
		const percent = total ? Math.round(updated.weights[item] / total * 100) : 0
		const bar = node.querySelector('.aar-weight-bar > i')
		if (bar instanceof HTMLElement) bar.style.width = `${percent}%`
		const label = node.querySelector('.aar-weight-pct')
		if (label) label.textContent = `${percent}%`
	}
}

/**
 * 面板当前是否正显示角色编辑器（编辑态只属于「角色」标签页）。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {boolean} 是否在编辑器
 */
function inEditor(ui) {
	return !!ui.editing && ui.tab === 'characters'
}

/**
 * 逗号列表拆分。
 * @param {string} value 文本
 * @returns {string[]} 列表
 */
function splitList(value) {
	return value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean)
}

/**
 * 根据设置字段生成补丁。
 * @param {string} field 字段
 * @param {unknown} value 值
 * @returns {Partial<Aki.Settings>} 补丁
 */
function settingsPatch(field, value) {
	switch (field) {
		case 'rounds':
			return { rounds: Number(value) || 1 }
		case 'clientProvider':
			return { clientProvider: value === 'page' || value === 'api' ? value : 'auto' }
		case 'stepDelayMs':
			return { stepDelayMs: Number(value) || 0 }
		case 'maxSteps':
			return { maxSteps: Number(value) || 80 }
		case 'bellDelayMs':
			return { bellDelayMs: Math.max(0, Number(value) || 0) }
		case 'askUnknown':
			return { askUnknown: !!value }
		case 'askProposal':
			return { askProposal: !!value }
		case 'stopOnWin':
			return { stopOnWin: !!value }
		case 'bellEnabled':
			return { bellEnabled: !!value }
		default:
			return {}
	}
}
