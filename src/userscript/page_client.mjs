/* global unsafeWindow */

/**
 * 页面驱动的 akinator 客户端。
 *
 * 与 {@link module:shared/akinator} 的 HTTP 客户端相反：这里**不自己开会话**，而是点击
 * akinator 游戏页上的作答 / 候选按钮，让页面自身的 JS 发请求、驱动精灵与进度，再从 DOM
 * 与页面自身收到的响应读回下一步。脚本与 akinator 页面因此共用同一个会话：脚本自动作答时
 * 页面自己会动，用户手动点击、脚本出错后手动继续，都不会再因为「两个会话各走一步」而报错。
 *
 * **认输的判定来自页面自身请求的响应**：akinator 的 `/answer` 响应里没有 `question`、也没有
 * `id_proposition` 才是真正的认输。只看 DOM 会误判——切题时页面会先收起旧题（题面空、按钮
 * 隐藏），加载慢时这段空态会被错当成认输。因此这里给页面的 XHR / fetch 装一个**只读观察器**
 * （不自己发请求、不改写页面逻辑），拿到响应后再等页面把新题 / 候选渲染出来才继续。
 * @module userscript/page_client
 */

import { AkinatorError } from '../shared/akinator.mjs'
import { ANSWER_LABELS } from '../shared/constants.mjs'
import { asArray, asRecord, normalizeQuestion, stripHtml } from '../shared/util.mjs'

import { geti18n } from './i18n.mjs'

/** 页面答案按钮的 id，顺序即协议索引顺序（`a_probaly_not` 是 akinator 自己的拼写，别改）。 */
export const ANSWER_BUTTON_IDS = ['a_yes', 'a_no', 'a_dont_know', 'a_probably', 'a_probaly_not']

/** 等待页面响应（DOM 变化）的最长毫秒数。 */
const STEP_TIMEOUT_MS = 30000

/** 轮询页面状态的间隔毫秒数。 */
const POLL_INTERVAL_MS = 100

/**
 * 观察到 DOM 变化后再等这么久才退回「只看 DOM」。
 *
 * 页面自身的响应由观察器异步记录，可能比 DOM 渲染晚一拍；留一点缓冲，免得用上一次的
 * 旧响应（曾出现「已排除 other，却把后续 pika 也当成 other」）。
 */
const DOM_FALLBACK_GRACE_MS = 800

/**
 * 页面等待超时毫秒数。
 *
 * 允许用全局 `__akinatorAutoRunnerStepTimeoutMs` 覆盖，测试据此把等待缩短以尽快触发
 * 兜底路径；正常运行时读不到该全局，用默认值。
 * @returns {number} 毫秒
 */
function stepTimeoutMs() {
	const override = Number(globalThis.__akinatorAutoRunnerStepTimeoutMs)
	return Number.isFinite(override) && override > 0 ? override : STEP_TIMEOUT_MS
}

/**
 * 页面驱动特有的错误（页面没题 / 点了按钮页面不响应）。`RunController` 据此决定是否
 * 回退到内置 HTTP 会话（见设置 `clientProvider: auto`）。
 */
export class PageAkinatorError extends AkinatorError {
	/**
	 * @param {string} message 错误信息
	 */
	constructor(message) {
		super(message)
		this.name = 'PageAkinatorError'
	}
}

/** 页面自身最近一次作答请求的响应（由观察器写入）。 */
let stepResponse = { seq: 0, url: '', data: undefined }

/**
 * 最近一次页面自身作答请求的响应（供调试 dump / 排查用）。
 * @returns {{ seq: number; url: string; data: Record<string, unknown> | undefined }} 响应快照
 */
export function lastStepResponse() {
	return { seq: stepResponse.seq, url: stepResponse.url, data: stepResponse.data }
}

/** 观察器是否已安装（幂等）。 */
let observerInstalled = false

/**
 * 取页面窗口；油猴沙箱里真身是 `unsafeWindow`。
 * @returns {Window & typeof globalThis} 页面窗口
 */
