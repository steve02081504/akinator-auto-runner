/**
 * 与 akinator 窗口内油猴脚本的 postMessage 桥（站点侧）。
 *
 * akinator 会回 `X-Frame-Options: SAMEORIGIN`，被 iframe 嵌进去只会得到一个空框，
 * 因此这里改用 `window.open` 打开独立窗口，再靠 opener ↔ popup 的 postMessage 驱动它。
 * @module site/scripts/bridge
 */

import { ensureDevotion } from '../shared/devotion.mjs'
import { MessageType, isMessage, post } from '../shared/protocol.mjs'
import { asRecord } from '../shared/util.mjs'

import { geti18n } from './i18n/index.mjs'
import { elementById } from './lib/dom.mjs'
import { renderAsk, renderCharacters, renderCreated, renderDelay, renderLogs, renderProposal, renderRunCharacters, renderRunMode, renderRunStatus, renderStats, renderSubscriptions } from './render.mjs'
import { state } from './state.mjs'

/** 窗口名：复用同一个窗口，别每次连接都开新的。 */
const WINDOW_NAME = 'akinator-auto-runner'

/** 弹窗尺寸。 */
const WINDOW_FEATURES = 'popup=yes,width=1100,height=860'

/**
 * akinator 区域基址。
 * @returns {string} 基址（不含尾斜杠）
 */
function akinatorOrigin() {
	return `https://${state.region}.akinator.com`
}

/**
 * 打开（或聚焦）akinator 窗口。必须在用户手势里调用，否则会被弹窗拦截。
 * @returns {Window | undefined} 窗口引用；被拦截时为 undefined
 */
export function openWindow() {
	if (state.popup && !state.popup.closed) {
		if (state.popupRegion !== state.region)
			try {
				state.popup.location.href = `${akinatorOrigin()}/`
			} catch {
				/* 跨域导航被拦时忽略，下一个区域重新连接即可 */
			}
		state.popupRegion = state.region
		state.popup.focus()
		return state.popup
	}
	const opened = window.open(akinatorOrigin(), WINDOW_NAME, WINDOW_FEATURES)
	if (opened) {
		state.popup = opened
		state.popupRegion = state.region
	}
	return opened ?? undefined
}

/**
 * 向 akinator 窗口内的脚本发送消息。
 * @param {string} type 消息类型
 * @param {unknown} [payload] 载荷
 * @returns {void}
 */
export function send(type, payload) {
	post(state.popup, type, payload, undefined, akinatorOrigin())
}

/**
 * 更新连接状态显示。
 * @returns {void}
 */
export function updateConnection() {
	const pill = elementById('connection')
	if (pill) {
		pill.dataset.i18n = state.connected ? 'app.connected' : 'app.disconnected'
		pill.textContent = geti18n(pill.dataset.i18n)
		pill.className = state.connected ? 'pill is-connected' : 'pill'
	}
	const hint = elementById('install-hint')
	if (hint) hint.classList.toggle('hidden', state.connected)
}

/**
 * 停止探测。
 * @returns {void}
 */
function stopPinging() {
	if (state.pingTimer === undefined) return
	clearInterval(state.pingTimer)
	state.pingTimer = undefined
}

/**
 * 开始探测脚本存在性：窗口开着且未连上时持续 ping，连上或窗口关掉就停。
 * @returns {void}
 */
export function startPinging() {
	stopPinging()
	state.pingTimer = setInterval(() => {
		if (state.connected || !state.popup || state.popup.closed) {
			stopPinging()
			return
		}
		send(MessageType.ping, {})
	}, 1000)
}

/**
 * 检查 akinator 窗口是否被用户关掉，关掉就回到未连接状态。
 * @returns {void}
 */
export function checkPopup() {
	if (!state.popup || !state.popup.closed) return
	state.popup = undefined
	state.popupRegion = ''
	stopPinging()
	if (state.connected) {
		state.connected = false
		updateConnection()
	}
}

