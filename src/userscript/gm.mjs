/* global GM_setValue, GM_getValue, GM_deleteValue */

/**
 * 键值存储（优先油猴存储，降级 localStorage）与设置读写。
 * @module userscript/gm
 */

import { SETTINGS_KEY, SUBSCRIPTION_KEY } from '../shared/constants.mjs'
import { getBestLocale } from '../shared/i18n/locale_match.mjs'
import { LOCALES } from '../shared/i18n/locales/index.mjs'
import { normalizeTheme } from '../shared/theme.mjs'

/** 是否运行在油猴管理器提供的存储环境中。 */
const hasGM = typeof GM_setValue === 'function' && typeof GM_getValue === 'function'

/**
 * 读取存储值。
 * @template T
 * @param {string} key 键
 * @param {T} fallback 默认值
 * @returns {T} 值
 */
export function storageGet(key, fallback) {
	try {
		if (hasGM) {
			const value = GM_getValue(key, undefined)
			return value === undefined ? fallback : value
		}
		const raw = localStorage.getItem(key)
		return raw === null ? fallback : JSON.parse(raw)
	} catch {
		return fallback
	}
}

/**
 * 写入存储值。
 * @param {string} key 键
 * @param {unknown} value 值
 * @returns {void}
 */
export function storageSet(key, value) {
	try {
		if (hasGM) {
			GM_setValue(key, value)
			return
		}
		localStorage.setItem(key, JSON.stringify(value))
	} catch {
		/* 存储失败时静默忽略 */
	}
}

/**
 * 删除存储值。
 * @param {string} key 键
 * @returns {void}
 */
export function storageDelete(key) {
	try {
		if (hasGM) {
			GM_deleteValue(key)
			return
		}
		localStorage.removeItem(key)
	} catch {
		/* 忽略 */
	}
}

/**
 * 检测浏览器语言给出默认界面 locale。
 * @returns {string} locale（如 `zh-CN` / `en-UK`）
 */
function detectLocale() {
	if (typeof navigator === 'undefined') return 'en-UK'
	return getBestLocale([navigator.language, ...navigator.languages ?? []], Object.keys(LOCALES))
}

/**
 * 归一化可能来自旧版本 / 站点的设置。
 * @param {Record<string, unknown>} raw 原始设置
 * @returns {Aki.Settings} 归一化设置
 */
function normalizeSettings(raw) {
	const merged = { ...DEFAULT_SETTINGS, ...raw }
	// 旧版默认的 350ms 是「步进间隔」；新语义是「平均每步耗时」，350 会像没延时，升到新默认值。
	if (merged.stepDelayMs === LEGACY_STEP_DELAY_MS) merged.stepDelayMs = DEFAULT_SETTINGS.stepDelayMs
	merged.language = getBestLocale([String(merged.language ?? '')], Object.keys(LOCALES))
	merged.theme = normalizeTheme(merged.theme)
	return merged
}

/** 旧版默认的步进间隔（毫秒）；语义改为「平均每步耗时」后会在载入时升级。 */
const LEGACY_STEP_DELAY_MS = 350

/**
 * 默认设置。
 * @type {Aki.Settings}
 */
const DEFAULT_SETTINGS = {
	mode: 'replay',
	region: '',
	sid: 1,
	childMode: false,
	clientProvider: 'auto',
	stepDelayMs: 5000,
	rounds: 1,
	askUnknown: true,
	askProposal: false,
	stopOnWin: true,
	maxSteps: 80,
	bellEnabled: true,
	bellDelayMs: 60000,
	autoSave: true,
	language: detectLocale(),
	theme: 'auto',
}

/**
 * 读取设置。
 * @returns {Aki.Settings} 设置
 */
export function loadSettings() {
	return normalizeSettings(storageGet(SETTINGS_KEY, {}))
}

/**
 * 保存设置。
 * @param {Aki.Settings} settings 设置
 * @returns {void}
 */
export function saveSettings(settings) {
	storageSet(SETTINGS_KEY, settings)
}

/**
 * 读取云端订阅列表。
 * @returns {Aki.Subscription[]} 订阅列表
 */
export function loadSubscriptions() {
	const list = storageGet(SUBSCRIPTION_KEY, [])
	return Array.isArray(list) ? list : []
}

/**
 * 保存云端订阅列表。
 * @param {Aki.Subscription[]} list 订阅列表
 * @returns {void}
 */
export function saveSubscriptions(list) {
	storageSet(SUBSCRIPTION_KEY, list)
}
