/**
 * 站点 ↔ 油猴脚本的 postMessage 协议。
 *
 * 站点用 `window.open` 打开 akinator 窗口（akinator 以 `X-Frame-Options: SAMEORIGIN`
 * 拒绝被 iframe 嵌入）；脚本在 akinator 源内运行，两者通过 window.postMessage
 * 交换数据库与运行事件。若脚本未安装，站点收不到 pong，从而显示安装引导。
 * @module shared/protocol
 */

import { asRecord } from './util.mjs'

/** 消息来源标记，用于过滤无关消息。 */
export const CHANNEL = 'aki-auto-runner'

/** 消息类型。 */
export const MessageType = {
	/** 站点 → 脚本：探测脚本是否存在。 */
	ping: 'ping',
	/** 脚本 → 站点：脚本存在。 */
	pong: 'pong',
	/** 站点 → 脚本：下发数据库与配置。 */
	init: 'init',
	/** 站点 → 脚本：下发指令（start / stop / answer / setDatabase）。 */
	command: 'command',
	/** 脚本 → 站点：状态快照。 */
	state: 'state',
	/** 脚本 → 站点：日志。 */
	log: 'log',
	/** 脚本 → 站点：数据库已变化。 */
	database: 'database',
	/** 脚本 → 站点：需要用户作答。 */
	ask: 'ask',
	/** 脚本 → 站点：akinator 给出候选，需要选择。 */
	proposal: 'proposal',
	/** 脚本 → 站点：自动决策前的类人延时开始 / 结束（载荷为 null 表示结束）。 */
	delay: 'delay',
	/** 脚本 → 站点：延时期间用户改选，等待「纠正 / 追加」的选择。 */
	intervention: 'intervention',
	/** 脚本 → 站点：akinator 认输。 */
	defeat: 'defeat',
	/** 脚本 → 站点：一次运行结束。 */
	result: 'result',
	/** 脚本 → 站点：一次「边录边建」结束，新角色已成型（或空占位被丢弃）。 */
	characterCreated: 'characterCreated',
	/** 脚本 → 站点：请求站点代为保存 / 下载数据库。 */
	request: 'request',
	/** 任一方向：错误。 */
	error: 'error',
}

/**
 * 构造一条消息。
 * @param {string} type 消息类型
 * @param {unknown} [payload] 载荷
 * @param {string} [id] 关联 id（用于请求/响应）
 * @returns {Aki.BridgeMessage} 消息
 */
function makeMessage(type, payload, id) {
	return { source: CHANNEL, type, id, payload }
}

/**
 * 判断一个值是否是本协议的消息。
 * @param {unknown} data 待判断的值
 * @returns {data is Aki.BridgeMessage} 是否匹配
 */
export function isMessage(data) {
	return !!data && typeof data === 'object' && asRecord(data).source === CHANNEL
}

/**
 * 向目标 window 发送消息。
 * @param {Window | null | undefined} target 目标窗口
 * @param {string} type 消息类型
 * @param {unknown} [payload] 载荷
 * @param {string} [id] 关联 id
 * @param {string} [targetOrigin] 目标来源，默认 `'*'`
 * @returns {void}
 */
export function post(target, type, payload, id, targetOrigin = '*') {
	if (!target || typeof target.postMessage !== 'function') return
	target.postMessage(makeMessage(type, payload, id), targetOrigin)
}
