/**
 * 模板渲染（移植自 fount `pages/scripts/features/template.mjs`）。
 *
 * 模板是普通 `.html` 文件，内嵌 `${expression}` 表达式，由
 * `@steve02081504/async-eval` 在数据作用域中求值；渲染结果经 `i18nElement`
 * 应用 `data-i18n`，因此模板里只写结构与 key，文案交给语言包。
 *
 * 站点运行时 `fetch` 模板（`templatesFor`），油猴构建期把模板内联成文本
 * （`templatesFromSources`），二者共用同一套渲染逻辑。
 * @module shared/template
 */

import { i18nElement } from './i18n/index.mjs'
import { escapeHtml } from './util.mjs'

/** 模板文本缓存（按绝对 URL）。 */
const template_cache = {}

/** 不需要闭合的空元素。 */
const VOID_TAGS = new Set([
	'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])

/**
 * 动态加载 async_eval（同时兼容站点原生 ESM 与油猴 esbuild 打包）。
 * @returns {Promise<(expression: string, data?: object) => Promise<{ result?: unknown; error?: unknown }>>} async_eval
 */
async function loadAsyncEval() {
	const module = await import('https://esm.sh/@steve02081504/async-eval')
	return module.async_eval
}

/**
 * 修复未闭合标签（移植自 fount）。
 * @param {string} html 待修复 HTML
 * @returns {string} 修复后的 HTML
 */
function escapeUnclosedTags(html) {
	const stack = []
	const indicesToEscape = new Set()
	const tagRegex = /<(\/?)([A-Za-z][\dA-Za-z-]*)\b((?:[^"'>]|"[^"]*"|'[^']*')*?)\/?>/g

	let match
	while ((match = tagRegex.exec(html)) !== null) {
		const isClosing = match[1] === '/'
		const tagName = match[2].toLowerCase()
		const { index } = match
		if (VOID_TAGS.has(tagName) || match[0].trim().endsWith('/>')) continue
		if (isClosing) {
			let matchIndex = -1
			for (let i = stack.length - 1; i >= 0; i--)
				if (stack[i].tagName === tagName) {
					matchIndex = i
					break
				}
			if (matchIndex !== -1) {
				for (let i = matchIndex + 1; i < stack.length; i++) indicesToEscape.add(stack[i].index)
				stack.splice(matchIndex)
			} else
				indicesToEscape.add(index)
		} else
			stack.push({ tagName, index })
	}
	stack.forEach(item => indicesToEscape.add(item.index))
	if (!indicesToEscape.size) return html

	let result = ''
	let lastCursor = 0
	for (const idx of Array.from(indicesToEscape).sort((a, b) => a - b)) {
		result += html.slice(lastCursor, idx)
		result += '&lt;'
		lastCursor = idx + 1
	}
	return result + html.slice(lastCursor)
}

/**
 * 从 HTML 字符串创建 DOM 片段（不激活脚本）。
 * @param {string} htmlString HTML 字符串
 * @returns {DocumentFragment} 片段
 */
export function createDocumentFragmentFromHtmlStringNoScriptActivation(htmlString) {
	if (!htmlString || !htmlString.trim()) return document.createDocumentFragment()
	const template = document.createElement('template')
	template.innerHTML = htmlString
	return template.content
}

/**
 * 从 HTML 字符串创建 DOM（不激活脚本）。
 * @param {string} htmlString HTML 字符串
 * @returns {Element | DocumentFragment | Document} DOM
 */
export function createDOMFromHtmlStringNoScriptActivation(htmlString) {
	if (/^\s*<!doctype/i.test(htmlString) || /^\s*<html/i.test(htmlString))
		return new DOMParser().parseFromString(htmlString, 'text/html')

	const fragment = createDocumentFragmentFromHtmlStringNoScriptActivation(htmlString)
	return fragment.children.length === 1 ? fragment.children[0] : fragment
}

/**
 * 把渲染结果挂载到父节点。
 * @param {Element} parent 父节点
 * @param {Element | DocumentFragment | Document} node 渲染结果
 * @returns {void}
 */
function mountRenderedNode(parent, node) {
	if (node.nodeType === Node.DOCUMENT_NODE) {
		const children = (node.body ?? node.documentElement)?.childNodes
		if (children?.length) parent.append(...children)
		else if (node.documentElement) parent.appendChild(node.documentElement)
	} else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE)
		parent.append(...node.childNodes)
	else
		parent.appendChild(node)
}

/**
 * 把一段含 `${...}` 的模板文本按数据求值成 HTML。
 * @param {string} source 模板文本
 * @param {Record<string, unknown>} data 数据作用域
 * @returns {Promise<string>} 渲染后的 HTML
 */
async function formatTemplate(source, data) {
	const async_eval = await loadAsyncEval()
	const scope = { escapeHtml, ...data }
	let html = source
	let result = ''
	const errors = []
	while (html.indexOf('${') !== -1) {
		const length = html.indexOf('${')
		result += html.slice(0, length)
		html = html.slice(length + 2)
		let end_index = 0
		let matched = false
		find: while (html.indexOf('}', end_index) !== -1) {
			end_index = html.indexOf('}', end_index) + 1
			const expression = html.slice(0, end_index - 1)
			try {
				const eval_result = await async_eval(expression, scope)
				if (eval_result.error) throw eval_result.error
				result += escapeUnclosedTags(String(eval_result.result))
				html = html.slice(end_index)
				errors.length = 0
				matched = true
				break find
			} catch (error) {
				errors.push(error)
			}
		}
		if (!matched) {
			errors.forEach(console.error)
			errors.length = 0
			result += `\${${html.slice(0, end_index || html.length)}`
			html = html.slice(end_index || html.length)
		}
	}
	return result + html
}

/**
 * 用 fetch 拉取并缓存模板文本。
 * @param {string} url 模板 URL
 * @returns {Promise<string>} 模板文本
 */
function fetchTemplate(url) {
	if (!Object.hasOwn(template_cache, url))
		template_cache[url] = fetch(url).then(response => {
			if (!response.ok) throw new Error(`HTTP error, status: ${response.status}`)
			return response.text()
		}).catch(error => {
			delete template_cache[url]
			throw error
		})
	return template_cache[url]
}

/**
 * 基于“模板文本获取函数”创建渲染 API（站点 fetch / 油猴内联共用）。
 * @param {(template: string) => Promise<string>} sourceOf 取模板文本
 * @returns {{
 *   renderTemplate: (template: string, data?: object) => Promise<Element | DocumentFragment | Document>,
 *   renderTemplateAsHtmlString: (template: string, data?: object) => Promise<string>,
 *   renderListAsHtmlString: (template: string, items?: object[]) => Promise<string>,
 *   mountTemplate: (parent: Element, template: string, data?: object) => Promise<Element>,
 *   appendTemplate: (parent: Element, template: string, data?: object) => Promise<Element>,
 * }} 渲染 API
 */
function createTemplatesApi(sourceOf) {
	/**
	 * 渲染模板为 DOM（应用 i18n）。
	 * @param {string} template 模板名
	 * @param {object} [data] 数据
	 * @returns {Promise<Element | DocumentFragment | Document>} DOM
	 */
	async function renderTemplate(template, data = {}) {
		const html = await formatTemplate(await sourceOf(template), data)
		return i18nElement(createDOMFromHtmlStringNoScriptActivation(html))
	}

	/**
	 * 渲染模板为 HTML 字符串。
	 * @param {string} template 模板名
	 * @param {object} [data] 数据
	 * @returns {Promise<string>} HTML
	 */
	async function renderTemplateAsHtmlString(template, data = {}) {
		const node = await renderTemplate(template, data)
		if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
			const div = document.createElement('div')
			div.appendChild(node)
			return div.innerHTML
		}
		if (node.nodeType === Node.DOCUMENT_NODE) return node.documentElement.outerHTML
		return node.outerHTML
	}

	/**
	 * 用同一模板逐项渲染列表为 HTML 字符串，供嵌入上层模板的 `${...}`。
	 * @param {string} template 模板名
	 * @param {object[]} items 数据列表
	 * @returns {Promise<string>} HTML
	 */
	async function renderListAsHtmlString(template, items = []) {
		const container = document.createElement('div')
		for (const item of items) mountRenderedNode(container, await renderTemplate(template, item))
		return container.innerHTML
	}

	/**
	 * 清空父节点并挂载渲染结果。
	 * @param {Element} parent 父节点
	 * @param {string} template 模板名
	 * @param {object} [data] 数据
	 * @returns {Promise<Element>} 父节点
	 */
	async function mountTemplate(parent, template, data = {}) {
		const node = await renderTemplate(template, data)
		parent.replaceChildren()
		mountRenderedNode(parent, node)
		return parent
	}

	/**
	 * 渲染并追加到父节点。
	 * @param {Element} parent 父节点
	 * @param {string} template 模板名
	 * @param {object} [data] 数据
	 * @returns {Promise<Element>} 父节点
	 */
	async function appendTemplateInto(parent, template, data = {}) {
		mountRenderedNode(parent, await renderTemplate(template, data))
		return parent
	}

	return { renderTemplate, renderTemplateAsHtmlString, renderListAsHtmlString, mountTemplate, appendTemplate: appendTemplateInto }
}

/**
 * 基于模板根（相对页面）创建渲染 API（站点用，运行时 fetch）。
 * @param {string} root 模板根目录（如 `/views`）
 * @returns {ReturnType<typeof createTemplatesApi>} 渲染 API
 */
export function templatesFor(root) {
	const resolvedRoot = String(root).replace(/\/+/g, '/').replace(/\/$/, '')
	return createTemplatesApi(template => fetchTemplate(`${resolvedRoot}/${template}.html`))
}

/**
 * 用已内联的模板文本表创建渲染 API（油猴用，构建期经 esbuild text loader 内联）。
 * @param {Record<string, string>} sources 模板名 → 模板 HTML
 * @returns {ReturnType<typeof createTemplatesApi>} 渲染 API
 */
export function templatesFromSources(sources) {
	return createTemplatesApi(async template => {
		const source = sources[template]
		if (source === undefined) throw new Error(`[template:missing] ${template}`)
		return source
	})
}