function pageWindow() {
	try {
		if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow
	} catch {
		/* 取不到就用当前 window */
	}
	return window
}

/**
 * 是否是值得观察的作答接口。
 * @param {unknown} url 请求地址
 * @returns {boolean} 是否观察
 */
function isStepUrl(url) {
	return typeof url === 'string' && /\/(?:answer|exclude|cancel_answer|choice)\b/.test(url)
}

/**
 * 是否是 akinator 汇报本局选择的接口（页面自身在候选「是」后调用）。
 * @param {unknown} url 请求地址
 * @returns {boolean} 是否选择汇报
 */
function isChoiceUrl(url) {
	return typeof url === 'string' && /\/choice\b/.test(url)
}

/**
 * 记录一次页面自身的作答响应。
 * @param {unknown} url 请求地址
 * @param {string} text 响应文本
 * @returns {void} 无
 */
function recordStepResponse(url, text) {
	if (!isStepUrl(url)) return
	/** @type {Record<string, unknown> | undefined} */
	let data
	try {
		data = asRecord(JSON.parse(text))
	} catch {
		data = undefined
	}
	stepResponse = { seq: stepResponse.seq + 1, url: String(url), data }
}

/**
 * 给页面自身的 XHR / fetch 装只读观察器（幂等；不自己发请求、不改响应）。
 * @returns {void} 无
 */
function installResponseObserver() {
	if (observerInstalled) return
	observerInstalled = true
	const win = pageWindow()
	try {
		const XHR = win.XMLHttpRequest
		if (XHR?.prototype && !XHR.prototype.observedByAkinatorRunner) {
			XHR.prototype.observedByAkinatorRunner = true
			const { open, send } = XHR.prototype
			/**
			 * 记下请求地址后照常 open。
			 * @param {string} method 方法
			 * @param {string | URL} url 地址
			 * @param {...unknown} rest 其余参数
			 * @returns {unknown} 原结果
			 */
			XHR.prototype.open = function (method, url, ...rest) {
				this.akinatorRunnerUrl = url
				return open.call(this, method, url, ...rest)
			}
			/**
			 * 监听 load，把作答响应交给观察器后照常 send。
			 * @param {...unknown} args 参数
			 * @returns {unknown} 原结果
			 */
			XHR.prototype.send = function (...args) {
				this.addEventListener('load', () => {
					try {
						if (this.readyState === 4) recordStepResponse(this.akinatorRunnerUrl, this.responseText)
					} catch {
						/* 读取失败时忽略 */
					}
				})
				return send.apply(this, args)
			}
		}
	} catch {
		/* 页面不允许改写时忽略，退回只看 DOM */
	}
	try {
		const original = win.fetch
		if (typeof original === 'function' && !original.observedByAkinatorRunner) {
			/**
			 * 包装后的 fetch：读一份响应副本交给观察器，再原样返回。
			 * @param {RequestInfo | URL} input 输入
			 * @param {RequestInit} [init] 选项
			 * @returns {Promise<Response>} 响应
			 */
			const wrapped = function (input, init) {
				return original.call(this, input, init).then((response) => {
					try {
						const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
						response.clone().text().then((text) => recordStepResponse(url, text)).catch(() => undefined)
					} catch {
						/* 读取失败时忽略 */
					}
					return response
				})
			}
			wrapped.observedByAkinatorRunner = true
			win.fetch = wrapped
		}
	} catch {
		/* 页面不允许改写时忽略，退回只看 DOM */
	}
}

/**
 * 把「点击页面按钮、读回 DOM / 响应」实现的 akinator 客户端。
 */
export class PageAkinatorClient {
	/**
	 * @param {object} [options] 选项（与 HTTP 客户端保持同样的构造签名）
	 * @param {string} [options.region] 区域子域
	 * @param {number} [options.sid] 题库类型
	 * @param {boolean} [options.childMode] 儿童模式
	 */
	constructor(options = {}) {
		/** @type {string} */
		this.region = options.region ?? 'en'
		/** @type {number} */
		this.sid = options.sid ?? 1
		/** @type {boolean} */
		this.childMode = options.childMode ?? false
		/** @type {number} */
		this.step = 0
		/** @type {number} */
		this.progression = 0
		/** @type {Aki.Question | undefined} */
		this.question = undefined
		installResponseObserver()
	}

