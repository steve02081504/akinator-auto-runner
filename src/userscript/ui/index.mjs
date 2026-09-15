/**
 * 注入式控制面板（Shadow DOM 隔离，模板渲染）。
 * @module userscript/ui
 */

import { UI_STATE_KEY } from '../../shared/constants.mjs'
import { onLanguageChange } from '../../shared/i18n/index.mjs'
import { icon } from '../../shared/icons.mjs'
import { applyTheme } from '../../shared/theme.mjs'
import { asRecord } from '../../shared/util.mjs'
import { requestNotificationPermission } from '../bell.mjs'
import { storageGet, storageSet } from '../gm.mjs'
import { currentLocale, geti18n, LOCALE_CODES, localeLabel } from '../i18n.mjs'
import styleText from '../style.css'

import { charactersData, editorData, renderEditorChunk } from './characters_view.mjs'
import { dataData } from './data_view.mjs'
import { handleChange, handleClick, handleInput } from './events.mjs'
import { playerData, playerProgress } from './player_view.mjs'
import { runData, runPartsData } from './run_view.mjs'
import { templates } from './templates.mjs'

/**
 * 判断值是否是可切换的标签页。
 * @param {unknown} value 值
 * @returns {value is Aki.PanelTab} 是否合法
 */
function isPanelTab(value) {
	return value === 'run' || value === 'characters' || value === 'data' || value === 'player'
}

/**
 * 读取上次持久化的面板状态（标签页 / 展开 / 收起）。
 * @returns {Aki.PanelState | undefined} 状态；从未写过或格式不对时为 undefined
 */
function loadPanelState() {
	const saved = asRecord(storageGet(UI_STATE_KEY, null))
	if (!isPanelTab(saved.tab)) return undefined
	return {
		tab: saved.tab,
		expanded: saved.expanded === true,
		collapsed: saved.collapsed === true,
	}
}

/**
 * 控制面板。
 */
export class PanelUI {
	/**
	 * @param {import('../app/index.mjs').App} app 应用
	 */
	constructor(app) {
		/** @type {import('../app/index.mjs').App} */
		this.app = app
		/** @type {HTMLElement | undefined} */
		this.host = undefined
		/** @type {ShadowRoot | undefined} */
		this.shadow = undefined
		/** @type {Aki.PanelTab} */
		this.tab = 'run'
		/** @type {string} */
		this.query = ''
		/** @type {{ key: string; record: Aki.AnswerRecord }[]} 角色编辑器里的题目虚拟队列（按需分批渲染）。 */
		this.editorQueue = []
		/** @type {number} 编辑器题目已经渲染出的行数。 */
		this.editorRendered = 0
		/** @type {boolean} 是否有一次「追加下一批」正在进行。 */
		this.editorAppending = false
		/** @type {IntersectionObserver | undefined} 观察题目列表末尾以触发追加。 */
		this.editorObserver = undefined
		/** @type {string} */
		this.selectedCharacterId = ''
		/** @type {Aki.Question | undefined} */
		this.askQuestion = undefined
		/** @type {Aki.AnswerRecord | undefined} */
		this.askRecorded = undefined
		/** @type {'record' | 'unknown' | undefined} */
		this.askReason = undefined
		/** @type {Aki.RunState | undefined} */
		this.runState = undefined
		/** @type {boolean} 当前运行控件是否按「运行中」渲染过（用来判断运行开始 / 结束需不需要重建控件）。 */
		this.controlsRunning = false
		/** @type {Aki.Guess | undefined} */
		this.lastGuess = undefined
		/** @type {{ proposal: Aki.Proposal; suggested?: Aki.Guess } | undefined} */
		this.proposal = undefined
		/** @type {Aki.DelayState | undefined} 正在倒计时的自动决策。 */
		this.delay = undefined
		/** @type {Aki.InterventionState | undefined} 等待「纠正 / 追加」的改选。 */
		this.intervention = undefined
		/** @type {{ id?: string; draft: Partial<Aki.Character> } | undefined} */
		this.editing = undefined
		/** 录制模式下用户填写的角色名（留空则自动命名）。 */
		this.newName = ''
		/** @type {Aki.CreatedCharacter | undefined} */
		this.created = undefined
		/** @type {boolean} */
		this.collapsed = false
		/** 展开态：面板半透明铺满屏幕，四周只留一圈透明边。 */
		this.expanded = false
		// akinator 每局刷新会重建面板：还原上次停在哪个标签页、展开 / 收起状态。
		const saved = loadPanelState()
		if (saved) {
			this.tab = saved.tab
			this.collapsed = saved.collapsed
			this.expanded = saved.collapsed ? false : saved.expanded
		}
		/** @type {{ left: string; top: string; right: string; bottom: string } | undefined} */
		this.floatStyle = undefined
		/** @type {{ x: number; y: number } | undefined} */
		this.dragOffset = undefined
		this.onDragMove = this.onDragMove.bind(this)
		this.onDragEnd = this.onDragEnd.bind(this)
	}

