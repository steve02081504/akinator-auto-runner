/**
 * 日夜模式（移植 fount `pages/scripts/theme` 的精简版，多环境共用）。
 *
 * 站点的主题存在 localStorage、油猴面板的存在设置里，所以持久化交给调用方，
 * 这里只负责：读取系统偏好、把模式解析为 `light`/`dark`、写到元素的 `data-theme`。
 * @module shared/theme
 */

/** localStorage 中主题模式的键（与 fount 一致）。 */
const STORAGE_KEY_THEME = 'akinator-auto-runner:theme'

/** 可选主题模式，顺序即切换顺序。 */
const THEMES = ['auto', 'light', 'dark']

/**
 * 系统是否偏好深色。
 * @returns {boolean} 是否深色
 */
function prefersDark() {
	return typeof globalThis.matchMedia === 'function'
		? globalThis.matchMedia('(prefers-color-scheme: dark)').matches
		: false
}

/** 合法主题模式集合。 */
const THEME_SET = new Set(THEMES)

/**
 * 归一化主题模式。
 * @param {unknown} theme 原始值
 * @returns {string} `auto` / `light` / `dark`
 */
export function normalizeTheme(theme) {
	return THEME_SET.has(theme) ? theme : 'auto'
}

/**
 * 把主题模式解析为实际明暗。
 * @param {unknown} theme 主题模式
 * @returns {'light' | 'dark'} 实际明暗
 */
function resolveTheme(theme) {
	const normalized = normalizeTheme(theme)
	if (normalized === 'auto') return prefersDark() ? 'dark' : 'light'
	return normalized
}

/**
 * 把主题应用到元素，并同步 `data-theme` 与 `color-scheme`。
 * @param {unknown} theme 主题模式
 * @param {HTMLElement} [root] 目标元素（默认 `document.documentElement`）
 * @returns {'light' | 'dark'} 实际明暗
 */
export function applyTheme(theme = getStoredTheme(), root = typeof document !== 'undefined' ? document.documentElement : undefined) {
	const resolved = resolveTheme(theme)
	if (root) {
		root.dataset.theme = resolved
		root.style.colorScheme = resolved
	}
	return resolved
}

/**
 * 循环切换到下一个主题模式。
 * @param {unknown} theme 当前模式
 * @returns {string} 下一个模式
 */
export function nextTheme(theme) {
	const index = THEMES.indexOf(normalizeTheme(theme))
	return THEMES[(index + 1) % THEMES.length]
}

/**
 * 读取 localStorage 中保存的主题模式。
 * @returns {string} 主题模式
 */
export function getStoredTheme() {
	if (typeof localStorage === 'undefined') return 'auto'
	return normalizeTheme(localStorage.getItem(STORAGE_KEY_THEME) ?? 'auto')
}

/**
 * 保存主题模式到 localStorage。
 * @param {unknown} theme 主题模式
 * @returns {string} 生效模式
 */
export function storeTheme(theme) {
	const normalized = normalizeTheme(theme)
	if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY_THEME, normalized)
	return normalized
}

/**
 * 监听系统明暗偏好变化。
 * @param {() => void} listener 回调
 * @returns {() => void} 取消监听
 */
export function watchSystemTheme(listener) {
	if (typeof globalThis.matchMedia !== 'function') return () => {}
	const media = globalThis.matchMedia('(prefers-color-scheme: dark)')
	media.addEventListener('change', listener)
	return () => media.removeEventListener('change', listener)
}
