/**
 * akinator 同源 HTTP 客户端。
 *
 * 因为 akinator.com 走 Cloudflare，外部直连会被 403；本客户端设计为在
 * `*.akinator.com` 页面（含站点打开的弹窗）内运行，复用页面 Cookie 同源请求。
 * @module shared/akinator
 */

import { ANSWER_KEYS, ANSWER_LABELS, SID } from './constants.mjs'
import { geti18n as t } from './i18n/index.mjs'
import { asArray, asRecord, normalizeQuestion, sleep, stripHtml } from './util.mjs'

/** JSON 接口遇到 Cloudflare / 瞬时错误时的重试次数。 */
const JSON_RETRY_ATTEMPTS = 3
/** JSON 接口重试的基础退避毫秒（第 n 次重试等待 n 倍）。 */
const JSON_RETRY_DELAY_MS = 800

/** akinator 接口出错。 */
export class AkinatorError extends Error {
	/**
	 * @param {string} message 错误信息
	 * @param {string} [completion] 服务端 completion 码
	 */
	constructor(message, completion) {
		super(message)
		this.name = 'AkinatorError'
		/** @type {string | undefined} */
		this.completion = completion
	}
}

/**
 * 把 akinator 的 completion 错误码翻译为可读信息。
 * @param {string} completion completion 码
 * @returns {string} 可读信息
 */
function describeCompletion(completion) {
	switch (completion) {
		case 'KO - SERVER DOWN':
			return t('errors.serverDown')
		case 'KO - TECHNICAL ERROR':
			return t('errors.technical')
		case 'KO - INCORRECT PARAMETER':
			return t('errors.badParameter')
		case 'KO - TIMEOUT':
			return t('errors.timeout')
		case 'WARN - NO QUESTION':
			return t('errors.noMoreQuestions')
		case 'KO - MISSING PARAMETERS':
			return t('errors.missingParameters')
		default:
			return t('errors.unknownCompletion', { completion: completion || '?' })
	}
}

/**
 * akinator 客户端。
 */
export class AkinatorClient {
	/**
	 * @param {object} [options] 选项
	 * @param {string} [options.region] 区域子域，如 en / cn
	 * @param {string} [options.baseUrl] 覆盖基地址（测试用）
	 * @param {number} [options.sid] 题库类型
	 * @param {boolean} [options.childMode] 儿童模式
	 */
	constructor(options = {}) {
		/** @type {string} */
		this.region = options.region ?? 'en'
		/** @type {string} */
		this.baseUrl = options.baseUrl ?? `https://${this.region}.akinator.com`
		/** @type {number} */
		this.sid = options.sid ?? SID.character
		/** @type {boolean} */
		this.childMode = options.childMode ?? false
		/** @type {string} */
		this.session = ''
		/** @type {string} */
		this.signature = ''
		/** @type {string} */
		this.identifiant = ''
		/** @type {string} */
		this.lastProposition = ''
		/** @type {string} */
		this.proposalBase = ''
		/** @type {string[]} */
		this.answerLabels = []
		/** @type {number} */
		this.step = 0
		/** @type {number} */
		this.progression = 0
		/** @type {Aki.Question | undefined} */
		this.question = undefined
	}

