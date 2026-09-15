/**
 * akinator 游戏页面接管。
 *
 * 引擎**不再自己开会话**，而是由 {@link module:userscript/page_client} 点击页面上的
 * 作答按钮、读回 DOM：akinator 页面自身的 JS 负责发请求、驱动精灵与进度。这里只做两件事：
 *
 * - 把**真人**在页面上的点击翻译成引擎动作（录制 / 补题时的作答、候选阶段的选择）；
 * - 在引擎「自己拿主意」的倒计时与「纠正 / 追加」询问时，在页面上浮一层 UI。
 *
 * 脚本自己合成的点击（`event.isTrusted === false`）一律放行，交给 akinator 页面自身处理。
 * 非游戏页（首页 / 主题选择页）静默退出，保持原有行为。
 * @module userscript/page
 */

import { ANSWER_I18N_KEYS } from '../shared/constants.mjs'
import { icon } from '../shared/icons.mjs'
import { templatesFromSources } from '../shared/template.mjs'
import { applyTheme } from '../shared/theme.mjs'

import { geti18n } from './i18n.mjs'
import { isGamePage } from './navigation.mjs'
import styleText from './style.css'
import views from './views/index.mjs'

/** 渲染 API（模板在构建期由 esbuild text loader 内联）。 */
const templates = templatesFromSources(views)

/**
 * 把 akinator 游戏页的真人操作接到运行引擎上。
 */
export class PageMirror {
	/**
	 * @param {import('./app/index.mjs').App} app 应用
	 */
	constructor(app) {
		/** @type {import('./app/index.mjs').App} */
		this.app = app
		/** 引擎是否正在运行（运行期间页面的真人点击归引擎管）。 */
		this.running = false
		/** 是否正在等待用户作答（录制 / 补题）。 */
		this.awaitingAnswer = false
		/** 是否正在等待候选选择。 */
		this.awaitingProposal = false
		/** 自动作答倒计时期间，页面按钮可以「抢答」。 */
		this.interruptible = false
		/** @type {Aki.DelayState | undefined} 当前倒计时。 */
		this.delay = undefined
		/** @type {Aki.InterventionState | undefined} 当前等待「纠正 / 追加」的改选。 */
		this.intervention = undefined
		/** 页面上点「是」时应选中的候选 id。 */
		this.pickId = undefined
		/** @type {HTMLElement | undefined} 倒计时浮层宿主。 */
		this.host = undefined
		/** @type {ShadowRoot | undefined} */
		this.shadow = undefined
		/** @type {HTMLElement | undefined} */
		this.slot = undefined
		this.onClick = this.onClick.bind(this)
		this.onOverlayClick = this.onOverlayClick.bind(this)
	}

	/**
	 * 当前页面是否为 akinator 的游戏页。
	 * @returns {boolean} 是否可接管
	 */
	static available() {
		return isGamePage()
	}

	/**
	 * 挂载接管；非游戏页直接返回。
	 * @returns {void} 无
	 */
	mount() {
		if (!PageMirror.available()) return
		document.addEventListener('click', this.onClick, true)
		this.app.on('state', (state) => this.renderState(state))
		this.app.on('ask', (payload) => this.renderAsk(payload))
		this.app.on('proposal', (payload) => this.renderProposal(payload.proposal, payload.suggested))
		this.app.on('delay', (delay) => this.renderDelay(delay))
		this.app.on('delayEnd', () => this.clearDelay())
		this.app.on('intervention', (state) => this.renderIntervention(state))
		this.app.on('interventionEnd', () => this.clearIntervention())
	}

	/**
	 * 捕获阶段接管页面上的**真人**作答 / 候选点击，翻译成引擎动作。
	 *
	 * 这里会拦下真人点击、不让 akinator 页面自己提交：随后引擎会通过页面驱动的客户端
	 * 再合成一次点击，由 akinator 页面自身发出**唯一**一次请求（避免同一题提交两次）。
	 * @param {MouseEvent} event 点击事件
	 * @returns {void} 无
	 */
	onClick(event) {
		// 只接管真人点击；脚本自己派发的合成点击要放行给 akinator 页面自身的处理逻辑。
		if (!event.isTrusted) return
		if (!(event.target instanceof Element)) return
		const answer = event.target.closest('#questionGameBlock .li-game[data-index]')
		if (answer && this.running) {
			event.preventDefault()
			event.stopImmediatePropagation()
			if (!this.awaitingAnswer && !this.interruptible) return
			this.awaitingAnswer = false
			this.interruptible = false
			const index = Number(answer.getAttribute('data-index'))
			if (Number.isFinite(index)) this.app.provideAnswer(index)
			return
		}
		const decision = event.target.closest('#a_propose_yes, #a_propose_no')
		if (decision && this.awaitingProposal) {
			event.preventDefault()
			event.stopImmediatePropagation()
			this.#resolveProposal(decision.id === 'a_propose_yes')
		}
	}

	/**
	 * 运行状态变化时同步接管的开关。
	 * @param {Aki.RunState} state 状态快照
	 * @returns {void} 无
	 */
	renderState(state) {
		this.running = !!state.running
		if (!state.running) {
			this.awaitingAnswer = false
			this.awaitingProposal = false
			this.interruptible = false
		}
	}

