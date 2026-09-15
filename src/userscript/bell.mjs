/* global GM_notification */

/**
 * 响铃与桌面通知：遇到未记录问题时提醒用户补充数据。
 * @module userscript/bell
 */

/** @type {AudioContext | undefined} */
let audioContext
/** @type {ReturnType<typeof setInterval> | undefined} */
let ringTimer
/** @type {boolean} */
let ringing = false

/**
 * 播放一声短促铃音。
 * @returns {void}
 */
function beep() {
	try {
		audioContext = audioContext ?? new AudioContext()
		const oscillator = audioContext.createOscillator()
		const gain = audioContext.createGain()
		oscillator.type = 'sine'
		oscillator.frequency.value = 880
		gain.gain.setValueAtTime(0.0001, audioContext.currentTime)
		gain.gain.exponentialRampToValueAtTime(0.25, audioContext.currentTime + 0.02)
		gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.35)
		oscillator.connect(gain).connect(audioContext.destination)
		oscillator.start()
		oscillator.stop(audioContext.currentTime + 0.4)
	} catch {
		/* 无音频权限时忽略 */
	}
}

/**
 * 开始响铃并尝试通知。
 * @param {string} title 标题
 * @param {string} body 内容
 * @returns {void}
 */
export function ringBell(title, body) {
	if (ringing) return
	ringing = true
	beep()
	ringTimer = setInterval(beep, 1400)
	try {
		if (typeof GM_notification === 'function') GM_notification({ title, text: body, timeout: 8000 })
		else if (typeof Notification === 'function' && Notification.permission === 'granted') new Notification(title, { body })
	} catch {
		/* 忽略通知失败 */
	}
}

/**
 * 停止响铃。
 * @returns {void}
 */
export function stopBell() {
	if (ringTimer !== undefined) {
		clearInterval(ringTimer)
		ringTimer = undefined
	}
	ringing = false
}

/**
 * 请求桌面通知权限（可选）。
 * @returns {void}
 */
export function requestNotificationPermission() {
	try {
		if (typeof Notification === 'function' && Notification.permission === 'default') Notification.requestPermission()
	} catch {
		/* 忽略 */
	}
}