	/**
	 * 开始一局新游戏。
	 * @returns {Promise<Aki.Question>} 第一道题
	 */
	async start() {
		const html = await this.#postText('/game', {
			sid: this.sid,
			cm: this.childMode ? 'true' : 'false',
		})
		this.session = extractField(html, ['session', 'uid_ext_session']) ?? ''
		this.signature = extractField(html, ['signature', 'frontaddr']) ?? ''
		this.identifiant = extractField(html, ['identifiant']) ?? ''
		const questionText = extractQuestionText(html)
		if (!this.session || !this.signature || !questionText) throw new AkinatorError(t('errors.sessionParse'))
		this.lastProposition = ''
		this.proposalBase = ''
		this.step = 0
		this.progression = 0
		this.answerLabels = extractAnswerLabels(html)
		this.question = {
			key: normalizeQuestion(questionText),
			text: questionText,
			questionId: extractQuestionId(html),
			answers: this.answerLabels.length === 5 ? this.answerLabels : [...ANSWER_LABELS],
			step: 0,
			progression: 0,
		}
		return this.question
	}

	/**
	 * 回答当前问题，返回下一题或猜测结果。
	 * @param {number} answerIndex 答案索引 0..4
	 * @returns {Promise<Aki.StepResult>} 步骤结果
	 */
	async answer(answerIndex) {
		const data = await this.#postJson('/answer', {
			step: this.step,
			progression: this.progression,
			sid: this.sid,
			cm: this.childMode ? 'true' : 'false',
			answer: answerIndex,
			step_last_proposition: this.lastProposition,
			session: this.session,
			signature: this.signature,
		})
		return await this.#applyResponse(data)
	}

	/**
	 * 猜错后继续（排除上一个猜测）。
	 * @returns {Promise<Aki.StepResult>} 步骤结果
	 */
	async exclude() {
		const data = await this.#postJson('/exclude', {
			step: this.step,
			progression: this.progression,
			sid: this.sid,
			cm: this.childMode ? 'true' : 'false',
			session: this.session,
			signature: this.signature,
			forward_answer: '1',
		})
		return await this.#applyResponse(data)
	}

	/**
	 * 回退一步。
	 * @returns {Promise<Aki.Question | undefined>} 上一题
	 */
	async back() {
		const data = await this.#postJson('/cancel_answer', {
			step: this.step,
			progression: this.progression,
			sid: this.sid,
			cm: this.childMode ? 'true' : 'false',
			session: this.session,
			signature: this.signature,
		})
		const result = await this.#applyResponse(data)
		if (result.type === 'question') return result.question
		return undefined
	}

	/**
	 * 拉取某个命题下的候选角色列表（用于认输时展示多候选）。
	 * @param {string} [baseId] 命题基 id
	 * @param {number} [size] 候选数量
	 * @returns {Promise<Aki.Guess[]>} 候选列表
	 */
	async list(baseId, size = 15) {
		const query = new URLSearchParams({
			base: baseId ?? this.proposalBase,
			channel: '0',
			session: this.session,
			signature: this.signature,
			step: String(this.step),
			size: String(size),
			max_pic_width: '768',
			max_pic_height: '1365',
			mode_question: '0',
		})
		try {
			const response = await this.#fetch(`/ws/list.php?${query.toString()}`, undefined)
			const json = asRecord(JSON.parse(await response.text()))
			return asArray(json.elements).map((element) => this.#guessFrom(asRecord(element)))
		} catch {
			return []
		}
	}

	/**
	 * 从候选列表中选择一个角色，提交后 akinator 判定为正确（游戏结束）。
	 * @param {Aki.Guess} candidate 候选角色
	 * @returns {Promise<Aki.StepResult>} 步骤结果（win）
	 */
	async choose(candidate) {
		await this.#postText('/choice', {
			step: this.step,
			sid: this.sid,
			session: this.session,
			signature: this.signature,
			identifiant: this.identifiant,
			pid: candidate.id,
			charac_name: candidate.name,
			charac_description: candidate.description,
			pflag_photo: String(candidate.raw?.flag_photo ?? ''),
		})
		return { type: 'win', guess: candidate }
	}

	/**
	 * 处理接口返回，更新内部状态并分类结果。
	 * @param {Record<string, unknown>} data 接口返回
	 * @returns {Promise<Aki.StepResult>} 步骤结果
	 */
	async #applyResponse(data) {
		const completion = String(data.completion ?? '')
		if (completion && completion !== 'OK' && !data.id_proposition && !data.id_base_proposition && !data.question)
			throw new AkinatorError(describeCompletion(completion), completion)
		this.step = Number(data.step) || this.step
		this.progression = parseFloat(String(data.progression ?? this.progression)) || this.progression
		if (data.id_proposition || data.id_base_proposition) return await this.#buildProposal(data)
		const questionText = stripHtml(String(data.question ?? ''))
		if (!questionText) {
			this.lastProposition = ''
			this.proposalBase = ''
			return { type: 'defeat' }
		}
		const labels = extractAnswerLabels(JSON.stringify(data))
		const question = {
			key: normalizeQuestion(questionText),
			text: questionText,
			questionId: stringOrUndefined(data.question_id),
			answers: labels.length === 5 ? labels : this.answerLabels.length === 5 ? this.answerLabels : [...ANSWER_LABELS],
			step: this.step,
			progression: this.progression,
		}
		this.lastProposition = ''
		this.proposalBase = ''
		this.question = question
		return { type: 'question', question }
	}

	/**
	 * 根据命题响应构造候选列表。
	 * @param {Record<string, unknown>} data 命题响应
	 * @returns {Promise<Aki.StepResult>} proposal 结果
	 */
	async #buildProposal(data) {
		const top = this.#guessFrom(data)
		const baseId = String(data.id_base_proposition ?? data.id_proposition ?? top.id)
		this.lastProposition = top.id
		this.proposalBase = baseId
		if (this.question) this.question = { ...this.question, step: this.step, progression: this.progression }
		let candidates = await this.list(baseId)
		if (!candidates.some((candidate) => candidate.id === top.id)) candidates = [top, ...candidates]
		return {
			type: 'proposal',
			proposal: { baseId, candidates, question: this.question },
		}
	}

	/**
	 * 从任意来源构造猜测对象。
	 * @param {Record<string, unknown>} data 数据
	 * @returns {Aki.Guess} 猜测
	 */
	#guessFrom(data) {
		const id = String(data.id_base_proposition ?? data.id_proposition ?? data.id ?? '')
		const photo = String(data.photo ?? data.photo_path ?? data.suggestion_photo ?? '')
		return {
			id,
			name: stripHtml(String(data.name_proposition ?? data.name ?? '')),
			description: stripHtml(String(data.description_proposition ?? data.description ?? '')),
			photo: photo ? new URL(photo, this.baseUrl).href : '',
			confidence: parseConfidence(data.proba ?? data.probability ?? data.progression),
			nbElements: Number.isFinite(Number(data.nb_elements)) ? Number(data.nb_elements) : undefined,
			raw: data,
		}
	}

	/**
	 * 发送表单并解析 JSON 响应。
	 *
	 * akinator 走 Cloudflare，偶发会返回挑战页 / HTML 错误页（`响应不是 JSON`）或 5xx；
	 * 这类响应通常是瞬时的，这里带退避重试，避免一次抖动就中断整局运行。
	 * @param {string} path 路径
	 * @param {Record<string, unknown>} params 表单字段
	 * @returns {Promise<Record<string, unknown>>} JSON 对象
	 */
	async #postJson(path, params) {
		/** @type {unknown} */
		let lastError
		for (let attempt = 0; attempt < JSON_RETRY_ATTEMPTS; attempt++) {
			if (attempt > 0) await sleep(JSON_RETRY_DELAY_MS * attempt)
			try {
				const response = await this.#fetch(path, params)
				const text = await response.text()
				try {
					return asRecord(JSON.parse(text))
				} catch {
					lastError = new AkinatorError(t('errors.nonJson'))
				}
			} catch (error) {
				lastError = error
			}
		}
		throw lastError instanceof Error ? lastError : new AkinatorError(t('errors.nonJson'))
	}

	/**
	 * 发送表单并返回文本响应。
	 * @param {string} path 路径
	 * @param {Record<string, unknown>} params 表单字段
	 * @returns {Promise<string>} 响应文本
	 */
	async #postText(path, params) {
		const response = await this.#fetch(path, params)
		return await response.text()
	}

	/**
	 * 底层 fetch：同源、表单编码、带 AJAX 头。
	 * @param {string} path 路径
	 * @param {Record<string, unknown> | undefined} params 表单字段
	 * @returns {Promise<Response>} 响应
	 */
	async #fetch(path, params) {
		/** @type {RequestInit} */
		const init = {
			method: params ? 'POST' : 'GET',
			credentials: 'include',
			headers: {
				'X-Requested-With': 'XMLHttpRequest',
				Accept: 'application/json, text/javascript, */*; q=0.01',
			},
		}
		if (params) {
			init.body = new URLSearchParams(stringifyParams(params)).toString()
			init.headers = {
				...asRecord(init.headers),
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
			}
		}
		const response = await fetch(`${this.baseUrl}${path}`, init)
		if (!response.ok) throw new AkinatorError(t('errors.http', { status: response.status, path }))
		return response
	}
}

