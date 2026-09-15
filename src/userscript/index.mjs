/* global GM_info, GM_registerMenuCommand, unsafeWindow */

/**
 * 油猴脚本入口。
 *
 * - 顶层打开 akinator：注入控制面板。
 * - 由站点打开（弹窗 / iframe）：只建立 postMessage 桥，由站点负责 UI。
 * @module userscript/index
 */

import { AdSlot } from './ad.mjs'
import { App } from './app/index.mjs'
import { Bridge, isBridged } from './bridge.mjs'
import { dumpPage } from './debug.mjs'
import { keepPageForeground } from './foreground.mjs'
import { geti18n } from './i18n.mjs'
import { takePendingRun } from './navigation.mjs'
import { PageMirror } from './page.mjs'
import { PanelUI } from './ui/index.mjs'

// document-start 同步安装：必须在页面自身脚本之前覆盖 rAF / visibility，否则晚一步就没用。
keepPageForeground()

/**
 * 关闭 akinator 对非官方入口的「回官方站」提示弹窗（仅此一个，不动广告）。
 * @returns {void}
 */
function dismissIframeNotice() {
	for (const element of document.querySelectorAll('#notOfficial')) element.remove()
	const backdrop = document.querySelector('.modal-backdrop')
	if (backdrop) backdrop.remove()
	if (document.body) {
		document.body.classList.remove('modal-open')
		document.body.style.removeProperty('overflow')
	}
}

/**
 * 等待 DOM 就绪。
 * @returns {Promise<void>} 完成
 */
function domReady() {
	if (document.readyState !== 'loading') return Promise.resolve()
	return new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }))
}

/**
 * 入口。
 * @returns {Promise<void>} 完成
 */
async function main() {
	await domReady()
	dismissIframeNotice()
	setInterval(dismissIframeNotice, 4000)
	const app = new App({ embedded: isBridged })
	try {
		await app.init()
	} catch (error) {
		console.error('[akinator-auto-runner] 初始化失败', error)
	}
	// 在 akinator 的游戏页上接管问答（非游戏页静默跳过）。
	new PageMirror(app).mount()
	if (isBridged) new Bridge(app).start()
	else {
		const ui = new PanelUI(app)
		await ui.mount()
		const ad = new AdSlot()
		await ad.mount()
		try {
			if (typeof GM_registerMenuCommand === 'function') {
				GM_registerMenuCommand(geti18n('settings.openPanel'), () => ui.toggleCollapsed())
				GM_registerMenuCommand(geti18n('debug.dump'), () => dumpPage(app))
			}
		} catch {
			/* 忽略菜单注册失败 */
		}
	}
	// 上一次在非游戏页点了开始时暂存的参数：跳转后在这里续跑。
	const pending = takePendingRun()
	if (pending) app.startRun(pending).catch((error) => console.error('[akinator-auto-runner]', error))
	// 没有「待运行」参数但歌单仍标记为播放中（跳转参数被消费 / 超时、或用户手动刷新）：
	// 把播放拉回正轨，别留下「唱片还在转、却不再答题」的空转状态。
	else if (!isBridged && app.playlist.active) app.resumePlaylist().catch((error) => console.error('[akinator-auto-runner]', error))
	const marker = { version: typeof GM_info !== 'undefined' ? GM_info.script.version : '0.0.0', top: !isBridged }
	window.__akinatorAutoRunner = marker
	window.__akinatorAutoRunnerApp = app
	if (typeof unsafeWindow !== 'undefined' && unsafeWindow) unsafeWindow.__akinatorAutoRunner = marker
}

main().catch((error) => console.error('[akinator-auto-runner]', error))