	/**
	 * 当前页面是否为 akinator 游戏页。
	 * @returns {boolean} 是否可驱动
	 */
	static available() {
		return !!document.getElementById('questionGameBlock')
	}

	/**
	 * 页面当前是否有进行中的问题（既能读题、又有可见的作答按钮）。
	 * @returns {boolean} 是否可继续作答
	 */
	hasActiveQuestion() {
		return !!this.#readQuestion()
	}

	/**
	 * 读取页面当前的第一题：页面在跳转 / 重开时已经自带会话与首题。
	 * @returns {Promise<Aki.Question>} 第一道题
	 */
	async start() {
		const question = this.#readQuestion()
		if (!question) throw new PageAkinatorError(geti18n('errors.pageQuestionMissing'))
		this.question = question
		this.step = question.step
		this.progression = question.progression
		return question
	}

	/**
	 * 点击页面上的答案按钮，让页面自己提交，再读回下一步。
	 * @param {number} answerIndex 答案索引 0..4
	 * @returns {Promise<Aki.StepResult>} 步骤结果
	 */
	async answer(answerIndex) {
		return await this.#clickAndRead(ANSWER_BUTTON_IDS[answerIndex])
	}

	/**
	 * 点击候选阶段的「否」，让页面自己发 /exclude，再读回下一步。
	 * @returns {Promise<Aki.StepResult>} 步骤结果
	 */
	async exclude() {
		return await this.#clickAndRead('a_propose_no')
	}

	/**
	 * 点击候选阶段的「是」，让页面自己发 /choice 并结束本局。
	 *
	 * 点击后**必须等页面自身的 `/choice` 汇报走完**再返回：akinator 靠这条请求计数并汇报
	 * 本局选择，脚本若抢在它完成前就 `POST /game` 开下一局（多局 / 歌单循环时），页面会被
	 * 导航走、请求被中断，选择就不会被 akinator 记入统计。
	 * @param {Aki.Guess} candidate 选中的候选
	 * @returns {Promise<Aki.StepResult>} 步骤结果（win）
	 */
	async choose(candidate) {
		const beforeSeq = stepResponse.seq
		this.#click('a_propose_yes')
		await this.#waitForChoice(beforeSeq)
		this.question = undefined
		return { type: 'win', guess: candidate }
	}

	/**
	 * 页面驱动下不提供回退（页面自身有回退按钮，脚本暂不驱动它）。
	 * @returns {Promise<Aki.Question | undefined>} 总是 undefined
	 */
	async back() {
		return undefined
	}

	/**
	 * 页面一次只提出一个候选，列表由页面自己翻页；这里不需要额外候选。
	 * @returns {Promise<Aki.Guess[]>} 空列表
	 */
	async list() {
		return []
	}

	/**
	 * 点击一个页面按钮，等页面自己提交完并渲染出下一步。
	 * @param {string | undefined} id 按钮 id
	 * @returns {Promise<Aki.StepResult>} 步骤结果
	 */
	async #clickAndRead(id) {
		const before = { signature: this.#signature(), seq: stepResponse.seq, ended: this.#gameEnded() }
		this.#click(id)
		await this.#waitForStep(before)
		return this.#readStepResult(before.seq)
	}