/**
 * 把参数值统一转为字符串。
 * @param {Record<string, unknown>} params 原参数
 * @returns {Record<string, string>} 字符串参数
 */
function stringifyParams(params) {
	/** @type {Record<string, string>} */
	const result = {}
	for (const [key, value] of Object.entries(params))
		if (value !== undefined && value !== null) result[key] = String(value)
	return result
}

/**
 * 把值转为字符串或 undefined。
 * @param {unknown} value 输入
 * @returns {string | undefined} 字符串
 */
function stringOrUndefined(value) {
	if (value === undefined || value === null || value === '') return undefined
	return String(value)
}

/**
 * 解析 akinator 返回的置信度，统一为百分比。
 * @param {unknown} value 原始值
 * @returns {number | null} 百分比
 */
function parseConfidence(value) {
	const numeric = Number.parseFloat(String(value ?? ''))
	if (!Number.isFinite(numeric)) return null
	const percent = numeric <= 1 ? numeric * 100 : numeric
	return Math.round(Math.min(Math.max(percent, 0), 100) * 10) / 10
}

/**
 * 从 HTML / JS 片段里抽取类似 `session: 'xxx'` / `session = "xxx"` 的字段。
 * @param {string} source 源文本
 * @param {string[]} names 候选字段名
 * @returns {string | undefined} 字段值
 */
