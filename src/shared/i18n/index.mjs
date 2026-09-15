/**
 * 本地化核心（与 fount 的 `pages/scripts/i18n` 同语义、同命名）。
 *
 * 站点与油猴脚本都用同一套 `data-i18n` 属性协议：`geti18n(key, params)`
 * 取文案，`i18nElement(root)` 把 `data-i18n` 应用到 DOM 子树。
 * 语言包直接内联在 {@link ./locales/index.mjs}，无需请求服务器。
 * @module shared/i18n
 */

import { onElementRemoved } from '../lib/onElementRemoved.mjs'

import { getBestLocale } from './locale_match.mjs'
import { DEFAULT_LOCALE, LOCALES } from './locales/index.mjs'

/** 转发语言匹配工具，保持 fount 同款的本地化入口。 */
export {
	FALLBACK_LOCALE,
	getBestLocale,
	matchLocale,
	pickLocalizedSlice,
} from './locale_match.mjs'

/** 语言变更回调。 */
const languageChangeCallbacks = []

/** 当前语言包（嵌套对象）。 */
let i18n
/** 当前主 locale。 */
export let main_locale = DEFAULT_LOCALE
/** 最近一次设置的语言列表。 */
export let lastKnownLangs

/**
 * 注册语言变更回调，并立即执行一次。
 * @param {Function} callback 回调
 * @returns {any} 回调返回值
 */
export function onLanguageChange(callback) {
	languageChangeCallbacks.push(callback)
	return callback()
}

/**
 * 注销语言变更回调。
 * @param {Function} callback 回调
 * @returns {void}
 */
export function offLanguageChange(callback) {
	const index = languageChangeCallbacks.indexOf(callback)
	if (index > -1) languageChangeCallbacks.splice(index, 1)
}

/**
 * 执行全部语言变更回调。
 * @returns {Promise<void>} 完成
 */
async function runLanguageChange() {
	for (const callback of languageChangeCallbacks) try {
		await callback()
	} catch (error) {
		console.error('Error in language change callback:', error)
	}
}

/** 元素 → 本地化逻辑。 */
const LocalizeLogics = new Map()

/**
 * 为元素登记本地化逻辑（元素被移除时自动注销）。
 * @param {HTMLElement} element 元素
 * @param {Function} logic 本地化逻辑
 * @returns {any} 语言变更回调的返回值
 */
export function setLocalizeLogic(element, logic) {
	if (LocalizeLogics.has(element)) offLanguageChange(LocalizeLogics.get(element))
	else onElementRemoved(element, () => offLanguageChange(LocalizeLogics.get(element)))
	LocalizeLogics.set(element, logic)
	return onLanguageChange(logic)
}

/**
 * 取可用语言列表。
 * @returns {string[]} locale 列表
 */
export function getAvailableLocales() {
	return Object.keys(LOCALES)
}

/**
 * 按点分键取值。
 * @param {object} obj 对象
 * @param {string} key 点分键
 * @returns {any|undefined} 值
 */
function getNestedValue(obj, key) {
	const keys = key.split('.')
	let value = obj
	for (const k of keys)
		if (value && value instanceof Object && k in value) value = value[k]
		else return undefined

	return value
}

/**
 * 用参数替换 `${name}` 占位符。
 * @param {string} text 模板文本
 * @param {Record<string, any>} params 参数
 * @returns {string} 替换后的文本
 */
