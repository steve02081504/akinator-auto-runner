/* global GM_info */

/**
 * 站点桥：当脚本运行在站点打开的 akinator 窗口里时，通过 postMessage 与站点通信。
 *
 * akinator 返回 `X-Frame-Options: SAMEORIGIN`，iframe 根本渲染不出来，所以线上
 * 走的是「站点 `window.open` 弹窗」这条路：站点窗口是 `window.opener`（本地测试
 * 里也可能是 iframe 的 `window.parent`）。只有来源可信（项目站或本机回环）时才
 * 建立桥，别把题库交给随便哪个开 akinator 的页面。
 * @module userscript/bridge
 */

import { SITE_ORIGIN } from '../shared/constants.mjs'
import { MessageType, isMessage, post } from '../shared/protocol.mjs'
import { debounce, now } from '../shared/util.mjs'

/** 本机回环主机名（本地开发 / 测试用）。 */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]']

/** 在弹窗自身跳转（如「开始」跳游戏页）后仍记得站点来源的会话存储键。 */
const PEER_ORIGIN_KEY = 'akinator-auto-runner:peer-origin'

/**
 * 记住站点来源，供同窗口内后续跳转（referrer 变成 akinator 自己）后回退使用。
 * @param {string} origin 来源
 * @returns {void} 无
 */
function rememberPeerOrigin(origin) {
	try {
		sessionStorage.setItem(PEER_ORIGIN_KEY, origin)
	} catch {
		/* 存储失败时忽略 */
	}
}

/**
 * 取回本窗口记住的站点来源。
 * @returns {string} 来源；未记住 / 不可信时为空串
 */
function recallPeerOrigin() {
	try {
		const origin = sessionStorage.getItem(PEER_ORIGIN_KEY)
		return origin && isTrustedSiteOrigin(origin) ? origin : ''
	} catch {
		return ''
	}
}

/**
 * 判断一个来源是否允许驱动脚本。
 * @param {string} origin 来源（如 `https://steve02081504.github.io`）
 * @returns {boolean} 是否可信
 */
function isTrustedSiteOrigin(origin) {
	if (!origin || origin === 'null') return false
	if (origin === SITE_ORIGIN) return true
	try {
		const { hostname, protocol } = new URL(origin)
		return (protocol === 'http:' || protocol === 'https:') && LOOPBACK_HOSTS.includes(hostname)
	} catch {
		return false
	}
}

/**
 * 站点窗口：被 iframe 嵌入时是父页，被站点弹窗打开时是 opener。
 * @returns {Window | undefined} 站点窗口
 */
function siteWindow() {
	if (typeof window === 'undefined') return undefined
	if (window.self !== window.top) return window.parent ?? undefined
	return window.opener ?? undefined
}

/**
 * 站点来源（由 referrer 推断，仅当可信时返回）。
 * @returns {string} 来源；未知 / 不可信时为空串
 */
function siteOrigin() {
	const referrer = typeof document !== 'undefined' ? document.referrer : ''
	if (!referrer) return recallPeerOrigin()
	let origin = ''
	try {
		origin = new URL(referrer).origin
	} catch {
		return recallPeerOrigin()
	}
	if (!isTrustedSiteOrigin(origin)) return recallPeerOrigin()
	rememberPeerOrigin(origin)
	return origin
}

/** 当前是否运行在站点打开的窗口里（iframe 或弹窗）。 */
export const isBridged = siteWindow() !== undefined && siteOrigin() !== ''

/**
 * 与站点窗口交换消息的桥接器。
 */
