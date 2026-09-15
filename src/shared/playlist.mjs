/**
 * 本机「歌单」：把要挂机回放的角色排成播放队列，支持循环 / 随机 / 单曲三种播放模式。
 *
 * 和「厨力」「角色运行状态」一样属于本机运行期信息，只在本地保存，不进入题库数据。
 * @module shared/playlist
 */

import { asArray, asRecord } from './util.mjs'

/** 播放模式：`loop`=顺序循环、`shuffle`=随机播放、`single`=单曲循环。 */
export const PLAYLIST_MODES = ['loop', 'shuffle', 'single']

/**
 * 创建一个空歌单。
 * @returns {Aki.Playlist} 空歌单
 */
export function emptyPlaylist() {
	return { ids: [], mode: 'loop', active: false, currentId: '' }
}

/**
 * 归一化一个可能来自存储的歌单。
 * @param {unknown} value 输入
 * @returns {Aki.Playlist} 歌单
 */
export function ensurePlaylist(value) {
	const playlist = emptyPlaylist()
	if (!value || typeof value !== 'object') return playlist
	const raw = asRecord(value)
	const ids = [...new Set(asArray(raw.ids).map(String).filter(Boolean))]
	playlist.ids = ids
	playlist.mode = PLAYLIST_MODES.includes(String(raw.mode)) ? String(raw.mode) : 'loop'
	const currentId = String(raw.currentId ?? '')
	playlist.currentId = ids.includes(currentId) ? currentId : ''
	playlist.active = !!raw.active && ids.length > 0
	return playlist
}

/**
 * 判断某角色是否在歌单里。
 * @param {Aki.Playlist} playlist 歌单
 * @param {string | undefined} id 角色 id
 * @returns {boolean} 是否在歌单
 */
export function hasInPlaylist(playlist, id) {
	return !!id && playlist.ids.includes(id)
}

/**
 * 把角色加入歌单（已在其中则不动）。
 * @param {Aki.Playlist} playlist 歌单
 * @param {string | undefined} id 角色 id
 * @returns {Aki.Playlist} 歌单
 */
export function addToPlaylist(playlist, id) {
	if (id && !playlist.ids.includes(id)) playlist.ids.push(id)
	return playlist
}

/**
 * 把角色移出歌单；移出当前曲目 / 移空后同步重置播放状态。
 * @param {Aki.Playlist} playlist 歌单
 * @param {string | undefined} id 角色 id
 * @returns {Aki.Playlist} 歌单
 */
export function removeFromPlaylist(playlist, id) {
	playlist.ids = playlist.ids.filter((item) => item !== id)
	if (playlist.currentId === id) playlist.currentId = ''
	if (!playlist.ids.length) playlist.active = false
	return playlist
}

/**
 * 加入 / 移出歌单（角色卡上的「加入歌单」按钮）。
 * @param {Aki.Playlist} playlist 歌单
 * @param {string | undefined} id 角色 id
 * @returns {Aki.Playlist} 歌单
 */
export function toggleInPlaylist(playlist, id) {
	return hasInPlaylist(playlist, id) ? removeFromPlaylist(playlist, id) : addToPlaylist(playlist, id)
}

/**
 * 计算切歌 / 自动续播的目标角色。
 *
 * - `single` 自动续播时恒为当前曲目（单曲循环）；手动切歌仍按列表前后移动。
 * - `shuffle` 随机挑一个（尽量避开当前曲目），手动与自动一致。
 * - `loop` 在列表里前后移动并回绕。
 * @param {Aki.Playlist} playlist 歌单
 * @param {{ direction?: number; auto?: boolean; random?: () => number }} [options] 选项
 * @returns {string} 目标角色 id；歌单为空时为空串
 */
export function nextTrackId(playlist, options = {}) {
	const { ids } = playlist
	if (!ids.length) return ''
	const direction = Number(options.direction) < 0 ? -1 : 1
	const random = options.random ?? Math.random
	if (playlist.mode === 'shuffle') {
		if (ids.length === 1) return ids[0]
		const candidates = playlist.currentId ? ids.filter((id) => id !== playlist.currentId) : ids
		return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))] ?? ids[0]
	}
	if (options.auto && playlist.mode === 'single' && playlist.currentId) return playlist.currentId
	const index = ids.indexOf(playlist.currentId)
	if (index < 0) return direction > 0 ? ids[0] : ids[ids.length - 1]
	return ids[(index + direction + ids.length) % ids.length]
}
