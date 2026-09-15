/**
 * 站点顶部赞助位（自荐广告）：HTML 在 `views/sponsor.html`，常量在 `shared/sponsor.mjs`。
 * @module site/scripts/parts/sponsor
 */

import { AD_HIDE_MS, sponsorData } from '../../shared/sponsor.mjs'
import { templatesFor } from '../../shared/template.mjs'
import { elementById } from '../lib/dom.mjs'

/** 渲染 API（运行时 fetch `views/` 下的模板）。 */
const templates = templatesFor('views')

/** 广告位开关在 localStorage 中的键。 */
export const SPONSOR_KEY = 'akinator-auto-runner:sponsor'

/**
 * 渲染顶部广告位。
 * @returns {Promise<void>} 完成
 */
export async function renderSponsor() {
	const slot = elementById('ad-slot')
	if (!slot) return
	if (Number(localStorage.getItem(SPONSOR_KEY) ?? 0) > Date.now()) return slot.replaceChildren()

	await templates.appendTemplate(slot, 'sponsor', sponsorData('banner'))
}

/**
 * 处理广告位上的操作（关闭 / 展开说明）。
 * @param {Event} event 事件
 * @returns {void}
 */
export function onAdAction(event) {
	if (!(event.target instanceof Element)) return
	const button = event.target.closest('[data-ad-action]')
	if (!button) return
	event.preventDefault()
	if (button.getAttribute('data-ad-action') === 'close') {
		localStorage.setItem(SPONSOR_KEY, String(Date.now() + AD_HIDE_MS))
		renderSponsor()
		return
	}
	const why = button.closest('.aki-card')?.querySelector('.aki-card-why')
	if (why instanceof HTMLElement) why.hidden = !why.hidden
}
