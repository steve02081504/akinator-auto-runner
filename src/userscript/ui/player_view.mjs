/**
 * 播放器标签页的模板数据：歌单队列 + 网易云风唱片播放器。
 * @module userscript/ui/player_view
 */

import { icon } from '../../shared/icons.mjs'
import { geti18n } from '../i18n.mjs'

import { templates } from './templates.mjs'

/** 播放模式对应的 i18n 键与图标。 */
const PLAYLIST_MODES = {
	loop: { label: 'playlist.modeLoop', icon: 'repeat' },
	shuffle: { label: 'playlist.modeShuffle', icon: 'shuffle' },
	single: { label: 'playlist.modeSingle', icon: 'repeat-1' },
}

/**
 * 把值夹到 0..100 的整数。
 * @param {unknown} value 输入
 * @returns {number} 百分比
 */
function clampPercent(value) {
	const number = Number(value)
	if (!Number.isFinite(number)) return 0
	return Math.max(0, Math.min(100, Math.round(number)))
}

/**
 * 播放器进度条数值：取 akinator 的置信率（progression）。
 *
 * 当前曲目正在跑时用运行状态里的 progression，否则为 0（进度条随每步刷新）。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {number} 0..100
 */
export function playerProgress(ui) {
	const run = ui.runState
	const currentId = ui.app.playlist.currentId
	if (!run || (currentId && run.characterId !== currentId)) return 0
	return clampPercent(run.progression)
}

/**
 * 角色头像 HTML（唱片中心标签）。
 * @param {Aki.Character} character 角色
 * @returns {string} HTML
 */
function discPhoto(character) {
	if (character.image) return `<img class="aar-disc-photo" src="${character.image}" alt="" loading="lazy">`
	return `<span class="aar-disc-photo aar-disc-photo-empty">${icon('image', { size: 26 })}</span>`
}

/**
 * 播放器标签页数据。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {Promise<object>} 数据
 */
export async function playerData(ui) {
	const { app } = ui
	const { playlist } = app
	const current = playlist.currentId ? app.store.getCharacter(playlist.currentId) : undefined
	const playing = playlist.active
	const progress = playerProgress(ui)
	const mode = PLAYLIST_MODES[playlist.mode] ?? PLAYLIST_MODES.loop
	const tracks = playlist.ids.length
		? await templates.renderListAsHtmlString('playlist-track', await Promise.all(playlist.ids.map(async (id, index) => {
			const character = app.store.getCharacter(id)
			if (!character) return undefined
			return {
				id,
				index: index + 1,
				image: character.image
					? `<img class="aar-avatar" src="${character.image}" alt="" loading="lazy">`
					: `<span class="aar-avatar aar-avatar-empty">${icon('image', { size: 18 })}</span>`,
				name: character.name,
				questionCount: geti18n('characters.questionCount', { count: Object.keys(character.answers).length }),
				current: character.id === playlist.currentId,
				playIcon: icon('play', { size: 13 }),
				removeIcon: icon('x', { size: 13 }),
			}
		})))
		: await templates.renderListAsHtmlString('message', [{ text: geti18n('playlist.empty'), icon: icon('list-music', { size: 24 }) }])
	const position = current ? playlist.ids.indexOf(current.id) + 1 : 0
	return {
		discClass: playing ? 'playing' : '',
		avatar: current ? discPhoto(current) : `<span class="aar-disc-photo aar-disc-photo-empty">${icon('disc', { size: 30 })}</span>`,
		title: current ? current.name : geti18n('playlist.idle'),
		subtitle: current ? geti18n('playlist.position', { index: position, count: playlist.ids.length }) : geti18n('playlist.hint'),
		progress,
		percentLabel: geti18n('playlist.percent', { percent: progress }),
		playIcon: icon(playing ? 'pause' : 'play', { size: 16 }),
		playAction: playing ? 'playlist-pause' : 'playlist-play',
		playTitle: playing ? 'playlist.pause' : 'playlist.play',
		prevIcon: icon('skip-back', { size: 15 }),
		nextIcon: icon('skip-forward', { size: 15 }),
		modeIcon: icon(mode.icon, { size: 13 }),
		modeLabel: geti18n(mode.label),
		modeTitle: 'playlist.switchMode',
		listIcon: icon('list-music', { size: 14 }),
		countLabel: geti18n('playlist.count', { count: playlist.ids.length }),
		clearIcon: icon('trash', { size: 13 }),
		tracks,
	}
}
