/**
 * 跨页面持久化：运行日志与「最近一次会话」快照。
 *
 * 油猴脚本在 akinator 的每个页面都会重新注入，刷新 / 跳转会丢掉内存里的状态。
 * 这里把日志与会话快照写进油猴存储（或 localStorage），页面重载后面板仍能显示
 * 历史日志，并给出「上次会话已中断」的续跑入口。
 * @module userscript/session
 */

import { LOG_KEY, MAX_LOG_ENTRIES, SESSION_KEY } from '../shared/constants.mjs'
import { asArray, asRecord } from '../shared/util.mjs'

import { storageDelete, storageGet, storageSet } from './gm.mjs'

/**
 * 把任意字符串归一化为合法日志级别。
 * @param {unknown} value 原始级别
 * @returns {Aki.LogEntry['level']} 合法级别
 */
function normalizeLevel(value) {
	if (value === 'warn' || value === 'error' || value === 'success') return value
	return 'info'
}

/**
 * 读取持久化的日志。
 * @returns {Aki.LogEntry[]} 日志条目（已过滤非法项）
 */
export function loadLogs() {
	/** @type {Aki.LogEntry[]} */
	const result = []
	for (const item of asArray(storageGet(LOG_KEY, []))) {
		const entry = asRecord(item)
		const time = Number(entry.time)
		if (!Number.isFinite(time) || typeof entry.message !== 'string') continue
		result.push({ time, level: normalizeLevel(entry.level), message: entry.message })
	}
	return result
}

/**
 * 写入日志（只保留最后 {@link MAX_LOG_ENTRIES} 条）。
 * @param {Aki.LogEntry[]} entries 日志条目
 * @returns {void}
 */
export function saveLogs(entries) {
	storageSet(LOG_KEY, entries.slice(-MAX_LOG_ENTRIES))
}

/**
 * 清空持久化日志。
 * @returns {void}
 */
export function clearLogs() {
	storageDelete(LOG_KEY)
}

/**
 * 读取最近一次会话快照。
 * @returns {Aki.SessionSnapshot | undefined} 快照
 */
export function loadSession() {
	const raw = asRecord(storageGet(SESSION_KEY, null))
	if (!raw.characterId) return undefined
	if (raw.mode !== 'record' && raw.mode !== 'replay') return undefined
	return {
		characterId: String(raw.characterId),
		mode: raw.mode === 'record' ? 'record' : 'replay',
		running: !!raw.running,
		round: Number(raw.round) || 0,
		step: Number(raw.step) || 0,
		wins: Number(raw.wins) || 0,
		losses: Number(raw.losses) || 0,
		question: raw.question ? String(raw.question) : undefined,
		startedAt: Number(raw.startedAt) || 0,
		updatedAt: Number(raw.updatedAt) || 0,
		finishedAt: Number(raw.finishedAt) || undefined,
	}
}

/**
 * 写入会话快照。
 * @param {Aki.SessionSnapshot} snapshot 快照
 * @returns {void}
 */
export function saveSession(snapshot) {
	storageSet(SESSION_KEY, snapshot)
}

/**
 * 清除会话快照。
 * @returns {void}
 */
export function clearSession() {
	storageDelete(SESSION_KEY)
}