	/**
	 * 点击某个页面元素。
	 * @param {string | undefined} id 元素 id
	 * @returns {void} 无
	 */
	#click(id) {
		if (!id) return
		const element = document.getElementById(id)
		if (element) element.click()
	}

	/**
	 * 等待页面前进到下一个可判定状态。
	 *
	 * 优先看页面自身请求的响应（`/answer` 无 `question` 即认输），并且要等页面把新题 / 候选
	 * 渲染出来才算就绪，避免下一次点击落在还没渲染好的页面上；没有观察到响应时才退回看 DOM。
	 * @param {{ signature: string; seq: number; ended: boolean }} before 点击前的快照
	 * @returns {Promise<void>} 完成
	 */
	#waitForStep(before) {
		return new Promise((resolve, reject) => {
			let fallbackSince = 0
			let continued = false
			/**
			 * 收尾：断开监听并按有无错误 resolve / reject。
			 * @param {Error | undefined} error 超时错误（无则成功）
			 * @returns {void} 无
			 */
			const finish = (error) => {
				observer.disconnect()
				clearInterval(timer)
				if (error) reject(error)
				else resolve()
			}
			/**
			 * 检查页面是否已前进，未前进则继续等、超时就报错。
			 * @returns {void} 无
			 */
			const check = () => {
				// akinator 在「都不是」后常先弹「继续？」确认（按钮是 `#a_continue_yes` / `#a_continue_no`，
				// 同时把 `#a_propose_yes/no` 藏起来，还会把 `game_ended` 置 yes）。这里替用户点「是」继续。
				if (!continued && this.#continuePromptVisible()) {
					continued = true
					this.#click('a_continue_yes')
				}
				const hasResponse = stepResponse.seq > before.seq
				if (hasResponse) {
					if (this.#domReadyFor(stepResponse.data)) {
						finish(undefined)
						return
					}
				} else if (this.#signature() !== before.signature) {
					// 没有观察到响应（页面不走 XHR / fetch）时退回看 DOM：等到新题 / 候选 / 明确结束标志，
					// 再留一点缓冲给（可能迟到的）响应，避免用到上一次的旧响应。
					const kind = this.#classify()
					if (kind === 'question' || kind === 'proposal' || (kind === 'defeat' && !before.ended)) {
						if (!fallbackSince) fallbackSince = Date.now()
						if (Date.now() - fallbackSince >= DOM_FALLBACK_GRACE_MS) {
							finish(undefined)
							return
						}
					}
				}
				if (Date.now() >= deadline) finish(new PageAkinatorError(geti18n('errors.pageStepTimeout')))
			}
			const deadline = Date.now() + stepTimeoutMs()
			const observer = new MutationObserver(check)
			const timer = setInterval(check, POLL_INTERVAL_MS)
			observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true })
			check()
		})
	}

	/**
	 * 等待 akinator 页面自身的 `/choice` 汇报完成。
	 *
	 * 与等待下一步不同：命中时页面不再渲染下一题，只把结果页 / 候选区收起，唯一可判定的
	 * 信号就是页面自己发出的 `/choice` 响应。超时只放弃等待、不影响本局结果（页面不走
	 * XHR / fetch 这种极端情况下不至于卡死）。
	 * @param {number} beforeSeq 点击前的响应序号
	 * @returns {Promise<void>} 完成
	 */
	#waitForChoice(beforeSeq) {
		return new Promise((resolve) => {
			/**
			 * 收尾：断开监听并结束等待。
			 * @returns {void} 无
			 */
			const finish = () => {
				observer.disconnect()
				clearInterval(timer)
				clearTimeout(deadline)
				resolve()
			}
			/**
			 * 检查页面自身的 `/choice` 是否已到达。
			 * @returns {void} 无
			 */
			const check = () => {
				if (stepResponse.seq > beforeSeq && isChoiceUrl(stepResponse.url)) finish()
			}
			const deadline = setTimeout(finish, stepTimeoutMs())
			const observer = new MutationObserver(check)
			const timer = setInterval(check, POLL_INTERVAL_MS)
			observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true })
			check()
		})
	}

	/**
	 * 页面是否已经渲染出与响应一致的状态，可以接受下一次点击。
	 * @param {Record<string, unknown> | undefined} data 页面自身的响应
	 * @returns {boolean} 是否就绪
	 */
	#domReadyFor(data) {
		if (!data || typeof data !== 'object') return true
		if (data.id_proposition || data.id_base_proposition) return this.#proposeVisible()
		if (data.question) return !!this.#readQuestion()
		return true
	}

	/**
	 * 读取页面当前状态，分类为下一题 / 候选 / 认输。
	 * @param {number} seq 点击前响应序号
	 * @returns {Aki.StepResult} 步骤结果
	 */
	#readStepResult(seq) {
		if (stepResponse.seq > seq && stepResponse.data) return this.#resultFromResponse(stepResponse.data)
		return this.#resultFromDom()
	}

	/**
	 * 用页面自身请求的响应构造步骤结果。
	 * @param {Record<string, unknown>} data 响应
	 * @returns {Aki.StepResult} 步骤结果
	 */
	#resultFromResponse(data) {
		if (data.id_proposition || data.id_base_proposition) {
			const candidate = this.#candidateFrom(data)
			this.question = this.question ? { ...this.question, step: this.step, progression: this.progression } : undefined
			return { type: 'proposal', proposal: { baseId: String(data.id_base_proposition ?? data.id_proposition ?? candidate.id), candidates: [candidate], question: this.question } }
		}
		const text = stripHtml(String(data.question ?? ''))
		if (text) {
			const step = Number(data.step)
			const question = {
				key: normalizeQuestion(text),
				text,
				questionId: data.question_id ? String(data.question_id) : undefined,
				answers: this.#answersFrom(data),
				step: Number.isFinite(step) ? step : this.step,
				progression: Number(data.progression) || 0,
			}
			this.question = question
			this.step = question.step
			this.progression = question.progression
			return { type: 'question', question }
		}
		this.question = undefined
		return { type: 'defeat' }
	}

	/**
	 * 从响应 / 页面按钮取五个答案标签。
	 * @param {Record<string, unknown>} data 响应
	 * @returns {string[]} 标签
	 */
	#answersFrom(data) {
		const labels = asArray(data.answers).map((item) => stripHtml(String(item)))
		if (labels.length === 5 && labels.every((label) => !!label)) return labels
		const fromButtons = ANSWER_BUTTON_IDS.map((id, index) => document.getElementById(id)?.textContent?.trim() || ANSWER_LABELS[index])
		return fromButtons
	}

	/**
	 * 用响应里的字段构造候选。
	 * @param {Record<string, unknown>} data 响应
	 * @returns {Aki.Guess} 候选
	 */
	#candidateFrom(data) {
		const photo = String(data.photo ?? data.photo_path ?? '')
		return {
			id: String(data.id_proposition ?? data.id_base_proposition ?? ''),
			name: stripHtml(String(data.name_proposition ?? data.name ?? '')),
			description: stripHtml(String(data.description_proposition ?? data.description ?? '')),
			photo: photo ? new URL(photo, location.href).href : '',
			confidence: null,
			nbElements: Number.isFinite(Number(data.nb_elements)) ? Number(data.nb_elements) : undefined,
			raw: data,
		}
	}

	/**
	 * 没有观察到响应时，退回从 DOM 读回状态。
	 * @returns {Aki.StepResult} 步骤结果
	 */
	#resultFromDom() {
		if (this.#proposeVisible()) {
			const candidate = this.#readCandidate()
			this.question = this.question ? { ...this.question, step: this.step, progression: this.progression } : undefined
			return { type: 'proposal', proposal: { baseId: candidate.id, candidates: [candidate], question: this.question } }
		}
		const question = this.#readQuestion()
		if (question) {
			this.question = question
			this.step = question.step
			this.progression = question.progression
			return { type: 'question', question }
		}
		this.question = undefined
		return { type: 'defeat' }
	}

	/**
	 * 判定页面当前阶段。
	 * @returns {'question' | 'proposal' | 'defeat' | undefined} 阶段；无法判定时为 undefined
	 */
	#classify() {
		if (this.#continuePromptVisible()) return undefined
		if (this.#proposeVisible()) return 'proposal'
		if (this.#readQuestion()) return 'question'
		if (this.#gameEnded()) return 'defeat'
		return undefined
	}

	/**
	 * akinator 是否正在弹「继续？」确认（「都不是」之后问是否继续，按钮是
	 * `#a_continue_yes` / `#a_continue_no`）。此时 `game_ended` 会被置 yes，**不能**当成认输。
	 * @returns {boolean} 是否在等确认
	 */
	#continuePromptVisible() {
		return this.#buttonVisible('a_continue_yes')
	}

	/**
	 * akinator 是否已在 `localStorage` 标记本局结束（游戏页自己写的结束标志）。
	 * @returns {boolean} 本局是否已结束
	 */
	#gameEnded() {
		try {
			return localStorage.getItem('game_ended') === 'yes'
		} catch {
			return false
		}
	}

	/**
	 * 当前页面状态的特征串，用来判断页面是否已经前进。
	 * @returns {string} 特征串
	 */
	#signature() {
		const propose = document.getElementById('proposeGameBlock')
		const proposeVisible = !!propose && this.#isVisible(propose)
		const label = document.getElementById('question-label')?.textContent ?? ''
		const name = document.getElementById('name_proposition')?.textContent ?? ''
		const image = document.querySelector('#img_character img')
		return `${proposeVisible}|${label}|${name}|${image?.getAttribute('src') ?? ''}`
	}

	/**
	 * 从 DOM 读取当前问题；没有进行中的问题时返回 undefined。
	 * @returns {Aki.Question | undefined} 问题
	 */
	#readQuestion() {
		const block = document.getElementById('questionGameBlock')
		if (!block || !this.#isVisible(block)) return undefined
		const text = document.getElementById('question-label')?.textContent?.trim() ?? ''
		if (!text) return undefined
		if (!ANSWER_BUTTON_IDS.some((id) => this.#buttonVisible(id))) return undefined
		const stepText = document.getElementById('step-info')?.textContent ?? ''
		const parsedStep = Number.parseInt(stepText, 10)
		const step = Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep - 1 : this.step
		return {
			key: normalizeQuestion(text),
			text,
			answers: ANSWER_BUTTON_IDS.map((id, index) => document.getElementById(id)?.textContent?.trim() || ANSWER_LABELS[index]),
			step,
			progression: this.progression,
		}
	}

	/**
	 * 从 DOM 读取当前候选。
	 * @returns {Aki.Guess} 候选
	 */
	#readCandidate() {
		const image = document.querySelector('#img_character img')
		return {
			id: this.#readPropositionId(),
			name: document.getElementById('name_proposition')?.textContent?.trim() ?? '',
			description: document.getElementById('description_proposition')?.textContent?.trim() ?? '',
			photo: image?.getAttribute('src') ?? '',
			confidence: null,
			raw: {},
		}
	}

	/**
	 * 尽力读取当前候选 id：优先隐藏域 `#id_proposition`，其次候选「是」按钮的 `data-id`。
	 * @returns {string} 候选 id（读不到时为空串）
	 */
	#readPropositionId() {
		const input = document.getElementById('id_proposition')
		const hidden = input ? String(asRecord(input).value ?? '') : ''
		if (hidden) return hidden
		return document.getElementById('a_propose_yes')?.getAttribute('data-id') ?? ''
	}

	/**
	 * 候选区是否可见（需要真正的是 / 否按钮可见；「继续？」确认时 akinator 会把
	 * `#a_propose_yes/no` 藏起来、换成 `#a_continue_yes/no`，那种情况不算候选）。
	 * @returns {boolean} 是否可见
	 */
	#proposeVisible() {
		const propose = document.getElementById('proposeGameBlock')
		if (!propose || !this.#isVisible(propose)) return false
		return this.#buttonVisible('a_propose_yes') || this.#buttonVisible('a_propose_no')
	}

	/**
	 * 某个答案按钮是否可见。
	 * @param {string} id 按钮 id
	 * @returns {boolean} 是否可见
	 */
	#buttonVisible(id) {
		const button = document.getElementById(id)
		return !!button && this.#isVisible(button)
	}

	/**
	 * 元素是否可见（看计算样式，而非仅内联样式）。
	 * @param {Element} element 元素
	 * @returns {boolean} 是否可见
	 */
	#isVisible(element) {
		return getComputedStyle(element).display !== 'none'
	}
}
