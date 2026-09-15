/* global unsafeWindow */

/**
 * 让 akinator 页面在窗口被遮挡 / 标签切到后台时也继续推进。
 *
 * akinator 的切题过渡由页面自身的动画驱动（多半走 `requestAnimationFrame`）。窗口被遮挡或
 * 标签切到后台时，浏览器会暂停 / 节流 rAF 与定时器，页面就永远停在「旧题收起、新题未出」的
 * 过渡态，脚本只能等到超时。这里从两个层面兜底（都幂等、都不影响正常前台行为）：
 *
 * - 覆盖 `document.hidden` / `visibilityState` / `hasFocus` 等只读属性，并补发一次
 *   `visibilitychange` / `focus`，让「读到隐藏就暂停」的页面逻辑误以为仍在前台。
 * - 把页面窗口的 `requestAnimationFrame` 换成 `setTimeout` 版，绕开浏览器对遮挡窗口的
 *   rAF 暂停（被完全隐藏的标签里 `setTimeout` 仍会被节流，但比 rAF 全停好得多）。
 *
 * 注意：浏览器对隐藏标签的定时器节流发生在调度层，**改 JS 里的 `visibilityState` 骗不过它**，
 * 所以必须同时换掉 rAF 才有意义。
 * @module userscript/foreground
 */

/** rAF 替身每帧的毫秒数（近似 60fps）。 */
const FRAME_MS = 16

/** 是否已安装（幂等）。 */
let installed = false

/**
 * 取页面窗口；油猴沙箱里真身是 `unsafeWindow`。
 * @returns {Window & typeof globalThis} 页面窗口
 */
function pageWindow() {
	try {
		if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow
	} catch {
		/* 取不到就用当前 window */
	}
	return window
}

/**
 * 覆盖一个只读属性（读取时总返回设定值），失败时忽略。
 * @param {object} target 目标对象
 * @param {string} key 属性名
 * @param {() => unknown} getter 取值函数
 * @returns {void} 无
 */
function overrideGetter(target, key, getter) {
	try {
		Object.defineProperty(target, key, { configurable: true, get: getter })
	} catch {
		/* 覆盖失败时忽略 */
	}
}

/**
 * 覆盖一个方法 / 值属性，失败时忽略。
 * @param {object} target 目标对象
 * @param {string} key 属性名
 * @param {unknown} value 新值
 * @returns {void} 无
 */
function overrideValue(target, key, value) {
	try {
		Object.defineProperty(target, key, { configurable: true, writable: true, value })
	} catch {
		/* 覆盖失败时忽略 */
	}
}

/**
 * 把页面窗口的 `requestAnimationFrame` 换成 `setTimeout` 版（幂等）。
 * @param {Window & typeof globalThis} win 页面窗口
 * @returns {void} 无
 */
function shimAnimationFrame(win) {
	const original = win.requestAnimationFrame
	if (typeof original !== 'function' || original.__akinatorAutoRunnerRafShim) return
	const setTimer = win.setTimeout.bind(win)
	const clearTimer = win.clearTimeout.bind(win)
	/**
	 * `setTimeout` 版的 requestAnimationFrame：遮挡窗口里也照常回调。
	 * @param {(timestamp: number) => void} callback 回调
	 * @returns {number} 定时器 id
	 */
	const shim = (callback) => setTimer(() => {
		try {
			callback(win.performance.now())
		} catch (error) {
			console.error('[akinator-auto-runner]', error)
		}
	}, FRAME_MS)
	shim.__akinatorAutoRunnerRafShim = true
	/**
	 * 取消一个由 rAF 替身排定的回调。
	 * @param {number} id 定时器 id
	 * @returns {void} 无
	 */
	function cancelShim(id) {
		clearTimer(id)
	}
	try {
		win.requestAnimationFrame = shim
		win.cancelAnimationFrame = cancelShim
	} catch {
		/* 页面不允许改写时忽略 */
	}
}

/**
 * 让 akinator 页面误以为自己在前台（幂等）。
 * @returns {void} 无
 */
export function keepPageForeground() {
	if (installed) return
	installed = true
	const win = pageWindow()
	const doc = win.document
	overrideGetter(doc, 'hidden', () => false)
	overrideGetter(doc, 'visibilityState', () => 'visible')
	overrideGetter(doc, 'webkitHidden', () => false)
	overrideGetter(doc, 'webkitVisibilityState', () => 'visible')
	overrideGetter(doc, 'mozHidden', () => false)
	overrideGetter(doc, 'mozVisibilityState', () => 'visible')
	overrideValue(doc, 'hasFocus', () => true)
	shimAnimationFrame(win)
	try {
		doc.dispatchEvent(new Event('visibilitychange'))
		win.dispatchEvent(new Event('focus'))
	} catch {
		/* 补发失败时忽略 */
	}
}
