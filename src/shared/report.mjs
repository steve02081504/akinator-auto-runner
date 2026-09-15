/**
 * 日志报告：把运行日志整理成可下载的纯文本，便于汇报与排查问题。
 *
 * 站点与油猴共用（环境无关）。报告刻意用简洁的英文键，方便直接贴进 issue。
 * @module shared/report
 */

/**
 * 补零到两位。
 * @param {number} value 数值
 * @returns {string} 两位字符串
 */
function pad2(value) {
	return String(value).padStart(2, '0')
}

/**
 * 把时间戳格式化为本地时间字符串。
 * @param {number} timestamp 毫秒时间戳
 * @returns {string} `YYYY-MM-DD HH:MM:SS`
 */
export function formatTimestamp(timestamp) {
	const date = new Date(Number(timestamp) || Date.now())
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/**
 * 生成用于文件名的时间戳（无分隔符）。
 * @param {number} [timestamp] 毫秒时间戳
 * @returns {string} `YYYYMMDD-HHMMSS`
 */
export function fileStamp(timestamp = Date.now()) {
	const date = new Date(timestamp)
	return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
}

/**
 * 生成日志报告文本。
 * @param {Record<string, string | number | undefined>} meta 报告头部的键值对（按插入顺序输出）
 * @param {Aki.LogEntry[]} entries 日志条目
 * @param {{ includeJson?: boolean }} [options] 选项
 * @returns {string} 报告文本
 */
export function formatLogReport(meta, entries, options = {}) {
	const lines = ['Akinator Auto Runner — log report']
	lines.push(`generated: ${formatTimestamp(Date.now())}`)
	for (const [key, value] of Object.entries(meta)) {
		if (value === undefined || value === '') continue
		lines.push(`${key}: ${value}`)
	}
	lines.push('', `--- logs (${entries.length}) ---`)
	for (const entry of entries)
		lines.push(`[${formatTimestamp(entry.time)}] [${entry.level}] ${entry.message}`)

	if (options.includeJson !== false)
		lines.push('', '--- json ---', JSON.stringify(entries, null, '\t'))

	return `${lines.join('\n')}\n`
}
