/* global GM_setClipboard */

/**
 * 调试用的「一键 dump 页面信息」。
 *
 * akinator 页面结构 / 响应形态不稳定，遇到问题时点一下面板上的导出按钮（或油猴菜单），
 * 把 akinator 游戏页的关键 DOM、localStorage、页面自身最近一次作答响应与当前运行状态
 * 打包成 JSON：复制到剪贴板 + 下载文件，方便直接贴给别人排查。
 * @module userscript/debug
 */

import { download, now } from '../shared/util.mjs'

import { geti18n } from './i18n.mjs'
import { lastStepResponse } from './page_client.mjs'

/**
 * 收集当前页面的关键信息。
 * @param {import('./app/index.mjs').App} [app] 应用（用于附带运行状态）
 * @returns {Record<string, unknown>} 可序列化的信息
 */
function collectPageDump(app) {
	const state = app?.runner?.engine?.state
	/**
	 * 读取 localStorage（不可用时返回 null）。
	 * @param {string} key 键
	 * @returns {string | null} 值
	 */
	const readLocal = (key) => {
		try {
			return localStorage.getItem(key)
		} catch {
			return null
		}
	}
	return {
		url: location.href,
		title: document.title,
		time: now(),
		question: {
			label: document.getElementById('question-label')?.textContent ?? '',
			stepInfo: document.getElementById('step-info')?.textContent ?? '',
			block: elementInfo(document.getElementById('questionGameBlock')),
		},
		proposal: {
			name: document.getElementById('name_proposition')?.textContent ?? '',
			description: document.getElementById('description_proposition')?.textContent ?? '',
			photo: document.querySelector('#img_character img')?.getAttribute('src') ?? '',
			hiddenId: elementValue('id_proposition'),
			block: elementInfo(document.getElementById('proposeGameBlock')),
		},
		buttons: buttonInfos(),
		html: {
			questionGameBlock: outerHtml(document.getElementById('questionGameBlock')),
			proposeGameBlock: outerHtml(document.getElementById('proposeGameBlock')),
		},
		local: {
			session: readLocal('session'),
			signature: readLocal('signature'),
			identifiant: readLocal('identifiant'),
			pid: readLocal('pid'),
			step: readLocal('step'),
			progression: readLocal('progression'),
			game_ended: readLocal('game_ended'),
			current_theme: readLocal('current_theme'),
		},
		lastResponse: lastStepResponse(),
		runState: state ? {
			running: state.running,
			mode: state.mode,
			round: state.round,
			step: state.step,
			question: state.question?.text,
			proposal: state.proposal?.candidates?.map((candidate) => candidate.name),
			guess: state.guess?.name,
		} : undefined,
	}
}

/**
 * dump 当前页面：复制到剪贴板 + 下载 JSON，并写一条日志。
 * @param {import('./app/index.mjs').App} [app] 应用
 * @returns {Promise<Record<string, unknown>>} 收集到的信息
 */
export async function dumpPage(app) {
	const dump = collectPageDump(app)
	const text = JSON.stringify(dump, null, 2)
	await copyText(text)
	download(`akinator-page-dump-${stamp()}.json`, text)
	app?.pushLog?.({ time: now(), level: 'info', message: geti18n('debug.dumped') })
	return dump
}

/**
 * 一个元素的可读摘要。
 * @param {Element | null} element 元素
 * @returns {Record<string, unknown> | null} 摘要
 */
function elementInfo(element) {
	if (!element) return null
	return {
		id: element.id,
		tag: element.tagName,
		className: String(element.className ?? ''),
		text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
		display: getComputedStyle(element).display,
		onclick: element.getAttribute('onclick') ?? undefined,
	}
}

/**
 * 取隐藏域的字符串值。
 * @param {string} id 元素 id
 * @returns {string} 值
 */
function elementValue(id) {
	const element = document.getElementById(id)
	return element && 'value' in element ? String(element.value ?? '') : ''
}

/**
 * 截断元素的 outerHTML。
 * @param {Element | null} element 元素
 * @returns {string | undefined} HTML
 */
function outerHtml(element) {
	return element ? element.outerHTML.slice(0, 4000) : undefined
}

/**
 * 收集两个游戏区块内所有带 id 的按钮 / 链接信息。
 * @returns {Array<Record<string, unknown>>} 按钮摘要
 */
function buttonInfos() {
	const selector = '#questionGameBlock a, #questionGameBlock button, #proposeGameBlock a, #proposeGameBlock button, #proposeGameBlock [id], [id^="a_"]'
	const seen = new Set()
	const infos = []
	for (const element of document.querySelectorAll(selector)) {
		if (seen.has(element)) continue
		seen.add(element)
		infos.push(elementInfo(element))
	}
	return infos
}

/**
 * 复制文本到剪贴板（GM 优先，退回复制 API）。
 * @param {string} text 文本
 * @returns {Promise<void>} 完成
 */
async function copyText(text) {
	try {
		if (typeof GM_setClipboard === 'function') {
			GM_setClipboard(text, 'text')
			return
		}
	} catch {
		/* 退回 clipboard API */
	}
	try {
		await navigator.clipboard.writeText(text)
	} catch {
		/* 剪贴板不可用时忽略（文件已下载） */
	}
}

/**
 * 生成文件名用的时间戳。
 * @returns {string} 时间戳
 */
function stamp() {
	const date = new Date()
	/**
	 * 把数字补零到两位。
	 * @param {number} value 数值
	 * @returns {string} 两位字符串
	 */
	const pad = (value) => String(value).padStart(2, '0')
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}
