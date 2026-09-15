/**
 * 极简 IndexedDB 封装：用于持久化本地文件句柄与降级数据。
 * @module userscript/idb
 */

const DB_NAME = 'akinator-auto-runner'
const DB_VERSION = 1
const STORES = ['handles', 'data']

/** @type {Promise<IDBDatabase> | undefined} */
let dbPromise

/**
 * 打开（或创建）数据库。
 * @returns {Promise<IDBDatabase>} 数据库连接
 */
function openIdb() {
	if (!dbPromise)
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION)
			/**
			 * 首次创建时建立对象仓库。
			 * @returns {void} 无
			 */
			request.onupgradeneeded = () => {
				const db = request.result
				for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
			}
			/**
			 * 打开成功。
			 * @returns {void} 无
			 */
			request.onsuccess = () => {
				resolve(request.result)
			}
			/**
			 * 打开失败。
			 * @returns {void} 无
			 */
			request.onerror = () => {
				reject(request.error)
			}
		})
	return dbPromise
}

/**
 * 执行一次事务。
 * @param {string} store 存储名
 * @param {IDBTransactionMode} mode 模式
 * @param {(store: IDBObjectStore) => IDBRequest} work 操作
 * @returns {Promise<unknown>} 请求结果
 */
async function run(store, mode, work) {
	const db = await openIdb()
	return await new Promise((resolve, reject) => {
		const transaction = db.transaction(store, mode)
		const request = work(transaction.objectStore(store))
		/**
		 * 事务成功。
		 * @returns {void} 无
		 */
		request.onsuccess = () => {
			resolve(request.result)
		}
		/**
		 * 事务失败。
		 * @returns {void} 无
		 */
		request.onerror = () => {
			reject(request.error)
		}
	})
}

/**
 * 读取一个值。
 * @param {string} store 存储名
 * @param {string} key 键
 * @returns {Promise<unknown>} 值
 */
export function idbGet(store, key) {
	return run(store, 'readonly', (objectStore) => objectStore.get(key))
}

/**
 * 写入一个值。
 * @param {string} store 存储名
 * @param {string} key 键
 * @param {unknown} value 值
 * @returns {Promise<unknown>} 结果
 */
export function idbSet(store, key, value) {
	return run(store, 'readwrite', (objectStore) => objectStore.put(value, key))
}

/**
 * 删除一个键。
 * @param {string} store 存储名
 * @param {string} key 键
 * @returns {Promise<unknown>} 结果
 */
export function idbDelete(store, key) {
	return run(store, 'readwrite', (objectStore) => objectStore.delete(key))
}

/** 存储名常量。 */
export const IdbStore = {
	handles: 'handles',
	data: 'data',
}
