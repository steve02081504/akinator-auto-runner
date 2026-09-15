/**
 * 角色标签页与角色编辑器的模板数据。
 * @module userscript/ui/characters_view
 */

import { ANSWER_I18N_KEYS, SID } from '../../shared/constants.mjs'
import { icon } from '../../shared/icons.mjs'
import { answerWeights } from '../../shared/schema.mjs'
import { geti18n } from '../i18n.mjs'

import { templates } from './templates.mjs'

/** 编辑器题目列表每批渲染的行数。 */
const CHUNK_SIZE = 20

/**
 * 角色列表数据。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {Promise<object>} 数据
 */
export async function charactersData(ui) {
	const characters = ui.app.store.listCharacters({ query: ui.query })
	const cards = characters.length
		? await templates.renderListAsHtmlString('character-card', await Promise.all(characters.map(async (character) => {
			const inPlaylist = ui.app.isInPlaylist(character.id)
			return {
				id: character.id,
				image: character.image
					? `<img class="aar-avatar" src="${character.image}" alt="" loading="lazy">`
					: `<span class="aar-avatar aar-avatar-empty">${icon('image', { size: 18 })}</span>`,
				name: character.name,
				region: character.region,
				questionCount: geti18n('characters.questionCount', { count: Object.keys(character.answers).length }),
				devotionLabel: geti18n('devotion.label'),
				devotionIcon: icon('flame', { size: 12 }),
				devotionSummary: devotionSummary(ui, character.id),
				runIcon: icon('play', { size: 13 }),
				editIcon: icon('pencil', { size: 13 }),
				exportIcon: icon('download', { size: 13 }),
				deleteIcon: icon('trash', { size: 13 }),
				inPlaylist,
				playlistIcon: icon(inPlaylist ? 'circle-check' : 'list-music', { size: 13 }),
				playlistTitleKey: inPlaylist ? 'playlist.removeFrom' : 'playlist.addTo',
				tags: await templates.renderListAsHtmlString('tag', character.tags.map((text) => ({ text }))),
			}
		})))
		: await templates.renderListAsHtmlString('message', [{ text: geti18n('characters.none'), icon: icon('sparkles', { size: 26 }) }])
	return {
		query: ui.query,
		searchPlaceholder: geti18n('characters.search'),
		searchIcon: icon('search', { size: 14 }),
		addIcon: icon('plus', { size: 14 }),
		countLabel: geti18n('characters.count', { count: characters.length }),
		cards,
	}
}

/**
 * 角色编辑器数据。
 *
 * 角色的每道题都带一组可编辑的回答概率（权重），因此题目列表只在这里出现。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {Promise<object>} 数据
 */
export async function editorData(ui) {
	const draft = ui.editing?.draft ?? {}
	ui.editorQueue = Object.entries(draft.answers ?? {}).map(([key, record]) => ({ key, record }))
		.sort((a, b) => String(a.record.question).localeCompare(String(b.record.question)))
	ui.editorRendered = 0
	const initial = await renderEditorChunk(ui)
	return {
		isNew: !ui.editing?.id,
		name: draft.name ?? '',
		aliases: (draft.aliases ?? []).join(', '),
		description: draft.description ?? '',
		image: draft.image ?? '',
		tags: (draft.tags ?? []).join(', '),
		region: draft.region ?? ui.app.currentRegion(),
		sid: draft.sid ?? SID.character,
		questionCount: geti18n('characters.questionCount', { count: ui.editorQueue.length }),
		questionsHint: geti18n('characters.questionsHint'),
		questions: initial.rows || await templates.renderListAsHtmlString('message', [{ text: geti18n('characters.noQuestions'), icon: icon('list', { size: 22 }) }]),
		more: initial.done ? '' : '<div class="aar-list-more" data-role="editor-question-more" data-i18n="characters.questionsMore"></div>',
		icon: icon('pencil', { size: 15 }),
		closeIcon: icon('x', { size: 14 }),
		uploadIcon: icon('upload', { size: 13 }),
		saveIcon: icon('save', { size: 13 }),
	}
}

/**
 * 从虚拟队列里取出下一批编辑器题目行渲染成 HTML。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {Promise<{ rows: string; done: boolean }>} 行 HTML 与是否已渲染完
 */
export async function renderEditorChunk(ui) {
	const chunk = ui.editorQueue.slice(ui.editorRendered, ui.editorRendered + CHUNK_SIZE)
	ui.editorRendered += chunk.length
	const rows = await Promise.all(chunk.map(async ({ key, record }) => ({
		key,
		text: record.question || key,
		rows: await templates.renderListAsHtmlString('weight-row', weightItems(key, record)),
	})))
	return {
		rows: rows.length ? await templates.renderListAsHtmlString('question-weights', rows) : '',
		done: ui.editorRendered >= ui.editorQueue.length,
	}
}

/**
 * 单道题五个回答控件的模板数据。
 * @param {string} key 问题键
 * @param {Aki.AnswerRecord} record 答案记录
 * @returns {object[]} 控件数据
 */
function weightItems(key, record) {
	const weights = answerWeights(record)
	const total = weights.reduce((sum, value) => sum + value, 0)
	return ANSWER_I18N_KEYS.map((i18nKey, index) => ({
		key,
		index,
		label: geti18n(i18nKey),
		value: weights[index],
		percent: total ? Math.round(weights[index] / total * 100) : 0,
	}))
}

/**
 * 厨力摘要文本。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @param {string} characterId 角色 id
 * @returns {string} 文案
 */
function devotionSummary(ui, characterId) {
	const devotion = ui.app.getDevotion(characterId)
	return geti18n('devotion.summary', {
		score: devotion.score,
		answers: devotion.answers,
		contributed: devotion.contributed,
		avgLength: Math.round(devotion.recentAvgLength),
		activeDays: devotion.activeDays,
	})
}
