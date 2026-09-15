/**
 * 运行控制：驱动录制 / 回放的整局流程，处理作答、候选选择、类人延时与「纠正 / 追加」。
 * @module userscript/app/run
 */

import { SID } from '../../shared/constants.mjs'
import { recordAnswer, recordSession } from '../../shared/devotion.mjs'
import { RunEngine } from '../../shared/engine.mjs'
import { nextTrackId } from '../../shared/playlist.mjs'
import { now } from '../../shared/util.mjs'
import { ringBell, stopBell } from '../bell.mjs'
import { geti18n } from '../i18n.mjs'
import { enterGamePage, shouldEnterGamePage } from '../navigation.mjs'
import { PageAkinatorError } from '../page_client.mjs'

/**
 * 单局 / 多局运行的状态机。UI 与站点桥通过 {@link App} 的转发方法驱动它。
 */
export class RunController {
	/**
	 * @param {import('./index.mjs').App} app 应用
	 */
	constructor(app) {
		/** @type {import('./index.mjs').App} */
		this.app = app
		/** @type {RunEngine | undefined} */
		this.engine = undefined
		/** @type {((answer: number | null) => void) | undefined} */
		this.pendingAnswer = undefined
		/** @type {((decision: Aki.ProposalDecision | null) => void) | undefined} */
		this.pendingProposal = undefined
		/** @type {Aki.DelayState | undefined} 正在倒计时的自动决策。 */
		this.delay = undefined
		/** @type {ReturnType<typeof setTimeout> | undefined} 当前延时的结束定时器。 */
		this.delayTimer = undefined
		/** @type {((outcome: Aki.DelayOutcome | null) => void) | undefined} 当前延时的 resolver。 */
		this.pendingDelay = undefined
		/** @type {Aki.InterventionState | undefined} 等待用户选择「纠正 / 追加」时的状态。 */
		this.intervention = undefined
		/** @type {((treatment: Aki.AnswerTreatment) => void) | undefined} 干预选择 Promise 的 resolver。 */
		this.pendingIntervention = undefined
		/** 用户最近一次操作的时刻（作答 / 选候选），用于把提醒延后到静默满期。 */
		this.lastUserActionAt = now()
		/** @type {ReturnType<typeof setTimeout> | undefined} 待触发的提醒定时器。 */
		this.bellTimer = undefined
	}

