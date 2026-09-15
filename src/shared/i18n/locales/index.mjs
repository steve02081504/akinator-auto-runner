/**
 * 语言包清单。
 * @module shared/i18n/locales
 */

import enUK from './en-UK.json' with { type: 'json' }
import zhCN from './zh-CN.json' with { type: 'json' }

/** 可用语言包（locale → 语言包）。 */
export const LOCALES = {
	'en-UK': enUK,
	'zh-CN': zhCN,
}

/** 默认语言。 */
export const DEFAULT_LOCALE = 'en-UK'
