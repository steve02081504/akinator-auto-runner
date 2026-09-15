/**
 * akinator 主页面上的浮动广告位（自荐赞助位）。
 *
 * 广告挂在 akinator 页面本体（独立 Shadow DOM 宿主，固定左下角），而不是脚本
 * 面板里——就像真实站点上的展示广告。关闭后 24 小时内不再出现（存储键同站点）。
 * 样式来自共享的 `shared/sponsor.css`。
 * @module userscript/ad
 */

import styles from '../shared/sponsor.css'
import { AD_HIDE_MS, sponsorData } from '../shared/sponsor.mjs'
import { templatesFromSources } from '../shared/template.mjs'

import { storageGet, storageSet } from './gm.mjs'
import views from './views/index.mjs'

/** 广告位开关在存储中的键。 */
export const SPONSOR_KEY = 'akinator-auto-runner:sponsor'

/** 渲染 API（模板在构建期由 esbuild text loader 内联）。 */
const templates = templatesFromSources(views)

/**
 * akinator 主页面上的浮动广告位（左下角固定，独立于脚本面板）。
 */
export class AdSlot {
	/**
	 * 读取关闭状态并准备宿主引用。
	 */
	constructor() {
		/** @type {HTMLElement | undefined} */
		this.host = undefined
		/** @type {ShadowRoot | undefined} */
		this.shadow = undefined
		/** @type {HTMLElement | undefined} */
		this.slot = undefined
		/** @type {boolean} */
		this.hidden = Number(storageGet(SPONSOR_KEY, 0)) > Date.now()
	}

	/**
	 * 挂载广告宿主。
	 * @returns {Promise<void>} 完成
	 */
	async mount() {
		if (this.hidden || this.host) return
		const host = document.createElement('div')
		host.id = 'akinator-auto-runner-ad'
		host.style.cssText = 'all:initial;position:fixed;z-index:2147483640;left:16px;bottom:16px;width:min(340px,calc(100vw - 32px));'
		const shadow = host.attachShadow({ mode: 'open' })
		const style = document.createElement('style')
		style.textContent = styles
		shadow.appendChild(style)
		const slot = document.createElement('div')
		shadow.appendChild(slot)
		shadow.addEventListener('click', (event) => this.#onClick(event))
		document.documentElement.appendChild(host)
		this.host = host
		this.shadow = shadow
		this.slot = slot
		await this.render()
	}

	/**
	 * 渲染广告内容。
	 * @returns {Promise<void>} 完成
	 */
	async render() {
		if (!this.slot || this.hidden) return
		await templates.appendTemplate(this.slot, 'sponsor', sponsorData('floating'))
	}

	/**
	 * 关闭广告：移除宿主并记录隐藏截止时间。
	 * @returns {void} 无
	 */
	close() {
		this.hidden = true
		storageSet(SPONSOR_KEY, Date.now() + AD_HIDE_MS)
		this.host?.remove()
		this.host = undefined
		this.shadow = undefined
		this.slot = undefined
	}

	/**
	 * 处理广告位上的操作。
	 * @param {Event} event 事件
	 * @returns {void} 无
	 */
	#onClick(event) {
		if (!(event.target instanceof Element)) return
		const button = event.target.closest('[data-ad-action]')
		if (!button) return
		event.preventDefault()
		if (button.getAttribute('data-ad-action') === 'close') {
			this.close()
			return
		}
		const why = button.closest('.aki-card')?.querySelector('.aki-card-why')
		if (why instanceof HTMLElement) why.hidden = !why.hidden
	}
}