	/**
	 * 开始运行（录制 / 回放）。
	 *
	 * 录制模式下无需事先建角色：会即时创建一个占位角色并立刻开录，结束后用
	 * akinator 的猜测自动回填名称 / 图片 / 描述（见 {@link RunController#finishRecord}）。
	 * 回放模式仍然必须先选定角色。
	 * @param {Aki.StartRunRequest} [overrides] 覆盖参数
	 * @returns {Promise<{ rounds: number; wins: number; losses: number }>} 统计
	 */
	async startRun(overrides = {}) {
		const { app } = this
		// 本次是否由歌单驱动：跑完一首后按播放模式续播下一首（见 #continuePlaylist）。
		const queueDriven = overrides.queue === true
		this.stopRun()
		// 手动开跑别的（回放 / 录制）即视为退出歌单播放，免得单次运行跑完还去续播。
		if (!queueDriven && app.playlist.active) app.updatePlaylist({ active: false })
		const mode = overrides.mode ?? app.settings.mode
		// 非游戏页，或游戏页上一局已结束：页面上没有可作答的问题，先复刻 akinator 自己的
		// 「开始」重新 POST /game 跳到一局新游戏，加载后再由 index.mjs 自动续跑。
		if (shouldEnterGamePage()) {
			// 跳转会重载脚本，先把题库落盘，免得刚导入 / 新建的角色随页面一起丢。
			await app.saveNow().catch(() => undefined)
			enterGamePage(overrides, { sid: app.settings.sid ?? SID.character, childMode: !!app.settings.childMode })
			return { rounds: 0, wins: 0, losses: 0 }
		}
		let {characterId} = overrides
		let autoCreated = false
		let autoNamed = false
		if (!characterId) {
			if (mode !== 'record') throw new Error(geti18n('run.noCharacter'))
			const { character, generated } = this.#createRecordTarget(overrides.draft)
			characterId = character.id
			autoCreated = true
			autoNamed = generated
		}
		const requestedRounds = Number(overrides.rounds ?? app.settings.rounds ?? 1)
		const stopOnWin = overrides.stopOnWin ?? app.settings.stopOnWin
		const provider = normalizeProvider(overrides.clientProvider ?? app.settings.clientProvider)
		const infinite = !(requestedRounds > 0)
		/** @type {Aki.Guess | undefined} */
		let lastGuess
		/** 最近一次底层运行是否因页面驱动出错而中止。 */
		let pageError = false
		app.startSession(characterId, mode)
		/**
		 * 用指定底层提供商跑一次。
		 * @param {'page' | 'api'} selectedProvider 提供商
		 * @param {number} rounds 本次要跑的局数
		 * @returns {Promise<{ summary: { rounds: number; wins: number; losses: number }; stopped: boolean }>} 结果
		 */
		const run = async (selectedProvider, rounds) => {
			pageError = false
			const engine = new RunEngine({
				client: app.createClient(selectedProvider),
				store: app.store,
				options: {
					mode,
					characterId,
					// 页面驱动下「一局 = 一次 akinator 游戏」：akinator 每局结束后页面处于终态，
					// 必须重新 POST /game（刷新）才能再开一局。因此页面驱动一次只跑一局，
					// 剩下的局数在跑完后交给「待运行」机制在刷新后续跑（见本方法末尾）；
					// 内置 HTTP 会话可以一次跑完所有局。
					rounds,
					stepDelayMs: overrides.stepDelayMs ?? app.settings.stepDelayMs,
					askUnknown: overrides.askUnknown ?? app.settings.askUnknown,
					askProposal: overrides.askProposal ?? app.settings.askProposal,
					stopOnWin,
					maxSteps: overrides.maxSteps ?? app.settings.maxSteps,
					region: app.currentRegion(),
					sid: app.settings.sid ?? SID.character,
					childMode: app.settings.childMode,
				},
				handlers: {
					/**
					 * 转发运行状态。
					 * @param {Aki.RunState} state 状态快照
					 * @returns {void} 无
					 */
					onState: (state) => app.emit('state', state),
					/**
					 * 转发日志。
					 * @param {Aki.LogEntry} entry 日志条目
					 * @returns {void} 无
					 */
					onLog: (entry) => app.pushLog(entry),
					/**
					 * 录制模式下请求用户作答。
					 * @param {Aki.Question} question 当前问题
					 * @param {Aki.AnswerRecord | undefined} recorded 已有记录
					 * @returns {Promise<number | null>} 答案索引
					 */
					onAsk: (question, recorded) => this.#requestAnswer('record', question, recorded),
					/**
					 * 回放模式下遇到未知问题请求用户补充。
					 * @param {Aki.Question} question 当前问题
					 * @param {Aki.AnswerRecord | undefined} recorded 已有记录
					 * @returns {Promise<number | null>} 答案索引
					 */
					onUnknown: (question, recorded) => this.#requestAnswer('unknown', question, recorded),
					/**
					 * 统计每次作答。
					 * @param {{ question: Aki.Question; answerIndex: number; added: boolean; source: string }} info 作答信息
					 * @returns {void} 无
					 */
					onAnswer: (info) => {
						recordAnswer(app.devotion, characterId, { length: info.question.text.length, added: info.added })
						app.saveDevotion()
						app.emit('answer', info)
					},
					/**
					 * 候选阶段决定选择。
					 * @param {Aki.Proposal} proposal 候选
					 * @param {Aki.Guess | undefined} suggested 命中候选
					 * @returns {Promise<Aki.ProposalDecision | null>} 决定
					 */
					onProposal: (proposal, suggested) => this.#decideProposal(characterId, proposal, suggested, mode),
					/**
					 * 自动决策前的类人延时：交给 UI 画倒计时，期间用户可改选。
					 * @param {Aki.DelayContext} context 延时上下文
					 * @returns {Promise<Aki.DelayOutcome | null>} 覆盖决定（null 表示照常提交）
					 */
					onDelay: (context) => this.#awaitDelay(context),
					/**
					 * 转发猜测。
					 * @param {Aki.Guess | undefined} guess 猜测
					 * @param {boolean} autoCorrect 自动判定是否正确
					 * @returns {void} 无
					 */
					onGuess: (guess, autoCorrect) => {
						if (guess) lastGuess = guess
						if (guess && autoCorrect) this.#syncGuessMetadata(characterId, guess)
						app.emit('guess', { guess, correct: autoCorrect })
					},
					/**
					 * 通知 akinator 认输。
					 * @returns {void} 无
					 */
					onDefeat: () => app.emit('defeat'),
					/**
					 * 记录页面驱动特有的错误，供 `auto` 模式回退到内置 HTTP 会话。
					 * @param {unknown} error 错误
					 * @returns {void} 无
					 */
					onError: (error) => {
						if (error instanceof PageAkinatorError) pageError = true
					},
					/**
					 * 统计每局结果。
					 * @param {{ round: number; won: boolean; guess?: Aki.Guess }} result 单局结果
					 * @returns {void} 无
					 */
					onRoundEnd: (result) => {
						if (result.guess) lastGuess = result.guess
						recordSession(app.devotion, characterId, result.won)
						app.saveDevotion()
						app.emit('roundEnd', result)
					},
					/**
					 * 转发运行结束。
					 * @param {{ rounds: number; wins: number; losses: number }} summary 汇总
					 * @returns {void} 无
					 */
					onDone: (summary) => app.emit('done', summary),
				},
			})
			this.engine = engine
			const summary = await engine.start()
			this.engine = undefined
			return { summary, stopped: engine.stopped }
		}
		let result
		let usedFallback = false
		if (provider === 'api') result = await run('api', infinite ? 0 : requestedRounds)
		else {
			result = await run('page', 1)
			// 页面驱动出错（页面没题 / 点了不响应）时兜底：改用内置 HTTP 会话重跑。
			if (pageError && provider === 'auto') {
				app.pushLog({ time: now(), level: 'warn', message: geti18n('logs.providerFallback') })
				result = await run('api', infinite ? 0 : requestedRounds)
				usedFallback = true
			}
		}
		app.finishSession(result.summary)
		if (autoCreated) this.finishRecord(characterId, { guess: lastGuess, summary: result.summary, autoNamed })
		// 页面驱动还差几局：刷新页面重新 POST /game 开下一局，由「待运行」机制续跑。
		// 自动新建的角色只跑一局（跑完即成型），内置 HTTP 会话则一次跑完，都不需要续跑。
		const remaining = requestedRounds - 1
		const shouldContinue = provider !== 'api' && !usedFallback && !autoCreated && !result.stopped
			&& !(stopOnWin && result.summary.wins > 0) && (infinite || remaining > 0)
		if (shouldContinue) {
			await app.saveNow().catch(() => undefined)
			enterGamePage(
				{ ...overrides, mode, characterId, rounds: infinite ? 0 : remaining },
				{ sid: app.settings.sid ?? SID.character, childMode: !!app.settings.childMode },
			)
		} else if (queueDriven && app.playlist.active && !result.stopped)
			await this.#continuePlaylist()
		return result.summary
	}

