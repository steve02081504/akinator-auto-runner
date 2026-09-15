/**
 * 文件夹读写（File System Access API）：把题库拆成 `index.json` + `characters/*.json`。
 *
 * 句柄由调用方通过 `showDirectoryPicker` 取得：油猴沙箱里必须用 `unsafeWindow`
 * 的真身调用原生 API，站点侧直接用 `window`，因此这里只接收句柄、不碰窗口。
 * @module shared/folder
 */

import { databaseToFiles, emptyDatabase, ensureDatabase } from './schema.mjs'

/** 角色文件所在的子目录名。 */
export const CHARACTERS_DIR = 'characters'

/** 索引文件名。 */
export const INDEX_FILE = 'index.json'

/**
 * 读取目录里的一个文本文件。
 * @param {FileSystemDirectoryHandle} directory 目录句柄
 * @param {string} name 文件名
 * @returns {Promise<string>} 文本
 */
async function readTextFile(directory, name) {
	const handle = await directory.getFileHandle(name)
	const file = await handle.getFile()
	return await file.text()
}

/**
 * 按相对路径读取文本文件，逐级进入子目录。
 * @param {FileSystemDirectoryHandle} root 根目录句柄
 * @param {string} path 以 `/` 分隔的相对路径
 * @returns {Promise<string>} 文本
 */
async function readTextFileByPath(root, path) {
	const segments = path.split('/').filter(Boolean)
	let directory = root
	for (const segment of segments.slice(0, -1)) directory = await directory.getDirectoryHandle(segment)
	return await readTextFile(directory, segments[segments.length - 1])
}

/**
 * 读取文件夹里的题库：`index.json` 列出各角色文件，逐个读取。
 *
 * 单个角色文件缺失 / 坏掉时跳过，不拖垮整个题库。
 * @param {FileSystemDirectoryHandle} root 根目录句柄
 * @param {string} [name] 兜底名称
 * @returns {Promise<Aki.Database>} 题库
 */
export async function readDatabaseFromDirectory(root, name) {
	const index = JSON.parse(await readTextFile(root, INDEX_FILE))
	const database = emptyDatabase(String(index.name ?? name ?? 'folder'))
	database.updatedAt = Number(index.updatedAt) || database.updatedAt
	const entries = Array.isArray(index.characters) ? index.characters : Array.isArray(index.packs) ? index.packs : []
	for (const entry of entries) {
		const path = String(entry?.url ?? '').replace(/^\.\//, '')
		if (!path) continue
		try {
			const parsed = ensureDatabase(JSON.parse(await readTextFileByPath(root, path)), entry.name)
			for (const [id, character] of Object.entries(parsed.characters))
				if (!database.characters[id]) database.characters[id] = character
		} catch {
			/* 跳过读不到的角色文件 */
		}
	}
	return database
}

/**
 * 把「相对路径 → 文本」写入目录句柄，逐级创建子目录与文件。
 * @param {FileSystemDirectoryHandle} root 目标目录句柄
 * @param {Record<string, string>} files 相对路径（以 `/` 分隔）→ 文件文本
 * @returns {Promise<void>} 完成
 */
export async function writeFilesToDirectory(root, files) {
	for (const [path, text] of Object.entries(files)) {
		const segments = path.split('/').filter(Boolean)
		if (!segments.length) continue
		let directory = root
		for (const segment of segments.slice(0, -1))
			directory = await directory.getDirectoryHandle(segment, { create: true })
		const handle = await directory.getFileHandle(segments[segments.length - 1], { create: true })
		const writable = await handle.createWritable()
		await writable.write(text)
		await writable.close()
	}
}

/**
 * 把题库写入目录，并清掉 `characters/` 里已不在题库中的旧角色文件。
 * @param {FileSystemDirectoryHandle} root 目标目录句柄
 * @param {Aki.Database} database 题库
 * @returns {Promise<void>} 完成
 */
export async function writeDatabaseToDirectory(root, database) {
	const files = databaseToFiles(database)
	await writeFilesToDirectory(root, files)
	const keep = new Set(Object.keys(files).filter((path) => path.startsWith(`${CHARACTERS_DIR}/`)).map((path) => path.slice(CHARACTERS_DIR.length + 1)))
	try {
		const directory = await root.getDirectoryHandle(CHARACTERS_DIR)
		for await (const name of directory.keys())
			if (!keep.has(name)) await directory.removeEntry(name)
	} catch {
		/* 还没有 characters 目录时跳过清理 */
	}
}
