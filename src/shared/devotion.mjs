/**
 * 本机「厨力」统计：只在本地保存，不进入题库数据，用于展示用户的投入程度。
 * @module shared/devotion
 */

import { asArray, asRecord } from './util.mjs'

const RECENT_LIMIT = 200

/**
 * 生成日期键（YYYY-MM-DD）。
 * @param {number} [timestamp] 时间戳
 * @returns {string} 日期键
 */
function dayKey(timestamp = Date.now()) {
	const date = new Date(timestamp)
	const month = String(date.getMonth() + 1).padStart(2, '0')
	const day = String(date.getDate()).padStart(2, '0')
	return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 创建一个空的厨力统计。
 * @returns {Aki.Devotion} 空统计
 */
export function emptyDevotion() {
	return {
		characters: {},
		totals: { answers: 0, contributed: 0, sessions: 0, wins: 0, losses: 0, firstAt: 0, lastAt: 0, activeDays: [] },
	}
}

/**
 * 归一化一个可能来自存储的厨力对象。
 * @param {unknown} value 输入
 * @returns {Aki.Devotion} 统计
 */
export function ensureDevotion(value) {
	const empty = emptyDevotion()
	if (!value || typeof value !== 'object') return empty
	const raw = asRecord(value)
	for (const [id, record] of Object.entries(asRecord(raw.characters))) empty.characters[id] = normalizeRecord(record)
	const totals = asRecord(raw.totals)
	empty.totals = {
		...empty.totals,
		answers: Number(totals.answers) || 0,
		contributed: Number(totals.contributed) || 0,
		sessions: Number(totals.sessions) || 0,
		wins: Number(totals.wins) || 0,
		losses: Number(totals.losses) || 0,
		firstAt: Number(totals.firstAt) || 0,
		lastAt: Number(totals.lastAt) || 0,
		activeDays: asArray(totals.activeDays).map(String),
	}
	return empty
}

/**
 * 归一化单条记录。
 * @param {unknown} record 原始记录
 * @returns {Aki.DevotionRecord} 记录
 */
function normalizeRecord(record) {
	const source = asRecord(record)
	return {
		answers: Number(source.answers) || 0,
		contributed: Number(source.contributed) || 0,
		sessions: Number(source.sessions) || 0,
		wins: Number(source.wins) || 0,
		losses: Number(source.losses) || 0,
		totalQuestionChars: Number(source.totalQuestionChars) || 0,
		recentLengths: asArray(source.recentLengths).map(Number).slice(-RECENT_LIMIT),
		firstAt: Number(source.firstAt) || 0,
		lastAt: Number(source.lastAt) || 0,
		activeDays: [...new Set(asArray(source.activeDays).map(String))],
	}
}

/**
 * 取得（或创建）某角色的统计。
 * @param {Aki.Devotion} devotion 统计
 * @param {string} id 角色 id
 * @returns {Aki.DevotionRecord} 记录
 */
export function devotionFor(devotion, id) {
	let record = devotion.characters[id]
	if (!record) {
		record = normalizeRecord({})
		devotion.characters[id] = record
	}
	return record
}

/**
 * 记录一次作答。
 * @param {Aki.Devotion} devotion 统计
 * @param {string} id 角色 id
 * @param {{ length: number; added: boolean }} info 信息
 * @returns {void}
 */
export function recordAnswer(devotion, id, info) {
	const record = devotionFor(devotion, id)
	const timestamp = Date.now()
	const day = dayKey(timestamp)
	if (!record.firstAt) record.firstAt = timestamp
	record.lastAt = timestamp
	record.answers += 1
	record.totalQuestionChars += info.length
	record.recentLengths.push(info.length)
	if (record.recentLengths.length > RECENT_LIMIT) record.recentLengths = record.recentLengths.slice(-RECENT_LIMIT)
	if (info.added) record.contributed += 1
	addDay(record.activeDays, day)
	const {totals} = devotion
	if (!totals.firstAt) totals.firstAt = timestamp
	totals.lastAt = timestamp
	totals.answers += 1
	if (info.added) totals.contributed += 1
	addDay(totals.activeDays, day)
}

/**
 * 记录一局结果。
 * @param {Aki.Devotion} devotion 统计
 * @param {string} id 角色 id
 * @param {boolean} won 是否命中
 * @returns {void}
 */
export function recordSession(devotion, id, won) {
	const record = devotionFor(devotion, id)
	const timestamp = Date.now()
	const day = dayKey(timestamp)
	record.sessions += 1
	if (won) record.wins += 1
	else record.losses += 1
	record.lastAt = timestamp
	addDay(record.activeDays, day)
	devotion.totals.sessions += 1
	if (won) devotion.totals.wins += 1
	else devotion.totals.losses += 1
	devotion.totals.lastAt = timestamp
	addDay(devotion.totals.activeDays, day)
}

/**
 * 把一个日期加入列表（去重、最多保留 400 天）。
 * @param {string[]} days 日期列表
 * @param {string} day 日期
 * @returns {void}
 */
function addDay(days, day) {
	if (!days.includes(day)) days.push(day)
	if (days.length > 400) days.splice(0, days.length - 400)
}

/**
 * 生成某角色的统计摘要。
 * @param {Aki.DevotionRecord} record 记录
 * @returns {{ answers: number; contributed: number; sessions: number; winRate: number; avgQuestionLength: number; recentAvgLength: number; activeDays: number; score: number }} 摘要
 */
export function devotionSummary(record) {
	const totalLength = record.recentLengths.reduce((sum, value) => sum + value, 0)
	const recentAvgLength = record.recentLengths.length ? totalLength / record.recentLengths.length : 0
	return {
		answers: record.answers,
		contributed: record.contributed,
		sessions: record.sessions,
		winRate: record.sessions ? record.wins / record.sessions : 0,
		avgQuestionLength: record.answers ? record.totalQuestionChars / record.answers : 0,
		recentAvgLength,
		activeDays: record.activeDays.length,
		score: devotionScore(record),
	}
}

/**
 * 计算一个「厨力值」用于排序 / 展示。
 * 规则：作答 1 分、补充题目 3 分、对局 2 分、命中 1 分。
 * @param {Aki.DevotionRecord} record 记录
 * @returns {number} 分值
 */
function devotionScore(record) {
	return record.answers + record.contributed * 3 + record.sessions * 2 + record.wins
}