	/**
	 * 需要用户作答时标记等待状态（问题本身由 akinator 页面渲染）。
	 * @param {{ question: Aki.Question }} payload 载荷
	 * @returns {void} 无
	 */
	renderAsk(payload) {
		this.awaitingAnswer = true
		this.awaitingProposal = false
	}

	/**
	 * 候选阶段：记下当前候选，等待页面上的「是 / 否」（候选本身由 akinator 页面渲染）。
	 * @param {Aki.Proposal} proposal 候选
	 * @param {Aki.Guess | undefined} suggested 命中候选
	 * @returns {void} 无
	 */
	renderProposal(proposal, suggested) {
		const candidate = suggested ?? proposal.candidates[0]
		this.pickId = candidate?.id
		this.awaitingProposal = !!candidate
	}

	/**
	 * 开始倒计时：浮出进度条，并让页面按钮可抢答。
	 * @param {Aki.DelayState} delay 延时状态
	 * @returns {void} 无
	 */
	renderDelay(delay) {
		this.delay = delay
		this.interruptible = delay.kind === 'answer'
		if (delay.kind === 'proposal' && delay.proposal) {
			this.awaitingAnswer = false
			this.renderProposal(delay.proposal, delay.suggested)
		}
		this.#renderOverlay()
	}

	/**
	 * 倒计时结束：撤掉进度条。
	 * @returns {void} 无
	 */
	clearDelay() {
		this.delay = undefined
		this.interruptible = false
		this.awaitingProposal = false
		this.#renderOverlay()
	}

	/**
	 * 用户在倒计时期间改选，浮出「纠正 / 追加」询问。
	 * @param {Aki.InterventionState} state 改选状态
	 * @returns {void} 无
	 */
	renderIntervention(state) {
		this.intervention = state
		this.#renderOverlay()
	}

	/**
	 * 撤掉「纠正 / 追加」询问。
	 * @returns {void} 无
	 */
	clearIntervention() {
		this.intervention = undefined
		this.#renderOverlay()
	}

	/**
	 * 处理倒计时浮层上的按钮。
	 * @param {Event} event 事件
	 * @returns {void} 无
	 */
	onOverlayClick(event) {
		if (!(event.target instanceof Element)) return
		const button = event.target.closest('[data-action="intervene"]')
		if (!button) return
		event.preventDefault()
		this.app.resolveIntervention(button.getAttribute('data-id') === 'correct' ? 'correct' : 'append')
	}

	/**
	 * 渲染倒计时 / 改选浮层（内容为空时清空宿主）。
	 * @returns {Promise<void>} 完成
	 */
	async #renderOverlay() {
		if (!this.delay && !this.intervention) {
			this.slot?.replaceChildren()
			return
		}
		this.#ensureHost()
		if (!this.slot) return
		const labels = ANSWER_I18N_KEYS.map((key) => geti18n(key))
		const parts = []
		if (this.delay) parts.push(await templates.renderTemplateAsHtmlString('delay', {
			durationMs: Math.max(0, Math.round(this.delay.durationMs)),
			label: geti18n(this.delay.kind === 'answer' ? 'run.delayAnswer' : 'run.delayProposal', { answer: labels[this.delay.answer ?? 2] ?? '' }),
			icon: icon('clock', { size: 15 }),
			candidates: '',
		}))
		if (this.intervention) parts.push(await templates.renderTemplateAsHtmlString('intervention', {
			icon: icon('alert', { size: 15 }),
			title: geti18n('run.interveneTitle', { answer: labels[this.intervention.clicked] ?? '', original: labels[this.intervention.original] ?? '' }),
		}))
		this.slot.innerHTML = parts.join('')
	}

	/**
	 * 懒创建倒计时浮层宿主（独立 Shadow DOM，避免被 akinator 的样式污染）。
	 * @returns {void} 无
	 */
	#ensureHost() {
		if (this.host) return
		const host = document.createElement('div')
		host.id = 'akinator-auto-runner-delay'
		host.style.cssText = 'all:initial;position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:2147483640;width:min(380px,calc(100vw - 32px));'
		const shadow = host.attachShadow({ mode: 'open' })
		const style = document.createElement('style')
		style.textContent = styleText
		shadow.appendChild(style)
		const slot = document.createElement('div')
		shadow.appendChild(slot)
		shadow.addEventListener('click', this.onOverlayClick)
		applyTheme(this.app.settings.theme, host)
		document.documentElement.appendChild(host)
		this.host = host
		this.shadow = shadow
		this.slot = slot
	}

	/**
	 * 把页面上的候选选择回传给引擎。
	 * @param {boolean} accepted 是否点的是「是」
	 * @returns {void} 无
	 */
	#resolveProposal(accepted) {
		const pickId = this.pickId
		this.awaitingProposal = false
		if (accepted)
			this.app.provideProposal({ action: 'pick', pickId, manual: true })
		else
			this.app.provideProposal({ action: 'exclude', manual: true })
	}
}