	/**
	 * 歌单播放：从当前曲目（或第一首）开始挂机播放。
	 * @returns {Promise<void>} 完成
	 */
	async playPlaylist() {
		const { app } = this
		if (!app.playlist.ids.length) throw new Error(geti18n('playlist.empty'))
		const startId = app.playlist.ids.includes(app.playlist.currentId) ? app.playlist.currentId : app.playlist.ids[0]
		app.updatePlaylist({ active: true, currentId: startId })
		await this.startRun({ mode: 'replay', characterId: startId, rounds: 1, queue: true })
	}

	/**
	 * 页面加载后接着播放歌单（当前曲目已在歌单状态里，直接从它续播）。
	 *
	 * 歌单续播原本只靠「待运行」参数跨刷新：参数一旦被消费或超过 TTL（页面在后台被节流 /
	 * 延迟跳转、用户手动刷新时都会发生）就会失效，留下「歌单仍标记为播放中、唱片还在转，
	 * 但引擎已经停了」的状态。只要歌单仍标记为播放中，加载后就该把它拉回正轨。
	 * @returns {Promise<boolean>} 是否已开始续播
	 */
	async resumePlaylist() {
		const { app } = this
		if (this.engine || !app.playlist.active || !app.playlist.ids.length) return false
		const id = app.playlist.ids.includes(app.playlist.currentId) ? app.playlist.currentId : app.playlist.ids[0]
		if (app.playlist.currentId !== id) app.updatePlaylist({ currentId: id })
		await this.startRun({ mode: 'replay', characterId: id, rounds: 1, queue: true })
		return true
	}