function applyParams(text, params) {
	let result = text
	for (const key in params) {
		const placeholder = new RegExp(`\\$\\{${key}\\}`, 'g')
		result = result.replace(placeholder, () => params[key])
	}
	return result.replace(/`([^`]*)`/g, '<code>$1</code>')
}

/**
 * 设置翻译 bundle。
 * @param {object} bundle 翻译包
 * @param {string} locale 主 locale
 * @param {string} [pageid] 页面 id（保留以对齐 fount 签名）
 * @param {string[]} [langs] 已知语言列表
 * @returns {void}
 */
export function setI18nBundle(bundle, locale, pageid, langs) {
	i18n = bundle
	main_locale = locale ?? DEFAULT_LOCALE
	saved_pageid = pageid
	if (langs) lastKnownLangs = langs
}

/** 当前页面 id（对齐 fount 签名）。 */
export let saved_pageid

/**
 * 按首选语言链设置并应用翻译。
 * @param {string} [pageid] 页面 id
 * @param {string[]} [preferredLangs] 首选语言
 * @returns {Promise<void>} 完成
 */
export async function initTranslations(pageid, preferredLangs = []) {
	const locale = getBestLocale([...preferredLangs ?? [], DEFAULT_LOCALE], getAvailableLocales())
	setI18nBundle(LOCALES[locale], locale, pageid, preferredLangs)
	await applyTranslations()
}

/**
 * 切换语言。
 * @param {string[]} preferredLangs 首选语言列表
 * @returns {Promise<void>} 完成
 */
export async function setLanguage(preferredLangs) {
	await initTranslations(saved_pageid, preferredLangs)
}

/**
 * 取翻译（未找到时返回 undefined，不告警）。
 * @param {string} key 点分键
 * @param {Record<string, any>} [params] 插值参数
 * @returns {string | undefined} 文案
 */
export function geti18n_nowarn(key, params = {}) {
	const value = getNestedValue(i18n, key)
	if (value === undefined) return undefined
	if (typeof value !== 'string') return value
	return applyParams(value, params)
}

/**
 * 取翻译（未找到时告警并返回键名）。
 * @param {string} key 点分键
 * @param {Record<string, any>} [params] 插值参数
 * @returns {string} 文案
 */
export function geti18n(key, params = {}) {
	const translation = geti18n_nowarn(key, params)
	if (translation) return translation
	console.warn(`[i18n:missing] Translation key "${key}" not found.`)
	return key
}

/**
 * 翻译单个元素（`data-i18n` → 文本，`data-i18n-*` → 属性）。
 * @param {HTMLElement} element 目标元素
 * @returns {boolean} 是否发生了更新
 */
function translateSingularElement(element) {
	let updated = false
	/**
	 * 更新属性。
	 * @param {string} attr 属性名
	 * @param {string} value 值
	 * @returns {void}
	 */
	function updateAttribute(attr, value) {
		if (element.getAttribute(attr) === value) return
		element.setAttribute(attr, value)
		updated = true
	}
	for (const key of (element.dataset.i18n ?? '').split(';').map(k => k.trim()).filter(Boolean)) {
		const text = geti18n_nowarn(key, element.dataset)
		if (text === undefined) continue
		if (element.textContent !== text) {
			element.textContent = text
			updated = true
		}
		break
	}
	for (const attr of ['placeholder', 'title', 'aria-label', 'label', 'alt', 'value']) {
		const key = element.dataset[`i18n${attr.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('')}`]
		if (!key) continue
		const text = geti18n_nowarn(key, element.dataset)
		if (text === undefined) continue
		updateAttribute(attr, text)
	}
	return updated
}

/**
 * 把 `data-i18n*` 应用到元素及其子树。
 * @param {ParentNode & { matches?: Function; querySelectorAll: Function }} element 根节点
 * @returns {ParentNode} 原节点
 */
export function i18nElement(element) {
	const nodes = [...element.matches?.('[data-i18n]') ? [element] : [], ...element.querySelectorAll('[data-i18n]')]
	for (const node of nodes) translateSingularElement(node)
	return element
}

/**
 * 应用当前语言：设置 `<html lang>` 并翻译整个文档。
 * @returns {Promise<void>} 完成
 */
async function applyTranslations() {
	if (typeof document !== 'undefined') {
		document.documentElement.lang = geti18n('lang')
		i18nElement(document)
	}
	await runLanguageChange()
}
