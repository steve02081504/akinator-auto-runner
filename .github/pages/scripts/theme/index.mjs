/**
 * 站点日夜模式：把共享的 {@link ../../shared/theme.mjs} 逻辑接到 `<html>` 上（持久化在共享模块里完成）。
 * @module site/scripts/theme
 */

import { applyTheme, getStoredTheme, nextTheme, normalizeTheme, storeTheme, watchSystemTheme } from '../../shared/theme.mjs'

/** 当前主题模式。 */
let mode = 'auto'

/**
 * 应用主题到 `<html>`。
 * @returns {'light' | 'dark'} 实际明暗
 */
function apply() {
	return applyTheme(mode, document.documentElement)
}

/**
 * 初始化主题：读取存储、应用并监听系统偏好变化。
 * @returns {void}
 */
export function initTheme() {
	mode = getStoredTheme()
	apply()
	watchSystemTheme(() => {
		if (mode === 'auto') apply()
	})
}

/**
 * 设置并持久化主题模式。
 * @param {unknown} value 目标模式
 * @returns {'light' | 'dark'} 实际明暗
 */
export function setTheme(value) {
	mode = normalizeTheme(value)
	storeTheme(mode)
	return apply()
}

/**
 * 循环切换到下一个主题模式。
 * @returns {'light' | 'dark'} 实际明暗
 */
export function cycleTheme() {
	return setTheme(nextTheme(mode))
}
