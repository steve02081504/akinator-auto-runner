/**
 * 录制 / 回放引擎：驱动 akinator 客户端并按题库作答。
 *
 * 覆盖 akinator 的三种阶段：出题、认输给出候选列表、以及命中。
 * 候选阶段会按角色策略选择「命中候选」或「都不是」，从而让偏门角色也能挂机刷权重。
 *
 * 两类阶段只要引擎是「自己拿主意」的（回放查表、录制时复习已答过的题、候选自动选择），
 * 都会先经过一段类人延时（见 {@link module:shared/delay}）；延时可被 UI 打断并改写决定。
 * @module shared/engine
 */

import { ANSWER_LABELS } from './constants.mjs'
import { humanDelayMs } from './delay.mjs'
import { answerWeights, sampleAnswerIndex } from './schema.mjs'
import { sleep } from './util.mjs'

/**
 * 默认运行参数。
 * @type {Aki.RunOptions}
 */
const DEFAULT_RUN_OPTIONS = {
	mode: 'replay',
	characterId: '',
	rounds: 1,
	stepDelayMs: 5000,
	askUnknown: true,
	askProposal: false,
	stopOnWin: true,
	maxSteps: 80,
	region: 'en',
	sid: 1,
	childMode: false,
}

/**
 * 单局结果。
 * @typedef {object} RoundOutcome
 * @property {boolean} aborted 是否被中止
 * @property {boolean} won 是否命中
 * @property {boolean} [defeat] 是否 akinator 认输
 * @property {Aki.Guess} [guess] 相关猜测
 */

/**
 * 运行引擎。负责多局循环、答案查找、候选选择与状态广播。
 */
export class RunEngine {
	/**
	 * @param {object} config 配置
	 * @param {import('../userscript/page_client.mjs').PageAkinatorClient} config.client akinator 客户端（页面驱动）
	 * @param {import('./store.mjs').Store} config.store 数据存储
	 * @param {Aki.RunOptions} config.options 运行参数
	 * @param {Aki.EngineHandlers} [config.handlers] 回调
	 */
	constructor({ client, store, options, handlers = {} }) {
		/** @type {import('../userscript/page_client.mjs').PageAkinatorClient} */
		this.client = client
		/** @type {import('./store.mjs').Store} */
		this.store = store
		/** @type {Aki.RunOptions} */
		this.options = { ...DEFAULT_RUN_OPTIONS, ...options }
		/** @type {Aki.EngineHandlers} */
		this.handlers = handlers
		/** @type {Aki.RunState} */
		this.state = {
			running: false,
			mode: this.options.mode,
			characterId: this.options.characterId,
			round: 0,
			rounds: this.options.rounds,
			step: 0,
			progression: 0,
			wins: 0,
			losses: 0,
			awaitingUser: false,
		}
		/** @type {boolean} */
		this.stopped = false
		/** @type {((answer: number | null) => void) | undefined} */
		this.pendingAnswer = undefined
	}

	/**
	 * 开始运行。
	 * @returns {Promise<{ rounds: number; wins: number; losses: number }>} 统计
	 */
	async start() {
		if (this.state.running) return { rounds: this.state.round, wins: this.state.wins, losses: this.state.losses }
		const character = this.store.getCharacter(this.options.characterId)
		if (!character) throw new Error(`找不到角色：${this.options.characterId}`)
		this.stopped = false
		this.state.running = true
		this.#emitState()
		const totalRounds = this.options.rounds > 0 ? this.options.rounds : Number.POSITIVE_INFINITY
		let round = 0
		while (!this.stopped && round < totalRounds) {
			round++
			this.state.round = round
			this.state.step = 0
			this.state.progression = 0
			this.state.guess = undefined
			this.state.proposal = undefined
			this.#log('info', `第 ${round} 局开始（${this.options.mode === 'record' ? '录制' : '回放'}）`)
			/** @type {RoundOutcome} */
			let outcome
			try {
				outcome = await this.#runRound(character)
			} catch (error) {
				this.#log('error', error instanceof Error ? error.message : String(error))
				this.state.lastError = error instanceof Error ? error.message : String(error)
				this.handlers.onError?.(error)
				outcome = { aborted: true, won: false }
			}
			if (outcome.aborted) break
			if (outcome.won) this.state.wins++
			else this.state.losses++
			this.handlers.onRoundEnd?.({ round, won: outcome.won, guess: outcome.guess })
			this.#emitState()
			if (this.options.stopOnWin && outcome.won) break
		}
		this.state.running = false
		this.state.question = undefined
		this.state.proposal = undefined
		this.#emitState()
		const summary = { rounds: this.state.round, wins: this.state.wins, losses: this.state.losses }
		this.handlers.onDone?.(summary)
		return summary
	}