	/**
	 * 挂载面板。
	 * @returns {Promise<void>} 完成
	 */
	async mount() {
		this.host = document.createElement('div')
		this.host.id = 'akinator-auto-runner'
		this.host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;'
		applyTheme(this.app.settings.theme, this.host)
		this.shadow = this.host.attachShadow({ mode: 'open' })
		const style = document.createElement('style')
		style.textContent = styleText
		this.shadow.appendChild(style)
		const root = document.createElement('div')
		root.className = 'aar-panel'
		this.shadow.appendChild(root)
		document.documentElement.appendChild(this.host)
		this.host.classList.toggle('aar-collapsed', this.collapsed)
		if (this.expanded) this.setExpanded(true)
		this.shadow.addEventListener('click', (event) => handleClick(this, event))
		this.shadow.addEventListener('change', (event) => handleChange(this, event))
		this.shadow.addEventListener('input', (event) => handleInput(this, event))
		this.shadow.addEventListener('mousedown', (event) => this.#onMouseDown(event))
		this.#wireApp()
		onLanguageChange(() => this.render())
		await this.render()
	}

	/**
	 * 订阅应用事件。
	 * @returns {void}
	 */
	#wireApp() {
		this.app.on('state', (state) => {
			this.runState = state
			// 播放器停在原地只更新进度条 / 唱片状态：整体重建会让唱片动画从头开始。
			if (this.tab === 'player') this.renderPlayerProgress()
			if (this.tab !== 'run' || this.#inEditor()) return
			// 运行开始 / 结束会改变顶部控件（按钮禁用、录制指示等），此时才整体重建运行页；
			// 其余每步状态只刷新随进度变化的区块，避免把控件和滚动位置一起冲掉。
			if (!!state?.running !== this.controlsRunning) {
				this.renderBody()
				return
			}
			this.renderRunParts()
		})
		this.app.on('log', () => this.renderLogs())
		this.app.on('logsCleared', () => this.renderLogs())
		this.app.on('session', () => {
			if (this.tab === 'run') this.renderRunParts()
		})
		this.app.on('ask', (payload) => {
			this.askQuestion = payload.question
			this.askRecorded = payload.recorded
			this.askReason = payload.reason
			requestNotificationPermission()
			// 未知题要人补充答案：切回运行页；常规录制出题仍不打扰当前标签页。
			this.#showRunBlock('.aar-ask', { focus: payload.reason === 'unknown' })
		})
		this.app.on('guess', (payload) => {
			this.lastGuess = payload.guess
			if (this.tab === 'run') this.renderRunParts()
		})
		this.app.on('proposal', (payload) => {
			this.proposal = payload
			this.#showRunBlock('.aar-proposal')
		})
		this.app.on('delay', (delay) => {
			this.delay = delay
			this.#showRunBlock('.aar-delay')
		})
		this.app.on('delayEnd', () => {
			this.delay = undefined
			if (this.tab === 'run') this.renderRunParts()
		})
		this.app.on('intervention', (intervention) => {
			this.intervention = intervention
			// 「纠正 / 追加」必须由人拍板：切回运行页。
			this.#showRunBlock('.aar-intervene', { focus: true })
		})
		this.app.on('interventionEnd', () => {
			this.intervention = undefined
			if (this.tab === 'run') this.renderRunParts()
		})
		this.app.on('created', (payload) => {
			this.created = payload?.discarded ? undefined : payload
			if (payload?.id) this.selectedCharacterId = payload.id
			this.#showRunBlock('.aar-created')
		})
		this.app.on('database', () => {
			this.renderStatus()
			if (this.#inEditor() || this.#isEditingField()) return
			if (this.tab === 'characters') this.renderBody()
		})
		this.app.on('playlist', () => {
			if (this.tab === 'player' || (this.tab === 'characters' && !this.#inEditor())) this.renderBody()
		})
		this.app.on('subscriptions', () => {
			if (this.tab === 'data') this.renderBody()
		})
		this.app.on('settings', () => {
			// 停留在编辑器时不要重挂主体：否则题目列表会退回第一批、滚动位置丢失。
			if (!this.#inEditor()) this.renderBody()
		})
	}

	/**
	 * 当前是否正停留在角色编辑器。
	 *
	 * 编辑态只属于「角色」标签页：用户切到别的标签页（比如去答题页补充问题）时先让位给
	 * 目标标签页，切回角色页仍保留草稿继续编辑。**不要**让编辑态盖到所有标签页上。
	 * @returns {boolean} 是否正显示编辑器
	 */
	#inEditor() {
		return !!this.editing && this.tab === 'characters'
	}

	/**
	 * 显示运行页里的某个区块（出题 / 候选 / 结果卡等）并滚入视野。
	 *
	 * 默认只在用户已停在运行页时刷新区块并滚动，避免整页重建冲掉滚动位置；用户在别的
	 * 标签页时保持原样，**不强行切回答题页**。只有需要人补充答案（未知题）或做
	 * 「纠正 / 追加」时才传 `focus`，此时把运行页切到眼前（编辑中仍不打断）。
	 * @param {string} selector 选择器
	 * @param {{ focus?: boolean }} [options] 选项
	 * @returns {Promise<void>} 完成
	 */
	async #showRunBlock(selector, options = {}) {
		if (this.#inEditor()) return
		if (this.tab !== 'run') {
			if (!options.focus) return
			await this.setTab('run')
		} else
			await this.renderRunParts()
		this.#scrollPanelTo(selector)
	}

	/**
	 * 把面板主体的某个区块滚入视野（出题 / 候选 / 结果卡出现时用）。
	 * @param {string} selector 选择器
	 * @returns {void} 无
	 */
	#scrollPanelTo(selector) {
		const element = this.shadow?.querySelector(selector)
		element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
	}

	/**
	 * 面板内是否有输入框正处于编辑状态（用于避免实时刷新打断输入）。
	 * @returns {boolean} 是否正在输入
	 */
	#isEditingField() {
		const active = this.shadow?.activeElement
		return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
	}

	/**
	 * 切换收起态（面板标题栏按钮与 GM 菜单共用）。
	 * @returns {void} 无
	 */
	toggleCollapsed() {
		this.collapsed = !this.collapsed
		if (this.collapsed) this.setExpanded(false)
		this.host?.classList.toggle('aar-collapsed', this.collapsed)
		this.#persistState()
		this.render()
	}

	/**
	 * 切换展开态：展开时铺满屏幕（四周留 8px 透明边），收起时还原原来的浮动位置。
	 * @param {boolean} expanded 是否展开
	 * @returns {void} 无
	 */
	setExpanded(expanded) {
		if (!this.host) return
		this.expanded = expanded
		this.host.classList.toggle('aar-expanded', expanded)
		const {style} = this.host
		if (expanded) {
			this.floatStyle ??= { left: style.left, top: style.top, right: style.right, bottom: style.bottom }
			style.left = '8px'
			style.top = '8px'
			style.right = '8px'
			style.bottom = '8px'
		} else if (this.floatStyle) {
			style.left = this.floatStyle.left
			style.top = this.floatStyle.top
			style.right = this.floatStyle.right || '16px'
			style.bottom = this.floatStyle.bottom || '16px'
			this.floatStyle = undefined
		}
		this.#persistState()
	}

	/**
	 * 切换标签页并持久化界面状态（akinator 每局刷新后据此还原）。
	 * @param {Aki.PanelTab} tab 目标标签页
	 * @returns {Promise<void>} 完成
	 */
	async setTab(tab) {
		this.tab = tab
		this.query = ''
		this.#persistState()
		await this.render()
	}

	/**
	 * 持久化面板界面状态（标签页 / 展开 / 收起）。
	 * @returns {void} 无
	 */
	#persistState() {
		storageSet(UI_STATE_KEY, { tab: this.tab, expanded: this.expanded, collapsed: this.collapsed })
	}

	/**
	 * 整体渲染。
	 * @returns {Promise<void>} 完成
	 */
	async render() {
		if (!this.shadow) return
		const root = this.shadow.querySelector('.aar-panel')
		if (!root) return
		await templates.mountTemplate(root, 'panel', {
			localeOptions: await this.#localeOptions(),
			themeIcon: this.#themeIcon(),
			logoIcon: icon('sparkles', { size: 17 }),
			expandIcon: icon(this.expanded ? 'minimize' : 'maximize', { size: 15 }),
			expandTitle: this.expanded ? 'settings.restore' : 'settings.expand',
			collapseIcon: icon('chevron-down', { size: 15 }),
			dumpIcon: icon('clipboard', { size: 13 }),
			downloadIcon: icon('download', { size: 13 }),
			clearIcon: icon('trash', { size: 13 }),
		})
		await Promise.all([this.renderTabs(), this.renderBody(), this.renderStatus(), this.renderLogs()])
	}

	/**
	 * 语言下拉选项 HTML。
	 * @returns {Promise<string>} HTML
	 */
	async #localeOptions() {
		return templates.renderListAsHtmlString('option', LOCALE_CODES.map((code) => ({ value: code, label: localeLabel(code), selected: code === currentLocale() })))
	}

