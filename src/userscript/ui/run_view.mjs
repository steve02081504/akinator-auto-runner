/**
 * 运行标签页的模板数据。
 * @module userscript/ui/run_view
 */

import { ANSWER_I18N_KEYS } from '../../shared/constants.mjs'
import { icon } from '../../shared/icons.mjs'
import { formatTimestamp } from '../../shared/report.mjs'
import { answerWeights } from '../../shared/schema.mjs'
import { geti18n } from '../i18n.mjs'

import { distributionBars, templates } from './templates.mjs'

/**
 * 运行标签页里随每步变化的部分（问题卡、候选、猜测、状态卡等）。
 *
 * 这些区块会被单独重渲染（见 {@link PanelUI#renderRunParts}），从而在不重建顶部控件、
 * 不丢失滚动位置的前提下随运行进度更新。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {Promise<object>} 数据
 */
export async function runPartsData(ui) {
	return {
		runStatus: await renderPart('run-status', runStatusData(ui)),
		session: await renderPart('session', sessionData(ui)),
		created: await renderPart('created', createdData(ui)),
		ask: await renderPart('ask', await askData(ui)),
		proposal: await renderPart('proposal', await proposalData(ui)),
		guess: await renderPart('guess', guessData(ui)),
		delay: await renderPart('delay', await delayData(ui)),
		intervention: await renderPart('intervention', interventionData(ui)),
	}
}

/**
 * 运行标签页数据。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {Promise<object>} 数据
 */
export async function runData(ui) {
	const {settings} = ui.app
	const state = ui.runState
	const recordActive = settings.mode === 'record'
	const selected = ui.selectedCharacterId ? ui.app.store.getCharacter(ui.selectedCharacterId) : undefined
	/** @type {object[]} */
	const optionItems = ui.app.store.listCharacters({}).map((character) => ({
		value: character.id,
		label: character.name,
		selected: character.id === ui.selectedCharacterId,
	}))
	// 录制模式也允许选定已有角色续录；用一条空值选项表示「新建角色」（此时才显示名字输入）。
	if (recordActive) optionItems.unshift({ value: '', label: geti18n('run.newCharacterOption'), selected: !selected })
	return {
		settings,
		recordActive,
		running: !!state?.running,
		recording: !!state?.running && recordActive,
		recordingLabel: geti18n('run.recording'),
		newName: ui.newName,
		newNamePlaceholder: geti18n('run.newCharacterPlaceholder'),
		nameVisible: recordActive && !selected,
		modeHint: geti18n(recordActive ? selected ? 'run.recordIntoHint' : 'run.newCharacterHint' : 'run.replayHint', { name: selected?.name ?? '' }),
		replayIcon: icon('play', { size: 14 }),
		recordIcon: icon('record', { size: 14 }),
		settingsIcon: icon('sliders', { size: 14 }),
		startIcon: icon(state?.running ? 'loader' : recordActive ? 'record' : 'play', { size: 14 }),
		startLabel: geti18n(recordActive ? 'run.startRecord' : 'run.startReplay'),
		startClass: recordActive ? 'aar-record' : '',
		stopIcon: icon('stop', { size: 14 }),
		options: await templates.renderListAsHtmlString('option', optionItems),
		parts: await templates.renderTemplateAsHtmlString('run-parts', await runPartsData(ui)),
	}
}

/**
 * 把子模板渲染成 HTML 片段（数据为 '' 时返回空串）。
 * @param {string} name 模板名
 * @param {object | ''} data 模板数据
 * @returns {Promise<string>} HTML
 */
async function renderPart(name, data) {
	if (!data) return ''
	return templates.renderTemplateAsHtmlString(name, data)
}

/**
 * 运行状态数据。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {object | ''} 数据
 */
function runStatusData(ui) {
	const state = ui.runState
	if (!state) return ''
	const progress = Math.round(state.progression || 0)
	const character = ui.app.store.getCharacter(state.characterId)
	return {
		progress,
		recording: state.mode === 'record',
		recordedLabel: character ? geti18n('run.recordedCount', { count: Object.keys(character.answers).length }) : '',
		roundLabel: geti18n('run.roundOf', { round: state.round, rounds: state.rounds || '∞' }),
		stepLabel: geti18n('run.step', { step: state.step }),
		winLabel: geti18n('run.winChip', { count: state.wins }),
		lossLabel: geti18n('run.lossChip', { count: state.losses }),
		progressLabel: geti18n('run.progress', { percent: progress }),
	}
}

/**
 * 「上次会话」卡数据（页面刷新 / 跳转后据此续跑）。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {object | ''} 数据
 */
function sessionData(ui) {
	if (ui.runState?.running || ui.created) return ''
	const session = ui.app.lastSession
	if (!session) return ''
	const character = ui.app.store.getCharacter(session.characterId)
	if (!character) return ''
	const interrupted = ui.app.sessionInterrupted
	return {
		characterId: session.characterId,
		interrupted,
		title: geti18n(interrupted ? 'run.sessionInterrupted' : 'run.sessionLast', { name: character.name }),
		info: geti18n('run.sessionInfo', {
			mode: geti18n(session.mode === 'record' ? 'run.record' : 'run.replay'),
			round: session.round,
			step: session.step,
			wins: session.wins,
			losses: session.losses,
			time: formatTimestamp(session.updatedAt),
		}),
		question: session.question ? geti18n('run.sessionQuestion', { text: session.question }) : '',
		badge: icon(interrupted ? 'alert' : 'clock', { size: 16 }),
		closeIcon: icon('x', { size: 14 }),
		resumeIcon: icon('play', { size: 14 }),
	}
}

