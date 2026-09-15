/**
 * 自荐赞助位（广告位）的常量与模板数据。
 *
 * 这是一个「看起来像正规广告」的自有广告位：带「广告」角标、AdChoices 提示、
 * 广告位标识与展示网络名，点击跳转到赞助项目。HTML 在各端的
 * `views/sponsor.html` 模板里，文案全部走 `data-i18n`（`sponsor.*` 键），
 * 样式共用 `shared/sponsor.css`，图标来自 `shared/icons.mjs`。
 * @module shared/sponsor
 */

import { icon } from './icons.mjs'

/** 广告位标识（形似真实广告网络的 slot id）。 */
const AD_SLOT = 'aki-runner-overlay-320x120'

/** 展示网络名（自有广告位，非第三方网络）。 */
const AD_NETWORK = 'AkiAds Self-Serve'

/** 赞助条目（非文案部分）。 */
export const SPONSOR = {
	/** 品牌名。 */
	brand: 'fount',
	/** 品牌图标名（见 `shared/icons.mjs`）。 */
	markIcon: 'droplets',
	/** 跳转地址。 */
	url: 'https://github.com/steve02081504/fount',
	/** 广告主。 */
	advertiser: 'steve02081504',
}

/** 广告被关闭后的隐藏时长（毫秒）。 */
export const AD_HIDE_MS = 24 * 60 * 60 * 1000

/**
 * 构造 `sponsor` 模板所需的数据（含内联 SVG 图标）。
 * @param {'banner' | 'floating'} variant 展示形态
 * @returns {Record<string, string>} 模板数据
 */
export function sponsorData(variant) {
	return {
		variant,
		adSlot: AD_SLOT,
		adNetwork: AD_NETWORK,
		brand: SPONSOR.brand,
		advertiser: SPONSOR.advertiser,
		url: SPONSOR.url,
		markIcon: icon(SPONSOR.markIcon, { size: 22 }),
		infoIcon: icon('info', { size: 13 }),
		closeIcon: icon('x', { size: 14 }),
		ctaIcon: icon('arrow-right', { size: 13 }),
	}
}
