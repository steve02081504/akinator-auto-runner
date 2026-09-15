/**
 * 站点 DOM 小工具。
 * @module site/scripts/lib/dom
 */

/**
 * 按 id 取元素。
 * @param {string} id 元素 id
 * @returns {HTMLElement | null} 元素
 */
export function elementById(id) {
	return document.getElementById(id)
}

/**
 * 取输入型元素的字符串值。
 * @param {string} id 元素 id
 * @returns {string} 值
 */
export function valueOf(id) {
	const element = elementById(id)
	if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return element.value
	return ''
}
