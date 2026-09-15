/**
 * 站点本地化装配：语言偏好存 localStorage，语言包内联在 shared/i18n。
 * @module site/scripts/i18n
 */

import { geti18n, initTranslations, main_locale, setLanguage } from '../../shared/i18n/index.mjs'
import { getBestLocale } from '../../shared/i18n/locale_match.mjs'
import { LOCALES } from '../../shared/i18n/locales/index.mjs'

/** localStorage 中语言偏好键。 */
export const LOCALE_KEY = 'akinator-auto-runner:locale'

/** 可用语言列表（供下拉）。 */
export const LOCALE_CODES = Object.keys(LOCALES)

/**
 * 语言展示名。
 * @param {string} code locale
 * @returns {string} 展示名
 */
export function localeLabel(code) {
	return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
}

/**
 * 当前语言。
 * @returns {string} 当前 locale
 */
export function currentLocale() {
	return main_locale
}

/**
 * 初始化翻译。
 * @returns {Promise<void>} 完成
 */
export async function initLocale() {
	const preferred = [localStorage.getItem(LOCALE_KEY) ?? '', navigator.language, ...navigator.languages].filter(Boolean)
	const best = getBestLocale(preferred, LOCALE_CODES)
	await initTranslations(undefined, [best])
}

/**
 * 切换语言并持久化。
 * @param {string} locale 目标语言
 * @returns {Promise<void>} 完成
 */
export async function setLocale(locale) {
	const best = getBestLocale([locale], LOCALE_CODES)
	localStorage.setItem(LOCALE_KEY, best)
	await setLanguage([best])
}

/** 转发 shared 的文案取值函数与语言包清单。 */
export { geti18n, LOCALES }