/**
 * 开始监视 akinator 窗口的开合。
 * @returns {void}
 */
export function startPopupWatch() {
	if (state.popupWatchTimer !== undefined) return
	state.popupWatchTimer = setInterval(checkPopup, 1000)
}

/**
 * 处理脚本上报的消息。
 * @param {MessageEvent} event 消息事件
 * @returns {void}
 */
export function onMessage(event) {
	if (event.source !== state.popup) return
	if (event.origin !== akinatorOrigin()) return
	if (!isMessage(event.data)) return
	const message = event.data
	switch (message.type) {
		case MessageType.pong: {
			state.connected = true
			updateConnection()
			/** @type {Aki.HelloInfo} */
			const hello = message.payload
			state.hello = hello
			// 脚本把自己持久化的日志带过来，重连后站点这边也能看到完整历史。
			if (Array.isArray(hello?.logs) && hello.logs.length) {
				state.logs = hello.logs
				renderLogs()
			}
			send(MessageType.init, {
				databaseText: state.pageStore.toJSON(),
				subscriptions: state.subscriptions,
			})
			break
		}
		case MessageType.database: {
			/** @type {{ database?: Aki.Database; devotion?: Aki.Devotion }} */
			const { payload } = message
			if (payload?.database) {
				state.remoteStore.replace(payload.database)
				if (payload.devotion) state.remoteDevotion = ensureDevotion(payload.devotion)
				renderCharacters()
				renderRunCharacters()
				renderStats()
			}
			break
		}
		case MessageType.characterCreated: {
			/** @type {Aki.CreatedCharacter} */
			const created = message.payload
			state.created = created?.discarded ? undefined : created
			if (created && !created.discarded) {
				state.runMode = 'replay'
				state.runCharacterPicked = true
				renderRunCharacters().then(() => {
					const select = elementById('run-character')
					if (select instanceof HTMLSelectElement) select.value = created.id
					renderRunMode()
				})
			}
			renderCreated()
			renderStats()
			break
		}
		case MessageType.state: {
			// 脚本在 pong 时也会捎带 `{ subscriptions, settings }`，别把它当成运行状态。
			const payload = asRecord(message.payload)
			if (Array.isArray(payload.subscriptions) || payload.settings) {
				if (Array.isArray(payload.subscriptions)) state.subscriptions = /** @type {Aki.Subscription[]} */ payload.subscriptions
				if (payload.settings) state.settings = /** @type {Partial<Aki.Settings>} */ payload.settings
				renderSubscriptions()
				break
			}
			state.runState = /** @type {Aki.RunState} */ message.payload
			renderRunStatus()
			renderAsk()
			break
		}
		case MessageType.ask: {
			/** @type {{ question?: Aki.Question }} */
			const { payload } = message
			state.askQuestion = payload?.question
			renderAsk()
			break
		}
		case MessageType.proposal: {
			/** @type {{ proposal: Aki.Proposal; suggested?: Aki.Guess }} */
			const { payload } = message
			state.proposal = payload.proposal
			state.suggested = payload.suggested
			renderProposal()
			break
		}
		case MessageType.delay: {
			state.delay = message.payload ? /** @type {Aki.DelayState} */ message.payload : undefined
			renderDelay()
			renderAsk()
			break
		}
		case MessageType.intervention: {
			state.intervention = message.payload ? /** @type {Aki.InterventionState} */ message.payload : undefined
			renderDelay()
			break
		}
		case MessageType.log:
			state.logs = [...state.logs, /** @type {Aki.LogEntry} */ message.payload]
			renderLogs()
			break
		case MessageType.defeat:
			state.logs = [...state.logs, { time: Date.now(), level: 'warn', message: geti18n('run.defeat') }]
			renderLogs()
			break
		case MessageType.error: {
			/** @type {{ message?: string }} */
			const { payload } = message
			state.logs = [...state.logs, { time: Date.now(), level: 'error', message: String(payload?.message ?? '') }]
			renderLogs()
			break
		}
		default:
			break
	}
}