/**
 * 新建角色结果卡数据。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {object | ''} 数据
 */
function createdData(ui) {
	const {created} = ui
	if (!created) return ''
	return {
		id: created.id,
		title: geti18n(created.merged ? 'run.mergedTitle' : 'run.createdTitle', { name: created.name ?? '' }),
		hint: geti18n(created.merged ? 'run.mergedHint' : 'run.createdHint', { count: created.questions }),
		photo: created.image ? `<img class="aar-avatar" src="${created.image}" alt="" loading="lazy">` : '',
		badge: icon('circle-check', { size: 17 }),
		closeIcon: icon('x', { size: 14 }),
	}
}

/**
 * 当前问题数据。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {Promise<object | ''>} 数据
 */
async function askData(ui) {
	const delay = ui.delay?.kind === 'answer' ? ui.delay : undefined
	const question = ui.askQuestion ?? delay?.question ?? ui.runState?.question
	if (!question) return ''
	const labels = ANSWER_I18N_KEYS.map((key) => geti18n(key))
	const answering = !!ui.askQuestion || !!delay
	return {
		text: question.text,
		answering,
		icon: icon(ui.askReason === 'unknown' ? 'alert' : 'wand', { size: 15 }),
		buttons: await templates.renderListAsHtmlString('answer-button', labels.map((label, index) => ({ index, label, answering }))),
		hint: ui.askReason === 'unknown' ? `<span class="aar-warn">${geti18n('run.missing')}</span>` : '',
		recorded: ui.askRecorded ? `<span class="aar-muted">${geti18n('run.recordedTimes', { answer: labels[ui.askRecorded.answer] ?? '', count: ui.askRecorded.count })}</span>` : '',
		distribution: await distributionData(ui, question),
	}
}

/**
 * 当前角色在某道题上的答案分布（用于录制 / 补题时显示「这题以前答过什么」）。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @param {Aki.Question} question 当前问题
 * @returns {Promise<string>} 分布 HTML（无记录时为空串）
 */
async function distributionData(ui, question) {
	const characterId = ui.runState?.characterId
	if (!characterId) return ''
	const record = ui.app.store.getAnswer(characterId, question.text)
	if (!record) return ''
	const weights = answerWeights(record)
	if (!weights.some((value) => value > 0)) return ''
	return distributionBars(weights)
}

/**
 * 候选选择数据。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {Promise<object | ''>} 数据
 */
async function proposalData(ui) {
	if (!ui.proposal) return ''
	const { proposal, suggested } = ui.proposal
	return {
		icon: icon('sparkles', { size: 14 }),
		candidates: await templates.renderListAsHtmlString('candidate', candidateItems(proposal, suggested)),
	}
}

/**
 * 候选列表的模板数据。
 * @param {Aki.Proposal} proposal 候选
 * @param {Aki.Guess | undefined} suggested 命中候选
 * @returns {object[]} 候选数据
 */
function candidateItems(proposal, suggested) {
	return proposal.candidates.slice(0, 24).map((candidate) => ({
		id: candidate.id,
		name: candidate.name,
		photo: candidate.photo,
		hit: suggested && candidate.id === suggested.id,
		placeholder: icon('image', { size: 15 }),
	}))
}

/**
 * 猜测结果数据。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {object | ''} 数据
 */
function guessData(ui) {
	const guess = ui.lastGuess
	if (!guess) return ''
	return {
		icon: icon('trophy', { size: 14 }),
		prediction: geti18n('run.guess', { name: guess.name }),
		photo: guess.photo ? `<img class="aar-photo" src="${guess.photo}" alt="">` : '',
		description: guess.description,
		confidence: guess.confidence === null ? '' : `<span>${geti18n('run.confidence', { percent: guess.confidence })}</span>`,
	}
}

/**
 * 倒计时卡数据（自动决策前的类人延时）。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {Promise<object | ''>} 数据
 */
async function delayData(ui) {
	const {delay} = ui
	if (!delay) return ''
	const labels = ANSWER_I18N_KEYS.map((key) => geti18n(key))
	return {
		durationMs: Math.max(0, Math.round(delay.durationMs)),
		label: geti18n(delay.kind === 'answer' ? 'run.delayAnswer' : 'run.delayProposal', { answer: labels[delay.answer ?? 2] ?? '' }),
		icon: icon('clock', { size: 15 }),
		candidates: delay.kind === 'proposal' && delay.proposal
			? await templates.renderListAsHtmlString('candidate', candidateItems(delay.proposal, delay.suggested))
			: '',
	}
}

/**
 * 改选确认卡数据（纠正错误回答 / 追加概率）。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {object | ''} 数据
 */
function interventionData(ui) {
	const {intervention} = ui
	if (!intervention) return ''
	const labels = ANSWER_I18N_KEYS.map((key) => geti18n(key))
	return {
		icon: icon('alert', { size: 15 }),
		title: geti18n('run.interveneTitle', { answer: labels[intervention.clicked] ?? '', original: labels[intervention.original] ?? '' }),
	}
}