export class Bridge {
	/**
	 * @param {import('./app/index.mjs').App} app 应用实例
	 */
	constructor(app) {
		/** @type {import('./app/index.mjs').App} */
		this.app = app
		/** @type {Window | undefined} 站点窗口，可能在收到首条消息时补上 */
		this.peer = siteWindow()
		/** @type {string} 站点来源 */
		this.origin = siteOrigin()
		this.sendDatabase = debounce(() => this.#sendDatabase(), 1200)
	}

	/**
	 * 安装监听并广播就绪。
	 * @returns {void}
	 */
	start() {
		window.addEventListener('message', (event) => this.#onMessage(event))
		this.#wireApp()
		this.#post(MessageType.pong, this.#hello())
	}

	/**
	 * 返回脚本信息。
	 * @returns {{ version: string; embedded: boolean; characters: number }} 信息
	 */
	#hello() {
		return {
			version: typeof GM_info !== 'undefined' ? GM_info.script.version : '0.0.0',
			embedded: true,
			characters: Object.keys(this.app.store.db.characters).length,
			logs: this.app.logs.slice(-200),
			session: this.app.lastSession ?? null,
		}
	}

	/**
	 * 把应用事件转发给站点。
	 * @returns {void}
	 */
	#wireApp() {
		this.app.on('state', (state) => this.#post(MessageType.state, state))
		this.app.on('log', (entry) => this.#post(MessageType.log, entry))
		this.app.on('ask', (payload) => this.#post(MessageType.ask, payload))
		this.app.on('proposal', (payload) => this.#post(MessageType.proposal, payload))
		this.app.on('delay', (state) => this.#post(MessageType.delay, state))
		this.app.on('delayEnd', () => this.#post(MessageType.delay, null))
		this.app.on('intervention', (state) => this.#post(MessageType.intervention, state))
		this.app.on('interventionEnd', () => this.#post(MessageType.intervention, null))
		this.app.on('defeat', () => this.#post(MessageType.defeat, {}))
		this.app.on('done', (summary) => this.#post(MessageType.result, summary))
		this.app.on('roundEnd', (result) => this.#post(MessageType.result, result))
		this.app.on('created', (created) => this.#post(MessageType.characterCreated, created))
		this.app.on('subscriptions', (list) => this.#post(MessageType.state, { subscriptions: list }))
		this.app.on('database', () => this.sendDatabase())
	}

	/**
	 * 向站点窗口发送一条消息。
	 * @param {string} type 消息类型
	 * @param {unknown} [payload] 载荷
	 * @param {string} [id] 关联 id
	 * @returns {void}
	 */
	#post(type, payload, id) {
		post(this.peer, type, payload, id, this.origin || '*')
	}

	/**
	 * 发送完整数据库。
	 * @returns {void}
	 */
	#sendDatabase() {
		this.#post(MessageType.database, {
			database: this.app.store.db,
			sourceName: this.app.sourceName,
			devotion: this.app.getDevotionAll(),
		})
	}

	/**
	 * 处理来自站点的消息。
	 * @param {MessageEvent} event 消息事件
	 * @returns {void}
	 */
	#onMessage(event) {
		// 只认站点来源；弹窗的 opener 有可能被浏览器剥离，这时用首条可信消息定位站点窗口。
		if (!isTrustedSiteOrigin(event.origin)) return
		if (this.peer && event.source !== this.peer) return
		if (!isMessage(event.data)) return
		this.peer = event.source ?? undefined
		this.origin = event.origin
		const message = event.data
		switch (message.type) {
			case MessageType.ping:
				this.#post(MessageType.pong, this.#hello())
				this.#sendDatabase()
				this.#post(MessageType.state, { subscriptions: this.app.subscriptions, settings: this.app.settings })
				break
			case MessageType.init:
				this.#handleInit(message.payload)
				break
			case MessageType.command:
				this.#handleCommand(message.payload, message.id)
				break
			default:
				break
		}
	}

	/**
	 * 处理站点下发的初始化数据。
	 * @param {Aki.BridgeInit} payload 载荷
	 * @returns {void}
	 */
	#handleInit(payload) {
		if (payload?.settings) this.app.updateSettings(payload.settings)
		// 运行中不要被站点的题库整体替换：页面驱动下每局结束都会刷新页面重开，
		// 续跑在刷新后立即开始，此时若整库被覆盖会把刚录到的角色 / 答案冲掉。
		if (payload?.databaseText && !this.app.runner?.engine)
			try {
				this.app.loadText(payload.databaseText, '来自站点')
			} catch (error) {
				this.#post(MessageType.error, { message: String(error) })
			}
		if (Array.isArray(payload?.subscriptions)) this.app.subscriptions = payload.subscriptions
	}

	/**
	 * 处理站点下发的指令。
	 * @param {Aki.BridgeCommand} payload 指令
	 * @param {string} [id] 关联 id
	 * @returns {void}
	 */
	#handleCommand(payload, id) {
		const action = payload?.action
		switch (action) {
			case 'start':
				this.app.startRun(payload.options).catch((error) => {
					this.#post(MessageType.error, { message: String(error), action })
				})
				break
			case 'stop':
				this.app.stopRun()
				break
			case 'answer':
			case 'interrupt':
				this.app.provideAnswer(payload.answer)
				break
			case 'intervene':
				this.app.resolveIntervention(payload.treatment === 'correct' ? 'correct' : 'append')
				break
			case 'proposal':
				this.app.provideProposal(payload.decision ?? null)
				break
			case 'updateSettings':
				this.app.updateSettings(payload.settings ?? {})
				break
			case 'requestDatabase':
				this.#sendDatabase()
				break
			case 'save':
				this.app.saveNow()
				break
			default:
				this.#post(MessageType.error, { message: `未知指令：${action}`, id, time: now() })
		}
	}
}

