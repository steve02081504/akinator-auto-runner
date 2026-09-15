/**
 * 面板的模板渲染 API 与共用的视图片段。
 * @module userscript/ui/templates
 */

import { ANSWER_I18N_KEYS } from '../../shared/constants.mjs'
import { answerDistribution } from '../../shared/schema.mjs'
import { templatesFromSources } from '../../shared/template.mjs'
import { geti18n } from '../i18n.mjs'
import views from '../views/index.mjs'

/** 渲染 API（模板在构建期由 esbuild text loader 内联）。 */
export const templates = templatesFromSources(views)

/**
 * 渲染一组答案权重的分布条 HTML。
 * @param {number[]} weights 某角色某题的答案权重
 * @returns {Promise<string>} HTML
 */
export function distributionBars(weights) {
	return templates.renderListAsHtmlString('distribution-bar', answerDistribution(weights).map((item, index) => ({
		label: geti18n(ANSWER_I18N_KEYS[index]),
		count: item.count,
		percent: Math.round(item.ratio * 100),
	})))
}
