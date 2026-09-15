/* global unsafeWindow */

/**
 * 持久化：本地文件夹（File System Access API）与 IndexedDB 降级、云端拉取。
 * @module userscript/persistence
 */

import { readDatabaseFromDirectory, writeDatabaseToDirectory } from '../shared/folder.mjs'
import { ensureDatabase } from '../shared/schema.mjs'
import { asRecord } from '../shared/util.mjs'

import { IdbStore, idbDelete, idbGet, idbSet } from './idb.mjs'

/**
 * 取页面窗口；油猴沙箱里 `window` 是沙箱代理，直接拿它当 `this` 调原生 File System Access API
 * 会抛「Illegal invocation」，必须用真身 `unsafeWindow`。
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

/** 是否支持目录访问（文件夹链接 / 导出需要）。 */
export const supportsDirectoryAccess = typeof window !== 'undefined' && typeof pageWindow().showDirectoryPicker === 'function'

const HANDLE_KEY = 'local-folder'
const FALLBACK_KEY = 'fallback-database'

/**
 * 让用户选择一个目录。
 * 必须用页面窗口的真身调用原生 API，否则油猴沙箱里会抛「Illegal invocation」。
 * @returns {Promise<FileSystemDirectoryHandle>} 目录句柄
 */
export async function pickDirectory() {
	const picker = pageWindow().showDirectoryPicker
	if (typeof picker !== 'function') throw new Error('showDirectoryPicker is unavailable')
	return await picker.call(pageWindow(), { mode: 'readwrite' })
}

/**
 * 判断一个值是否像目录句柄。
 * @param {unknown} value 值
 * @returns {value is FileSystemDirectoryHandle} 是否是目录句柄
 */
function isDirectoryHandle(value) {
	return !!value && typeof value === 'object' && typeof asRecord(value).getDirectoryHandle === 'function'
}

/**
 * 本地文件夹数据库包装。
 *
 * 链接的文件夹就是题库本体：`index.json` 列出各角色文件，`characters/*.json` 每个一个角色；
 * 任何改动都会写回文件夹。浏览器不支持时降级为 IndexedDB 自动保存。
 */
export class LocalFolderDatabase {
	/** 创建本地文件夹数据库包装（初始未绑定句柄）。 */
	constructor() {
		/** @type {FileSystemDirectoryHandle | undefined} */
		this.handle = undefined
		/** @type {boolean} */
		this.fallbackMode = false
	}

	/** @returns {string} 当前数据源名称 */
	get name() {
		return this.handle?.name ?? (this.fallbackMode ? 'IndexedDB 自动保存' : '未链接文件夹')
	}

	/**
	 * 尝试恢复上次链接的文件夹句柄（不弹窗）。
	 * @returns {Promise<boolean>} 是否恢复成功
	 */
	async restore() {
		const stored = await idbGet(IdbStore.handles, HANDLE_KEY)
		if (!isDirectoryHandle(stored)) return false
		this.handle = stored
		const permission = await this.handle.queryPermission({ mode: 'readwrite' })
		return permission === 'granted'
	}

	/**
	 * 重新申请文件夹写入权限（须在用户手势中调用）。
	 * @returns {Promise<boolean>} 是否已授权
	 */
	async ensurePermission() {
		if (!this.handle) return false
		if (await this.handle.queryPermission({ mode: 'readwrite' }) === 'granted') return true
		return await this.handle.requestPermission({ mode: 'readwrite' }) === 'granted'
	}

	/**
	 * 让用户选择一个文件夹并读取其中的题库。
	 * @returns {Promise<Aki.Database>} 题库
	 */
	async link() {
		const handle = await pickDirectory()
		this.handle = handle
		this.fallbackMode = false
		await idbSet(IdbStore.handles, HANDLE_KEY, handle)
		return await this.read() ?? ensureDatabase({}, handle.name)
	}

	/**
	 * 读取当前文件夹（或 IndexedDB 降级）里的题库。
	 * @returns {Promise<Aki.Database | undefined>} 题库；空时为 undefined
	 */
	async read() {
		if (this.handle)
			try {
				return await readDatabaseFromDirectory(this.handle, this.handle.name)
			} catch {
				return undefined
			}
		const fallback = await idbGet(IdbStore.data, FALLBACK_KEY)
		if (!fallback) return undefined
		try {
			return ensureDatabase(typeof fallback === 'string' ? JSON.parse(fallback) : fallback, 'IndexedDB')
		} catch {
			return undefined
		}
	}

	/**
	 * 写入当前文件夹；无句柄时降级写入 IndexedDB。
	 * @param {Aki.Database} database 题库
	 * @returns {Promise<boolean>} 是否写入到真实文件夹
	 */
	async write(database) {
		if (this.handle && await this.ensurePermission()) {
			await writeDatabaseToDirectory(this.handle, database)
			return true
		}
		this.fallbackMode = true
		await idbSet(IdbStore.data, FALLBACK_KEY, database)
		return false
	}

	/**
	 * 断开当前文件夹。
	 * @returns {Promise<void>} 完成
	 */
	async forget() {
		this.handle = undefined
		this.fallbackMode = false
		await idbDelete(IdbStore.handles, HANDLE_KEY)
	}
}

/**
 * 以文本形式拉取一个 JSON 地址。
 * @param {string} url 地址
 * @returns {Promise<string>} 文本
 */
export async function fetchJsonText(url) {
	const response = await fetch(url, { credentials: 'omit', cache: 'no-cache' })
	if (!response.ok) throw new Error(`拉取失败：HTTP ${response.status} ${url}`)
	return await response.text()
}
