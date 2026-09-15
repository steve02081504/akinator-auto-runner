/**
 * 与运行环境无关的通用工具函数。
 * @module shared/util
 */

/**
 * 等待若干毫秒。
 * @param {number} ms 毫秒数
 * @returns {Promise<void>} 等待完成的 Promise
 */
export function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

/**
 * 创建一个防抖函数：在最后一次调用后静默 `ms` 毫秒才真正执行。
 * @param {(...args: unknown[]) => void} fn 需要防抖的函数
 * @param {number} ms 静默毫秒数
 * @returns {(...args: unknown[]) => void} 防抖后的函数
 */
export function debounce(fn, ms) {
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer
	return (...args) => {
		if (timer !== undefined) clearTimeout(timer)
		timer = setTimeout(() => {
			timer = undefined
			fn(...args)
		}, ms)
	}
}

/**
 * 把任意名称转换为可用作文件名 / URL 片段的 slug，保留 CJK 等字母。
 * @param {string} name 原始名称
 * @returns {string} slug，可能为空
 */
export function slugify(name) {
	return name
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80)
}

/**
 * 解码 HTML 实体。依赖 DOM，仅可在浏览器环境调用。
 * @param {string} html 含实体的字符串
 * @returns {string} 解码后的纯文本
 */
function decodeHtmlEntities(html) {
	if (!html) return ''
	const decoder = document.createElement('textarea')
	decoder.innerHTML = html
	return decoder.value
}

/**
 * 去掉 HTML 标签并解码实体。
 * @param {string} html 原始 HTML 片段
 * @returns {string} 纯文本
 */
export function stripHtml(html) {
	if (!html) return ''
	return decodeHtmlEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/**
 * 归一化问题文本，作为题库主键。
 * @param {string} text 问题文本
 * @returns {string} 归一化后的键
 */
export function normalizeQuestion(text) {
	return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * 归一化搜索文本：统一全半角、转小写并去掉标点 / 空白。
 *
 * 角色名里的中圆点有 `•`（U+2022）、`·`（U+00B7）、`・`（U+30FB）等多种写法，
 * 用户手打或用输入法时常常对不上；去掉这些分隔符后 `龙胆·阿芙萝黛蒂` 也能命中
 * `龙胆•阿芙萝黛蒂`。
 * @param {string} text 原始文本
 * @returns {string} 归一化后的文本
 */
export function normalizeSearchText(text) {
	return String(text).normalize('NFKC').toLowerCase().replace(/[\p{P}\s]+/gu, '')
}

/**
 * 判断给定字段是否命中搜索关键词（忽略大小写、全半角与标点 / 空白差异）。
 * @param {string} query 关键词
 * @param {string[]} fields 参与匹配的字段
 * @returns {boolean} 是否命中
 */
export function matchesQuery(query, fields) {
	const needle = normalizeSearchText(query)
	if (!needle) return true
	return normalizeSearchText(fields.join(' ')).includes(needle)
}

/**
 * 深拷贝一个可结构化克隆的值。
 * @template T
 * @param {T} value 原值
 * @returns {T} 拷贝
 */
export function deepClone(value) {
	return structuredClone(value)
}

/**
 * 把值当作普通对象记录来访问（运行时不改变值）。
 *
 * 说明：本仓库的 ESLint 配置会移除 JSDoc 类型转换所需的括号，使 `@type` 转换
 * 无法通过 `tsc --checkJs`；因此统一用本辅助函数代替表达式转换。
 * @param {unknown} value 原始值
 * @returns {Record<string, unknown>} 对象记录（非对象时返回空对象）
 */
export function asRecord(value) {
	return value && typeof value === 'object' ? value : {}
}

/**
 * 把值当作数组访问。
 * @param {unknown} value 原始值
 * @returns {unknown[]} 数组（非数组时返回空数组）
 */
export function asArray(value) {
	return Array.isArray(value) ? value : []
}

/**
 * 转义 HTML 特殊字符，用于安全插入 innerHTML。
 * @param {unknown} value 任意值
 * @returns {string} 转义后的字符串
 */
export function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

/**
 * 触发浏览器下载一段文本。
 * @param {string} filename 文件名
 * @param {string} text 文本内容
 * @param {string} [mime] MIME 类型
 * @returns {void}
 */
export function download(filename, text, mime = 'application/json') {
	const anchor = document.createElement('a')
	anchor.href = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
	anchor.download = filename
	document.body.appendChild(anchor)
	anchor.click()
	anchor.remove()
	setTimeout(() => URL.revokeObjectURL(anchor.href), 1000)
}

/**
 * 返回当前时间戳（毫秒）。
 * @returns {number} 时间戳
 */
export function now() {
	return Date.now()
}
