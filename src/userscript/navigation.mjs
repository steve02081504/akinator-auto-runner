/**
 * akinator 页面跳转：把「开始运行」从首页 / 主题选择页带到真正的游戏页。
 *
 * 引擎以同源 HTTP 会话为真相来源，在任意 akinator 页面上都能跑，但只有游戏页
 * （含 `#questionGameBlock`）能让 {@link module:userscript/page} 把问答画到页面上。
 * 因此在非游戏页点开始时，先把运行参数暂存起来，用 akinator 自己的方式
 * POST `/game` 跳到游戏页，加载后再由 `index.mjs` 自动续跑。
 * @module userscript/navigation
 */

import { PENDING_RUN_KEY } from '../shared/constants.mjs'
import { asRecord, now } from '../shared/util.mjs'

import { storageDelete, storageGet, storageSet } from './gm.mjs'
import { ANSWER_BUTTON_IDS } from './page_client.mjs'

/** 待运行参数的最长存活时间（毫秒），超时即丢弃，避免陈旧数据被误续跑。 */
const PENDING_RUN_TTL_MS = 60000

/** 刚由待运行参数续跑过一次：这一次别再跳转，免得游戏页加载异常时来回跳。 */
let resumedFromPending = false

/**
 * 当前页面是否为 akinator 游戏页（{@link module:userscript/page} 可接管）。
 * @returns {boolean} 是否游戏页
 */
export function isGamePage() {
	return !!document.getElementById('questionGameBlock')
}

/**
 * 游戏页上是否有一道进行中的题（能读题、且有可见的作答按钮）。
 *
 * akinator 每局结束（猜中 / 认输）后页面处于终态，引擎不能再接着答；此时必须先
 * 重新 `POST /game` 开一局新游戏（刷新页面后再由「待运行」机制续跑）。
 * @returns {boolean} 是否可继续作答
 */
export function hasActiveQuestion() {
	const block = document.getElementById('questionGameBlock')
	if (!block || getComputedStyle(block).display === 'none') return false
	const label = document.getElementById('question-label')
	if (!label?.textContent?.trim()) return false
	return ANSWER_BUTTON_IDS.some((id) => {
		const button = document.getElementById(id)
		return !!button && getComputedStyle(button).display !== 'none'
	})
}

/**
 * 开始运行前是否需要先跳到游戏页（含「已在游戏页但上一局已结束」的情况）。
 * @returns {boolean} 需要跳转
 */
export function shouldEnterGamePage() {
	const resumed = resumedFromPending
	resumedFromPending = false
	if (!isGamePage()) return true
	return !resumed && !hasActiveQuestion()
}

/**
 * 暂存待运行参数并跳到 akinator 游戏页。
 * @param {Aki.StartRunRequest} overrides 运行参数
 * @param {{ sid: number; childMode: boolean }} options 题库类型与儿童模式
 * @returns {void} 无
 */
export function enterGamePage(overrides, options) {
	storageSet(PENDING_RUN_KEY, { overrides, at: now() })
	submitGameForm(options)
}

/**
 * 取出并在存储中清除待运行参数（页面加载后调用一次）。
 * @returns {Aki.StartRunRequest | undefined} 运行参数；无或已超时则为 undefined
 */
export function takePendingRun() {
	const pending = asRecord(storageGet(PENDING_RUN_KEY, undefined))
	storageDelete(PENDING_RUN_KEY)
	const at = Number(pending.at)
	if (!Number.isFinite(at) || now() - at > PENDING_RUN_TTL_MS) return undefined
	/** @type {Aki.StartRunRequest | undefined} */
	const overrides = pending.overrides
	if (!overrides || typeof overrides !== 'object') return undefined
	resumedFromPending = true
	return overrides
}

/**
 * 复刻 akinator 主题选择页的 `chooseTheme`：用 POST `/game` 跳到游戏页。
 * @param {{ sid: number; childMode: boolean }} options 选项
 * @returns {void} 无
 */
function submitGameForm({ sid, childMode }) {
	try {
		localStorage.setItem('current_theme', String(sid))
		localStorage.removeItem('game_ended')
	} catch {
		/* 存储失败时忽略 */
	}
	const form = document.createElement('form')
	form.method = 'POST'
	form.action = '/game'
	form.style.display = 'none'
	const fields = { sid: String(sid), cm: childMode ? 'true' : 'false', anim: 'true' }
	for (const [name, value] of Object.entries(fields)) {
		const input = document.createElement('input')
		input.type = 'hidden'
		input.name = name
		input.value = value
		form.appendChild(input)
	}
	;(document.body ?? document.documentElement).appendChild(form)
	form.submit()
}
