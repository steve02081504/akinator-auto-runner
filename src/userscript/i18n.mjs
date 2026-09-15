/**
 * 油猴面板的本地化装配（语言偏好存于设置，见 `gm.mjs`）。
 * @module userscript/i18n
 */

import { geti18n, initTranslations, main_locale, setLanguage } from '../shared/i18n/index.mjs'
import { getBestLocale } from '../shared/i18n/locale_match.mjs'
import { LOCALES } from '../shared/i18n/locales/index.mjs'

import { loadSettings } from './gm.mjs'

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
 * 按当前设置初始化翻译。
 * @returns {Promise<void>} 完成
 */
export async function applyLocale() {
	await initTranslations(undefined, [loadSettings().language])
}

/**
 * 切换语言：应用语言包并写入设置。
 * @param {string} locale 目标语言
 * @param {(locale: string) => void} [persist] 持久化回调
 * @returns {Promise<void>} 完成
 */
export async function setLocale(locale, persist) {
	const best = getBestLocale([locale], LOCALE_CODES)
	await setLanguage([best])
	persist?.(best)
}

/** 转发 shared 的文案取值函数，供面板与页面模块统一从本模块取用。 */
export { geti18n }