	/**
	 * 播放歌单里的某个角色（点击曲目 / 切歌）。
	 * @param {string} id 角色 id
	 * @returns {Promise<void>} 完成
	 */
	async playTrack(id) {
		const { app } = this
		if (!id || !app.store.getCharacter(id)) return
		app.updatePlaylist({ active: true, currentId: id })
		await this.startRun({ mode: 'replay', characterId: id, rounds: 1, queue: true })
	}

	/**
	 * 切歌：按方向播放歌单里相邻 / 随机的曲目。
	 * @param {number} direction 1=下一首，-1=上一首
	 * @returns {Promise<void>} 完成
	 */
	async stepTrack(direction) {
		const id = nextTrackId(this.app.playlist, { direction })
		if (id) await this.playTrack(id)
	}

	/**
	 * 停止歌单挂机播放。
	 * @returns {void} 无
	 */
	stopPlaylist() {
		this.app.updatePlaylist({ active: false })
		this.stopRun()
	}

	/**
	 * 一首跑完后续播下一首。
	 *
	 * 页面驱动下 akinator 每局结束后页面处于终态，必须重新 `POST /game` 开新局，
	 * 因此这里把「下一首」写进歌单后跳游戏页，由「待运行」机制在刷新后续播（见 navigation.mjs）。
	 * @returns {Promise<void>} 完成
	 */
	async #continuePlaylist() {
		const { app } = this
		const nextId = nextTrackId(app.playlist, { auto: true })
		if (!nextId) {
			app.updatePlaylist({ active: false })
			return
		}
		app.updatePlaylist({ currentId: nextId })
		await app.saveNow().catch(() => undefined)
		enterGamePage(
			{ mode: 'replay', characterId: nextId, rounds: 1, queue: true },
			{ sid: app.settings.sid ?? SID.character, childMode: !!app.settings.childMode },
		)
	}

	/**
	 * 停止运行。
	 * @returns {void}
	 */
	stopRun() {
		if (this.engine) this.engine.stop()
		this.#finishDelay(null)
		this.provideAnswer(null)
		this.provideProposal(null)
	}

	/**
	 * UI / 站点提交候选选择。
	 * @param {Aki.ProposalDecision | null} decision 决定，null 表示中止
	 * @returns {void}
	 */
	provideProposal(decision) {
		this.#markUserAction()
		if (this.delay?.kind === 'proposal') {
			this.#finishDelay(decision ? { ...decision, manual: true } : null)
			return
		}
		const resolve = this.pendingProposal
		this.pendingProposal = undefined
		if (resolve) resolve(decision)
	}

	/**
	 * 提交手动作答。
	 * @param {number | null} answer 答案索引，null 中止
	 * @returns {void}
	 */
	provideAnswer(answer) {
		this.#markUserAction()
		if (this.delay?.kind === 'answer') {
			this.#interruptAnswer(answer)
			return
		}
		const resolve = this.pendingAnswer
		this.pendingAnswer = undefined
		if (resolve) resolve(answer)
		this.engine?.provideAnswer(answer)
	}

	/**
	 * UI 选择「纠正错误回答」或「追加概率」。
	 * @param {Aki.AnswerTreatment} treatment 处理方式
	 * @returns {void} 无
	 */
	resolveIntervention(treatment) {
		this.#markUserAction()
		const resolve = this.pendingIntervention
		this.pendingIntervention = undefined
		if (resolve) resolve(treatment === 'correct' ? 'correct' : 'append')
	}

	/**
	 * 收尾一次「边录边建」的运行：用 akinator 的猜测回填角色，并广播结果。
	 *
	 * 若一个字都没录到（例如刚开始就被中止），直接丢弃这个占位角色。
	 * 只有自动命名的角色才会被猜测名覆盖，用户手填的名字保持原样。
	 * @param {string} characterId 角色 id
	 * @param {{ guess: Aki.Guess | undefined; summary: { rounds: number; wins: number; losses: number }; autoNamed: boolean }} result 结果
	 * @returns {void} 无
	 */
	finishRecord(characterId, result) {
		const { app } = this
		const character = app.store.getCharacter(characterId)
		if (!character) return
		const questions = Object.keys(character.answers).length
		if (questions === 0) {
			app.store.removeCharacter(characterId)
			app.emit('created', { id: characterId, discarded: true, questions: 0, summary: result.summary })
			return
		}
		const guessedName = (result.guess?.name ?? '').trim()
		/** @type {Partial<Aki.Character>} */
		const patch = {}
		if (result.autoNamed && guessedName && guessedName !== character.name) {
			patch.name = guessedName
			if (character.name && !character.aliases.includes(character.name)) patch.aliases = [...character.aliases, character.name]
		}
		if (!character.image && result.guess?.photo) patch.image = result.guess.photo
		if (!character.description && result.guess?.description) patch.description = result.guess.description
		const updated = Object.keys(patch).length ? app.store.updateCharacter(characterId, patch) ?? character : character
		// 录到的其实就是题库里已有的同一个角色：把这次录制的结果并进现有角色，丢掉占位角色。
		const duplicate = app.store.findDuplicate(updated)
		if (duplicate) {
			const merged = app.store.mergeCharacter(duplicate.id, updated)
			app.store.removeCharacter(characterId)
			if (merged) {
				app.pushLog({
					time: now(),
					level: 'success',
					message: geti18n('logs.characterMerged', { name: merged.name, count: Object.keys(merged.answers).length }),
				})
				app.emit('created', {
					id: merged.id,
					name: merged.name,
					image: merged.image,
					questions: Object.keys(merged.answers).length,
					guessed: !!guessedName,
					merged: true,
					guess: result.guess ?? null,
					summary: result.summary,
				})
			}
			return
		}
		app.emit('created', {
			id: characterId,
			name: updated.name,
			image: updated.image,
			questions: Object.keys(updated.answers).length,
			guessed: !!guessedName,
			guess: result.guess ?? null,
			summary: result.summary,
		})
	}

	/**
	 * 命中时用 akinator 的最新资料同步本地角色（名称 / 描述 / 图片），不同才覆盖并记日志。
	 * @param {string} characterId 角色 id
	 * @param {Aki.Guess} guess akinator 的猜测
	 * @returns {void} 无
	 */
	#syncGuessMetadata(characterId, guess) {
		const { app } = this
		const fields = app.store.syncFromGuess(characterId, guess)
		if (!fields.length) return
		const labels = fields.map((field) => geti18n(`characters.${field}`)).join(', ')
		const name = app.store.getCharacter(characterId)?.name ?? guess.name
		app.pushLog({ time: now(), level: 'success', message: geti18n('logs.metadataSynced', { name, fields: labels }) })
	}

	/**
	 * 即时创建一个录制目标占位角色。
	 * @param {Partial<Aki.Character>} [draft] 预填字段
	 * @returns {{ character: Aki.Character; generated: boolean }} 角色与是否自动命名
	 */
	#createRecordTarget(draft = {}) {
		const name = String(draft.name ?? '').trim()
		const character = this.app.store.addCharacter({
			...draft,
			name: name || autoCharacterName(),
			region: draft.region ?? this.app.currentRegion(),
			sid: draft.sid ?? this.app.settings.sid ?? SID.character,
		})
		this.app.pushLog({ time: now(), level: 'info', message: geti18n('logs.recordStarted', { name: character.name }) })
		return { character, generated: !name }
	}

	/**
	 * 决定候选选择：有匹配则自动选，否则按设置询问用户。
	 * @param {string} characterId 角色 id
	 * @param {Aki.Proposal} proposal 候选
	 * @param {Aki.Guess | undefined} suggested 命中的候选
	 * @param {Aki.RunMode} mode 本次运行的模式（录制时必定询问）
	 * @returns {Promise<Aki.ProposalDecision | null>} 决定
	 */
	async #decideProposal(characterId, proposal, suggested, mode) {
		const { app } = this
		const {policy} = app.store.getChoice(characterId)
		if (suggested && policy !== 'exclude') {
			app.pushLog({ time: now(), level: 'info', message: geti18n('logs.proposalHit', { name: suggested.name }) })
			return { action: 'pick', pickId: suggested.id, manual: false }
		}
		const shouldAsk = app.settings.askProposal || mode === 'record'
		if (shouldAsk) {
			// 录制时用户本就在盯着页面作答，响铃 / 桌面通知只会打扰；只有回放（无人值守）才提醒，
			// 且要等用户静默满期（见 #scheduleBell）再响，免得刚答完上一题就被催。
			if (mode !== 'record') this.#scheduleBell(geti18n('bell.proposalTitle'), geti18n('bell.proposalBody', { count: proposal.candidates.length }))
			return await new Promise((resolve) => {
				this.pendingProposal = resolve
				app.emit('proposal', { proposal, suggested })
			})
		}
		return { action: 'exclude', manual: false }
	}

	/**
	 * 用户在倒计时期间点了某个答案。
	 *
	 * 与自动选择一致就直接提交；不一致则暂停计时并询问这是「纠正错误回答（清空该题概览）」
	 * 还是「追加概率（只加一次计数）」（见 {@link RunController#resolveIntervention}）。
	 * @param {number | null} answer 答案索引，null 表示中止
	 * @returns {Promise<void>} 完成
	 */
	async #interruptAnswer(answer) {
		const {delay} = this
		if (!delay) return
		if (this.delayTimer !== undefined) {
			clearTimeout(this.delayTimer)
			this.delayTimer = undefined
		}
		if (answer === null || answer === delay.answer) {
			this.#finishDelay(answer === null ? null : { answer })
			return
		}
		const treatment = await new Promise((resolve) => {
			this.pendingIntervention = resolve
			this.intervention = { original: delay.answer ?? 2, clicked: answer, question: delay.question }
			this.app.emit('intervention', this.intervention)
		})
		this.intervention = undefined
		this.app.emit('interventionEnd')
		this.#finishDelay({ answer, treatment })
	}

	/**
	 * 开始一次自动决策前的类人延时，并广播倒计时。
	 * @param {Aki.DelayContext} context 延时上下文
	 * @returns {Promise<Aki.DelayOutcome | null>} 覆盖决定（null 表示照常提交）
	 */
	#awaitDelay(context) {
		/** @type {Aki.DelayState} */
		const state = {
			kind: context.kind,
			durationMs: context.durationMs,
			startedAt: now(),
			answer: context.kind === 'answer' ? context.answer : undefined,
			question: context.kind === 'answer' ? context.question : undefined,
			proposal: context.kind === 'proposal' ? context.proposal : undefined,
			suggested: context.kind === 'proposal' ? context.suggested : undefined,
		}
		return new Promise((resolve) => {
			this.pendingDelay = resolve
			this.delay = state
			// 先挂定时器再广播：监听器里同步抢答时才能正确把它清掉（否则会后补一个空转的定时器）。
			this.delayTimer = setTimeout(() => this.#finishDelay(null), context.durationMs)
			this.app.emit('delay', state)
		})
	}

	/**
	 * 结束当前延时（正常到期、被改选或中止）。
	 * @param {Aki.DelayOutcome | null} outcome 覆盖决定
	 * @returns {void} 无
	 */
	#finishDelay(outcome) {
		if (this.delayTimer !== undefined) {
			clearTimeout(this.delayTimer)
			this.delayTimer = undefined
		}
		const resolve = this.pendingDelay
		this.pendingDelay = undefined
		// 正在等「纠正 / 追加」时被中止：一并解开，别留下永远不落地的 Promise。
		const resolveIntervention = this.pendingIntervention
		this.pendingIntervention = undefined
		const hadDelay = !!this.delay
		this.delay = undefined
		this.intervention = undefined
		if (hadDelay) this.app.emit('delayEnd')
		if (resolveIntervention) resolveIntervention('append')
		if (resolve) resolve(outcome)
	}

	/**
	 * 请求用户作答，返回 Promise。
	 * @param {'record' | 'unknown'} reason 原因
	 * @param {Aki.Question} question 问题
	 * @param {Aki.AnswerRecord | undefined} recorded 已有记录
	 * @returns {Promise<number | null>} 答案索引
	 */
	async #requestAnswer(reason, question, recorded) {
		if (reason === 'unknown') this.#scheduleBell(geti18n('bell.unknownTitle'), question.text)
		return await new Promise((resolve) => {
			this.pendingAnswer = resolve
			this.app.emit('ask', { reason, question, recorded })
		})
	}

	/**
	 * 记下用户刚做了一次操作（作答 / 选候选），并取消尚未触发的提醒。
	 * @returns {void} 无
	 */
	#markUserAction() {
		this.lastUserActionAt = now()
		this.#cancelBell()
	}

	/**
	 * 取消尚未触发的提醒，并停止正在响的铃。
	 * @returns {void} 无
	 */
	#cancelBell() {
		if (this.bellTimer !== undefined) {
			clearTimeout(this.bellTimer)
			this.bellTimer = undefined
		}
		stopBell()
	}

	/**
	 * 当用户从上次操作起静默满 `bellDelayMs` 且当前仍需要操作时才响铃 / 通知；
	 * 若用户刚操作过则顺延到静默满期，静默期内的多次操作会不断把它向后推。
	 * @param {string} title 标题
	 * @param {string} body 内容
	 * @returns {void} 无
	 */
	#scheduleBell(title, body) {
		this.#cancelBell()
		const { settings } = this.app
		if (!settings.bellEnabled) return
		const delay = Math.max(0, Number(settings.bellDelayMs ?? 0))
		const remaining = Math.max(0, delay - (now() - this.lastUserActionAt))
		this.bellTimer = setTimeout(() => {
			this.bellTimer = undefined
			ringBell(title, body)
		}, remaining)
	}
}

/**
 * 归一化底层提供商取值。
 * @param {unknown} value 原始值
 * @returns {'auto' | 'page' | 'api'} 提供商（非法值退回 auto）
 */
function normalizeProvider(value) {
	if (value === 'page' || value === 'api') return value
	return 'auto'
}

/**
 * 为「边录边建」的占位角色生成一个带时间戳的默认名。
 * @returns {string} 默认名
 */
function autoCharacterName() {
	const date = new Date()
	const time = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
	return geti18n('run.autoName', { time })
}

/**
 * 把数字补零到两位。
 * @param {number} value 数值
 * @returns {string} 两位字符串
 */
function pad2(value) {
	return String(value).padStart(2, '0')
}