	/**
	 * 停止运行。
	 * @returns {void}
	 */
	stop() {
		this.stopped = true
		this.#resolveAnswer(null)
	}

	/**
	 * 由 UI 提交手动作答。
	 * @param {number | null} answer 答案索引，null 表示中止
	 * @returns {void}
	 */
	provideAnswer(answer) {
		this.#resolveAnswer(answer)
	}

	/**
	 * 解析待答 Promise。
	 * @param {number | null} answer 答案
	 * @returns {void}
	 */
	#resolveAnswer(answer) {
		const resolve = this.pendingAnswer
		this.pendingAnswer = undefined
		if (resolve) resolve(answer)
	}

	/**
	 * 运行一局。
	 * @param {Aki.Character} character 目标角色
	 * @returns {Promise<RoundOutcome>} 结果
	 */
	async #runRound(character) {
		let question = await this.client.start()
		for (let step = 0; step < this.options.maxSteps; step++) {
			if (this.stopped) return { aborted: true, won: false }
			this.state.step = question.step
			this.state.progression = question.progression
			this.state.question = question
			this.#emitState()
			const decision = await this.#decideAnswer(character, question)
			const decided = await this.#applyDelay(
				{ kind: 'answer', question, textLength: question.text.length, answer: decision.answer ?? undefined },
				decision,
			)
			if (decided.answer === null || this.stopped) return { aborted: true, won: false }
			this.#commitAnswer(character, question, decided)
			this.handlers.onAnswer?.({ question, answerIndex: decided.answer, added: decided.added, source: decided.source })
			let stepResult = await this.client.answer(decided.answer)
			while (true) {
				if (stepResult.type === 'question') {
					question = stepResult.question
					break
				}
				if (stepResult.type === 'win') return this.#finishWin(character, stepResult.guess)
				if (stepResult.type === 'defeat') {
					this.handlers.onDefeat?.()
					this.#log('warn', 'akinator 认输：没能猜出目标角色')
					return { aborted: false, won: false, defeat: true }
				}
				const proposalOutcome = await this.#handleProposal(character, stepResult.proposal)
				if (proposalOutcome) return proposalOutcome
				stepResult = await this.client.exclude()
			}
		}
		this.#log('warn', '达到单局最大步数，本局结束')
		return { aborted: false, won: false }
	}

	/**
	 * 自动决策前等待一段类人延时，给 UI 一个「反悔 / 纠正」的窗口。
	 *
	 * 只有引擎自己拿主意的决定才延时（用户手动作答时人本身就是那个延时）；
	 * 没有 `onDelay` 回调时退化成纯等待，行为与旧版固定延时一致。
	 * @param {Aki.DelayContext} context 延时上下文
	 * @param {Aki.AnswerDecision | Aki.ProposalDecision} decision 原本的决定
	 * @returns {Promise<Aki.AnswerDecision | Aki.ProposalDecision>} 可能被 UI 改写后的决定
	 */
	async #applyDelay(context, decision) {
		const base = Number(this.options.stepDelayMs ?? 0)
		if (decision.manual || !(base > 0)) return decision
		const durationMs = humanDelayMs(base, { textLength: context.textLength ?? 0 })
		if (durationMs <= 0) return decision
		if (!this.handlers.onDelay) {
			await sleep(durationMs)
			return decision
		}
		const outcome = await this.handlers.onDelay({ ...context, durationMs })
		if (!outcome) return decision
		return { ...decision, ...outcome }
	}

	/**
	 * 处理 akinator 给出的候选列表。
	 * @param {Aki.Character} character 目标角色
	 * @param {Aki.Proposal} proposal 候选
	 * @returns {Promise<RoundOutcome | undefined>} 命中时返回结果，排除时返回 undefined
	 */
	async #handleProposal(character, proposal) {
		this.state.proposal = proposal
		this.#emitState()
		const top = proposal.candidates[0]
		const suggested = proposal.candidates.find((candidate) => this.store.guessMatches(character, candidate))
		const decision = await this.#applyDelay(
			{ kind: 'proposal', proposal, suggested },
			await this.#decideProposal(character, proposal, suggested),
		)
		if (this.stopped) return { aborted: true, won: false }
		const record = {
			at: Date.now(),
			baseId: proposal.baseId,
			candidates: proposal.candidates.map((candidate) => ({ id: candidate.id, name: candidate.name })),
			action: decision.action,
			pickId: decision.pickId,
			manual: decision.manual,
		}
		this.store.recordChoice(character.id, record, { lockPolicy: this.options.mode !== 'record' })
		if (decision.action === 'pick') {
			const candidate = proposal.candidates.find((item) => item.id === decision.pickId) ?? suggested ?? top
			if (!candidate) return undefined
			this.store.rememberGuess(character.id, candidate.id)
			await this.client.choose(candidate)
			return this.#finishWin(character, candidate)
		}
		this.handlers.onGuess?.(top, false)
		this.state.guess = top
		this.state.proposal = undefined
		this.#emitState()
		this.#log('info', `都不是（候选 ${proposal.candidates.length} 个，如 ${top?.name ?? '-'}）`)
		return undefined
	}

	/**
	 * 决定候选阶段的选择。
	 * @param {Aki.Character} character 目标角色
	 * @param {Aki.Proposal} proposal 候选
	 * @param {Aki.Guess | undefined} suggested 命中的候选
	 * @returns {Promise<Aki.ProposalDecision>} 决定
	 */
	async #decideProposal(character, proposal, suggested) {
		if (this.handlers.onProposal) {
			const decision = await this.handlers.onProposal(proposal, suggested)
			if (decision) return decision
		}
		if (suggested && this.store.getChoice(character.id).policy !== 'exclude') return { action: 'pick', pickId: suggested.id, manual: false }
		return { action: 'exclude', manual: false }
	}

	/**
	 * 处理命中。
	 * @param {Aki.Character} character 目标角色
	 * @param {Aki.Guess} guess 命中的角色
	 * @returns {RoundOutcome} 结果
	 */
	#finishWin(character, guess) {
		this.store.rememberGuess(character.id, guess.id)
		this.handlers.onGuess?.(guess, true)
		this.state.guess = guess
		this.state.proposal = undefined
		this.#emitState()
		this.#log('success', `命中：${guess.name}`)
		return { aborted: false, won: true, guess }
	}

	/**
	 * 决定当前问题的答案（只做决定，不写数据）。
	 *
	 * 录制模式下已有答案的题也走自动决定（当成「复习」），用户仍可在延时窗口里改选。
	 * @param {Aki.Character} character 角色
	 * @param {Aki.Question} question 问题
	 * @returns {Promise<Aki.AnswerDecision>} 决定
	 */
	async #decideAnswer(character, question) {
		const recorded = this.store.getAnswer(character.id, question.text)
		if (recorded) {
			// 回放按角色的历史作答概率随机抽取（而非永远取最大权重），让每一次都不太一样。
			const answer = sampleAnswerIndex(answerWeights(recorded), recorded.answer)
			return { answer, recorded, source: 'recorded', manual: false, added: false }
		}
		if (this.options.mode === 'record') {
			const answer = await this.#requestAnswer(question, 'record', recorded)
			return { answer, recorded, source: 'user', manual: true, added: true }
		}
		if (this.options.askUnknown) {
			this.#log('warn', `未记录的问题，等待补充：${question.text}`)
			const answer = await this.#requestAnswer(question, 'unknown', recorded)
			return { answer, recorded, source: 'user', manual: true, added: true }
		}
		this.#log('warn', `未知问题按「不知道」处理：${question.text}`)
		return { answer: 2, recorded, source: 'default', manual: false, added: false }
	}

	/**
	 * 把决定落库：回放的历史答案直接跳过（不累计选择次数），其余按处理方式记录 / 覆盖权重。
	 * @param {Aki.Character} character 角色
	 * @param {Aki.Question} question 问题
	 * @param {Aki.AnswerDecision} decided 决定
	 * @returns {void} 无
	 */
	#commitAnswer(character, question, decided) {
		if (decided.answer === null || decided.source === 'default') return
		const label = ANSWER_LABELS[decided.answer] ?? String(decided.answer)
		if (decided.treatment === 'correct') {
			this.store.correctAnswer(character.id, question, decided.answer)
			this.#log('warn', `已纠正〔重置本题概率〕[${label}]：${question.text}`)
			return
		}
		// 回放不增加选择次数：历史答案只用来作答，不再累计权重（否则权重会随挂机无限膨胀）。
		// 用户主动「追加概率」时 `treatment` 为 append，仍按下面正常记录。
		if (decided.source === 'recorded' && this.options.mode !== 'record' && !decided.treatment) return
		const record = this.store.recordAnswer(character.id, question, decided.answer)
		this.#logAnswer(question, decided.answer, decided.recorded, record?.count ?? 1)
	}

	/**
	 * 记录用户刚提交的答案（新题 / 改答 / 补题各有一种日志），便于在 UI 上实时看到录制进度。
	 *
	 * 角色这道题的权重按答案索引累计，因此同一题答法不同会同时留在这道题的分布里；
	 * 角色自身的答案取最后一次。`#${total}` 是这道题在该角色下的权重总和。
	 * @param {Aki.Question} question 问题
	 * @param {number} answer 本次答案索引
	 * @param {Aki.AnswerRecord | undefined} previous 该角色的历史答案
	 * @param {number} total 该角色这道题更新后的权重总和
	 * @returns {void} 无
	 */
	#logAnswer(question, answer, previous, total) {
		const label = ANSWER_LABELS[answer] ?? String(answer)
		if (!previous) {
			this.#log('success', `已录制#${total}[${label}]：${question.text}`)
			return
		}
		if (previous.answer === answer) {
			this.#log('info', `已复习#${total}[${label}]：${question.text}`)
			return
		}
		this.#log('warn', `已改答#${total}[${ANSWER_LABELS[previous.answer] ?? previous.answer} → ${label}]：${question.text}`)
	}

	/**
	 * 请求用户作答。
	 * @param {Aki.Question} question 问题
	 * @param {'unknown' | 'record'} reason 原因
	 * @param {Aki.AnswerRecord | undefined} recorded 已有记录
	 * @returns {Promise<number | null>} 答案索引
	 */
	async #requestAnswer(question, reason, recorded) {
		this.state.awaitingUser = true
		this.#emitState()
		try {
			const handler = reason === 'unknown' ? this.handlers.onUnknown : this.handlers.onAsk
			if (handler) return await handler(question, recorded)
			return await new Promise((resolve) => {
				this.pendingAnswer = resolve
			})
		} finally {
			this.state.awaitingUser = false
			this.#emitState()
		}
	}

	/**
	 * 记录日志并广播。
	 * @param {Aki.LogEntry['level']} level 级别
	 * @param {string} message 信息
	 * @returns {void}
	 */
	#log(level, message) {
		this.handlers.onLog?.({ time: Date.now(), level, message })
	}

	/**
	 * 广播状态快照。
	 * @returns {void}
	 */
	#emitState() {
		this.handlers.onState?.({ ...this.state })
	}
}