	/**
	 * 主题按钮图标。
	 * @returns {string} 图标
	 */
	#themeIcon() {
		const {theme} = this.app.settings
		return icon(theme === 'auto' ? 'auto' : theme === 'dark' ? 'moon' : 'sun', { size: 15 })
	}

	/**
	 * 渲染标签栏。
	 * @returns {Promise<void>} 完成
	 */
	async renderTabs() {
		const nav = this.shadow?.querySelector('[data-role="tabs"]')
		if (!nav) return
		/** @type {Record<string, [string, string]>} */
		const keys = {
			run: ['nav.run', 'play'],
			characters: ['nav.characters', 'users'],
			data: ['nav.data', 'database'],
			player: ['nav.player', 'disc'],
		}
		for (const [tab, [key, iconName]] of Object.entries(keys))
			await templates.appendTemplate(nav, 'tab', { tab, key, icon: icon(iconName, { size: 14 }), active: this.tab === tab })
	}

	/**
	 * 渲染状态栏。
	 * @returns {Promise<void>} 完成
	 */
	async renderStatus() {
		const status = this.shadow?.querySelector('[data-role="status"]')
		if (!status) return
		status.textContent = `${this.app.sourceName} · ${geti18n('characters.count', { count: Object.keys(this.app.store.db.characters).length })}`
	}

	/**
	 * 渲染主体。
	 * @returns {Promise<void>} 完成
	 */
	async renderBody() {
		const body = this.shadow?.querySelector('[data-role="body"]')
		if (!body) return
		this.editorObserver?.disconnect()
		this.editorObserver = undefined
		await templates.mountTemplate(body, this.#inEditor() ? 'editor' : this.tab, await this.#bodyData())
		if (this.#inEditor()) this.#watchEditorQuestions()
		else if (this.tab === 'run') this.controlsRunning = !!this.runState?.running
	}

	/**
	 * 只刷新运行页里随进度变化的区块，保留顶部控件与滚动位置。
	 * @returns {Promise<void>} 完成
	 */
	async renderRunParts() {
		const parts = this.shadow?.querySelector('[data-role="run-parts"]')
		if (!parts) {
			await this.renderBody()
			return
		}
		await templates.mountTemplate(parts, 'run-parts', await runPartsData(this))
	}

	/**
	 * 当前面板主体的模板数据。
	 * @returns {Promise<object>} 数据
	 */
	async #bodyData() {
		if (this.#inEditor()) return editorData(this)
		if (this.tab === 'run') return runData(this)
		if (this.tab === 'characters') return charactersData(this)
		if (this.tab === 'player') return playerData(this)
		return dataData(this)
	}

	/**
	 * 就地刷新播放器的进度条与唱片状态（不重建 DOM，避免唱片动画重头开始）。
	 * @returns {void} 无
	 */
	renderPlayerProgress() {
		const root = this.shadow?.querySelector('[data-role="player"]')
		if (!root) return
		const progress = playerProgress(this)
		const bar = root.querySelector('[data-role="player-bar"]')
		if (bar instanceof HTMLElement) bar.style.width = `${progress}%`
		const percent = root.querySelector('[data-role="player-percent"]')
		if (percent) percent.textContent = geti18n('playlist.percent', { percent: progress })
		root.querySelector('[data-role="player-disc"]')?.classList.toggle('playing', !!this.app.playlist.active)
	}

	/**
	 * 渲染日志区。
	 * @returns {Promise<void>} 完成
	 */
	async renderLogs() {
		const logs = this.shadow?.querySelector('[data-role="logs"]')
		if (!logs) return
		logs.innerHTML = await templates.renderListAsHtmlString('log', this.app.logs.slice(-60))
		logs.scrollTop = logs.scrollHeight
		const count = this.shadow?.querySelector('[data-role="logs-count"]')
		if (count) count.textContent = geti18n('logs.count', { count: this.app.logs.length })
	}

	/**
	 * 观察编辑器题目列表末尾的「加载更多」哨兵，滚到附近时追加下一批。
	 * @returns {void} 无
	 */
	#watchEditorQuestions() {
		const sentinel = this.shadow?.querySelector('[data-role="editor-question-more"]')
		const root = this.shadow?.querySelector('.aar-body')
		if (!sentinel || !root) return
		this.editorObserver = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) this.#appendEditorChunk()
		}, { root, rootMargin: '200px' })
		this.editorObserver.observe(sentinel)
	}

	/**
	 * 追加下一批编辑器题目行；全部渲染完后移除哨兵并停止观察。
	 * @returns {Promise<void>} 完成
	 */
	async #appendEditorChunk() {
		if (this.editorAppending) return
		this.editorAppending = true
		try {
			const { rows, done } = await renderEditorChunk(this)
			const list = this.shadow?.querySelector('[data-role="editor-question-rows"]')
			const sentinel = this.shadow?.querySelector('[data-role="editor-question-more"]')
			if (!list) return
			if (rows) list.insertAdjacentHTML('beforeend', rows)
			if (done) {
				this.editorObserver?.disconnect()
				this.editorObserver = undefined
				sentinel?.remove()
			} else if (sentinel && this.editorObserver) {
				this.editorObserver.unobserve(sentinel)
				this.editorObserver.observe(sentinel)
			}
		} finally {
			this.editorAppending = false
		}
	}

	/**
	 * 开始拖动。
	 * @param {MouseEvent} event 事件
	 * @returns {void}
	 */
	#onMouseDown(event) {
		if (this.expanded) return
		if (!(event instanceof MouseEvent)) return
		if (!(event.target instanceof Element)) return
		const { target } = event
		if (target.closest('button') || !target.closest('[data-role="drag"]')) return
		const rect = this.host?.getBoundingClientRect()
		if (!rect) return
		this.dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top }
		window.addEventListener('mousemove', this.onDragMove)
		window.addEventListener('mouseup', this.onDragEnd)
	}

	/**
	 * 拖动中。
	 * @param {MouseEvent} event 事件
	 * @returns {void}
	 */
	onDragMove(event) {
		if (!this.host || !this.dragOffset) return
		const x = Math.max(0, Math.min(window.innerWidth - 100, event.clientX - this.dragOffset.x))
		const y = Math.max(0, Math.min(window.innerHeight - 40, event.clientY - this.dragOffset.y))
		this.host.style.left = `${x}px`
		this.host.style.top = `${y}px`
		this.host.style.right = 'auto'
		this.host.style.bottom = 'auto'
	}

	/**
	 * 结束拖动。
	 * @returns {void}
	 */
	onDragEnd() {
		this.dragOffset = undefined
		window.removeEventListener('mousemove', this.onDragMove)
		window.removeEventListener('mouseup', this.onDragEnd)
	}
}

