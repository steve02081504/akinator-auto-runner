/**
 * 类人延时：把一个「平均每步耗时」换算成一次自动选择实际要等的时间。
 *
 * 单纯的固定延时一眼就能看出是机器人，这里叠了三种扰动：
 * - 随机扰动：每次都在平均值上下浮动，避免均匀节拍；
 * - 时间扰动：半夜和中午本来就反应慢一点；
 * - 读题扰动：题目越长，读完再选自然越久。
 * @module shared/delay
 */

/** 随机扰动的相对幅度（平均值上下各浮动这么多）。 */
export const DELAY_JITTER = 0.3

/** 每多一个字符的额外「读题」时间（毫秒）。 */
export const DELAY_READING_MS_PER_CHAR = 20

/** 读题时间上限（毫秒），免得超长题目把一局拖死。 */
const DELAY_READING_MAX_MS = 3000

/** 半夜 / 中午反应变慢的峰值比例。 */
const DELAY_SLOWDOWN = 0.3

/**
 * 一天里某时刻的反应迟钝系数：凌晨（约 3 点）与午后（约 12:30）最慢，其余时间接近 1。
 * @param {Date} [date] 时刻
 * @returns {number} 系数（>= 1）
 */
export function timeOfDayFactor(date = new Date()) {
	const hour = date.getHours() + date.getMinutes() / 60
	return 1 + DELAY_SLOWDOWN * Math.max(bump(hour, 3, 3), bump(hour, 12.5, 1.5))
}

/**
 * 换算一次自动选择所需的毫秒数。
 * @param {number} baseMs 平均延时（毫秒）；<= 0 表示完全不延时
 * @param {{ textLength?: number; date?: Date; random?: () => number }} [options] 选项
 * @returns {number} 毫秒（>= 0）
 */
export function humanDelayMs(baseMs, options = {}) {
	const base = Number(baseMs)
	if (!Number.isFinite(base) || base <= 0) return 0
	const random = options.random ?? Math.random
	const jitter = 1 + (random() * 2 - 1) * DELAY_JITTER
	const reading = Math.min(DELAY_READING_MAX_MS, Math.max(0, Number(options.textLength ?? 0)) * DELAY_READING_MS_PER_CHAR)
	return Math.round(Math.max(0, base * jitter * timeOfDayFactor(options.date)) + reading)
}

/**
 * 以 `center` 为中心、宽 `width` 的三角权重（小时会绕回 24）。
 * @param {number} hour 时刻（小时，可为小数）
 * @param {number} center 中心时刻
 * @param {number} width 半宽
 * @returns {number} 权重（0..1）
 */
function bump(hour, center, width) {
	const distance = Math.abs(hour - center)
	const wrapped = Math.min(distance, 24 - distance)
	return Math.max(0, 1 - wrapped / width)
}
