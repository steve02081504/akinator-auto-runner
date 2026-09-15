/**
 * 本地化语言匹配纯函数（站点与脚本前端共用，语义与 fount 一致）。
 * 严格前缀：`k === prefix || k.startsWith(prefix + '-')`，避免 `zh` 匹配到 `zhuang`。
 */

/** 无法匹配时的兜底语言（与 fount 相同，默认英式英语）。 */
export const FALLBACK_LOCALE = 'en-UK'

/**
 * 从语言条目解析 locale id。
 * @param {string | { id?: string } | null | undefined} entry 语言条目
 * @returns {string} locale id
 */
function localeIdOf(entry) {
	if (entry == null) return ''
	if (typeof entry === 'string') return entry
	return String(entry.id ?? '')
}

/**
 * 归一化可用语言列表。
 * @param {Array<string | { id?: string }>} available 可用列表（`string[]` 或 `{id}[]`）
 * @returns {string[]} locale id 列表
 */
function normalizeAvailable(available) {
	return (available || []).map(localeIdOf).filter(Boolean)
}

/**
 * 从首选语言列表按顺序匹配可用语言。
 * @param {string[]} preferred 用户首选语言列表
 * @param {Array<string | { id?: string }>} available 可用列表
 * @returns {string | undefined} 最匹配者；无匹配时 undefined
 */
export function matchLocale(preferred, available) {
	const ids = normalizeAvailable(available)
	if (!ids.length) return undefined
	const idSet = new Set(ids)

	for (const raw of preferred || []) {
		const preferredLocale = String(raw || '').trim()
		if (!preferredLocale) continue
		if (idSet.has(preferredLocale)) return preferredLocale

		const prefix = preferredLocale.split('-')[0]
		if (!prefix) continue
		const hit = ids.find(k => k === prefix || k.startsWith(`${prefix}-`))
		if (hit) return hit
	}
	return undefined
}

/**
 * 同 {@link matchLocale}，无匹配时返回 {@link FALLBACK_LOCALE}。
 * @param {string[]} preferred 用户首选语言列表
 * @param {Array<string | { id?: string }>} available 可用列表
 * @returns {string} 最匹配或兜底
 */
export function getBestLocale(preferred, available) {
	return matchLocale(preferred, available) ?? FALLBACK_LOCALE
}

/**
 * 从多语言 map 中按语言列表取出对应切片。
 * @template T
 * @param {Record<string, T>} [map] 多语言字典
 * @param {string[]} [preferred] 用户首选语言列表
 * @returns {T | undefined} 匹配的切片，map 为空时 undefined
 */
export function pickLocalizedSlice(map, preferred) {
	if (!map) return undefined
	const keys = Object.keys(map)
	if (!keys.length) return undefined
	const hit = matchLocale(preferred, keys) ?? keys[0]
	return map[hit]
}