function extractField(source, names) {
	for (const name of names) {
		const patterns = [
			new RegExp(`${name}\\s*[:=]\\s*'([^']+)'`),
			new RegExp(`${name}\\s*[:=]\\s*"([^"]+)"`),
			new RegExp(`${name}['"]\\)\\.val\\(['"]([^'"]+)['"]\\)`),
			new RegExp(`id=["']${name}["'][^>]*value=["']([^"']+)["']`, 'i'),
			new RegExp(`value=["']([^"']+)["'][^>]*id=["']${name}["']`, 'i'),
		]
		for (const pattern of patterns) {
			const match = source.match(pattern)
			if (match?.[1]) return match[1]
		}
	}
	return undefined
}

/**
 * 从起始页 HTML 抽取问题文本。
 * @param {string} html HTML
 * @returns {string | undefined} 问题文本
 */
function extractQuestionText(html) {
	const patterns = [
		/<p[^>]*class=["'][^"']*question-text[^"']*["'][^>]*>([\S\s]*?)<\/p>/i,
		/<[^>]*id=["']question-label["'][^>]*>([\S\s]*?)<\//i,
		/<p[^>]*class=["'][^"']*question-text[^"']*["'][^>]*>([\S\s]*?)<\/p>/i,
	]
	for (const pattern of patterns) {
		const match = html.match(pattern)
		if (match?.[1]) {
			const text = stripHtml(match[1])
			if (text) return text
		}
	}
	return undefined
}

/**
 * 从起始页 HTML 抽取问题 id。
 * @param {string} html HTML 或 JSON 片段
 * @returns {string | undefined} 问题 id
 */
function extractQuestionId(html) {
	const patterns = [
		/question_id["']?\s*[:=]\s*["']?([\w-]+)/i,
		/id=["']question_id["'][^>]*value=["']([^"']+)["']/i,
	]
	for (const pattern of patterns) {
		const match = html.match(pattern)
		if (match?.[1]) return match[1]
	}
	return undefined
}

/**
 * 抽取五个答案按钮的本地化标签。
 * @param {string} source HTML 或 JSON 片段
 * @returns {string[]} 标签数组（不足 5 个时为空数组）
 */
function extractAnswerLabels(source) {
	const labels = ANSWER_KEYS.map((key) => {
		const id = `a_${key}`
		const html = new RegExp(`id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/a>`, 'i').exec(source)
		if (html?.[1]) return stripHtml(html[1])
		return ''
	})
	if (labels.every((label) => !!label)) return labels
	const jsonMatch = source.match(/"answers"\s*:\s*\[([\S\s]*?)]/)
	if (jsonMatch?.[1]) {
		const values = jsonMatch[1]
			.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
			.map((item) => stripHtml(item.replace(/^"|"$/g, '').trim()))
			.filter(Boolean)
		if (values.length === 5) return values
	}
	return []
}
