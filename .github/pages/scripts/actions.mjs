/**
 * 站点数据动作：加载题库、订阅刷新、贡献角色。
 * @module site/scripts/actions
 */

import { DATA_BASE_URL, REPO_NEW_FILE_URL, USERSCRIPT_URL } from '../shared/constants.mjs'
import { writeFilesToDirectory } from '../shared/folder.mjs'
import { characterToDatabase, databaseToFiles, emptyDatabase, ensureDatabase } from '../shared/schema.mjs'
import { Store } from '../shared/store.mjs'
import { download, slugify } from '../shared/util.mjs'

import { elementById } from './lib/dom.mjs'
import { renderCharacters, renderPacks, renderRegionFilter, renderRunCharacters, renderStats, renderSubscriptions } from './render.mjs'
import { state } from './state.mjs'

/**
 * 加载一份 JSON 文本并写入云端库（按 id 覆盖 / 新增）。
 * @param {string} text JSON 文本
 * @param {{ url: string; name: string }} source 来源
 * @returns {number} 写入角色数
 */
export function loadText(text, source) {
	const database = ensureDatabase(JSON.parse(text), source.name)
	return state.pageStore.upsertDatabase(database)
}

/**
 * 重新加载全部角色视图。
 * @returns {Promise<void>} 完成
 */
export function refreshViews() {
	return Promise.all([renderCharacters(), renderRunCharacters(), renderRegionFilter(), renderStats()])
}

/**
 * 加载题库清单与默认题库。
 *
 * 清单里 `characters` 是单角色文件（推荐），`packs` 是成组题库包（兼容旧格式）。
 * @returns {Promise<void>} 完成
 */
export async function loadPacks() {
	const candidates = ['./data/index.json', `${DATA_BASE_URL}index.json`]
	let indexUrl = ''
	for (const candidate of candidates)
		try {
			const response = await fetch(candidate, { cache: 'no-cache' })
			if (!response.ok) continue
			const index = await response.json()
			const entries = Array.isArray(index.characters) ? index.characters : Array.isArray(index.packs) ? index.packs : []
			state.packs = entries.map((pack) => ({ ...pack, url: new URL(pack.url, new URL(candidate, location.href)).href }))
			indexUrl = candidate
			break
		} catch {
			/* 尝试下一个地址 */
		}

	if (!indexUrl) state.packs = []
	for (const pack of state.packs)
		try {
			const response = await fetch(pack.url, { cache: 'no-cache' })
			if (!response.ok) throw new Error(`HTTP ${response.status}`)
			loadText(await response.text(), { url: pack.url, name: pack.name })
		} catch (error) {
			console.warn('加载题库失败', pack.url, error)
		}

	renderPacks()
	await refreshViews()
}

/**
 * 重新加载云端题库（清空后重来）。
 * @returns {void}
 */
export function reloadPacks() {
	state.pageStore = new Store(emptyDatabase('packs'))
	loadPacks()
}

/**
 * 更新一条订阅。
 * @param {string} id 订阅 id
 * @returns {void}
 */
export function refreshSubscription(id) {
	const subscription = state.subscriptions.find((item) => item.id === id)
	if (!subscription) return
	fetch(subscription.url, { cache: 'no-cache' })
		.then((response) => response.text())
		.then((text) => {
			loadText(text, { url: subscription.url, name: subscription.name })
			refreshViews()
		})
		.catch((error) => alert(String(error)))
}

/**
 * 刷新全部订阅。
 * @returns {void}
 */
export function refreshSubscriptions() {
	for (const subscription of state.subscriptions) refreshSubscription(subscription.id)
}

/**
 * 生成当前选中角色的单角色 JSON。
 * @param {string} id 角色 id
 * @returns {string} JSON 文本
 */
export function characterJson(id) {
	const character = state.pageStore.getCharacter(id) ?? state.remoteStore.getCharacter(id)
	if (!character) return ''
	return JSON.stringify(characterToDatabase(character, character.id), null, '\t')
}

/**
 * 打开 GitHub 新建文件页面以贡献角色。
 * @param {string} id 角色 id
 * @returns {void}
 */
export function contributeToGithub(id) {
	const text = characterJson(id)
	if (!text) return
	const character = state.pageStore.getCharacter(id) ?? state.remoteStore.getCharacter(id)
	const path = `data/characters/${slugify(character?.name ?? id)}.json`
	const url = `${REPO_NEW_FILE_URL}/${path}?filename=${encodeURIComponent(character?.name ?? id)}.json&value=${encodeURIComponent(text)}`
	window.open(url, '_blank', 'noopener')
}

/**
 * 下载某角色的 JSON。
 * @param {string} id 角色 id
 * @returns {void}
 */
export function downloadCharacter(id) {
	const character = state.pageStore.getCharacter(id) ?? state.remoteStore.getCharacter(id)
	download(`${slugify(character?.name ?? 'character')}.json`, characterJson(id))
}

/**
 * 导出当前云端库为一个文件夹：索引 JSON + `characters/` 下每个角色一个 JSON。
 *
 * 支持 File System Access API 时让用户选目录写入；否则逐个下载文件作为降级。
 * @returns {Promise<void>} 完成
 */
export async function exportDatabase() {
	const files = databaseToFiles(state.pageStore.db)
	if (typeof window.showDirectoryPicker === 'function') {
		const root = await window.showDirectoryPicker({ mode: 'readwrite' })
		await writeFilesToDirectory(root, files)
	} else
		for (const [path, text] of Object.entries(files)) download(path.split('/').pop() ?? 'character.json', text)
}

/**
 * 初始化安装链接与订阅列表。
 * @returns {Promise<void>} 完成
 */
export async function initDataControls() {
	const install = elementById('install')
	if (install instanceof HTMLAnchorElement) install.href = USERSCRIPT_URL
	await renderSubscriptions()
}
