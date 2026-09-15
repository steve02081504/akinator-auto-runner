import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { where_command } from '@steve02081504/exec'

import { assemblePages } from '../scripts/assemble-pages.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 仓库根目录。 */
export const root = path.resolve(__dirname, '..')

/** 构建产物中的油猴脚本路径。 */
export const USERSCRIPT = path.resolve(root, 'dist', 'akinator-auto-runner.user.js')

/**
 * 定位本机 Chromium 可执行路径。
 * @returns {Promise<string>} 可执行路径
 */
export async function locateChromium() {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH
	for (const name of ['chrome', 'chrome.exe', 'msedge', 'msedge.exe'])
		try {
			const executablePath = await where_command(name)
			if (executablePath) return executablePath
		} catch {
			/* 尝试下一个 */
		}

	throw new Error('未找到 Chrome / Edge，请设置 CHROME_PATH')
}

/**
 * 递归列出一个目录下的所有文件。
 * @param {string} directory 目录
 * @returns {string[]} 文件路径
 */
function listFiles(directory) {
	/** @type {string[]} */
	const files = []
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const full = path.join(directory, entry.name)
		if (entry.isDirectory()) files.push(...listFiles(full))
		else files.push(full)
	}
	return files
}

/**
 * 判断构建产物是否比所有输入都新（新则无需重复构建）。
 * @returns {boolean} 是否可直接复用
 */
function isBuildUpToDate() {
	/** @type {number} */
	let output
	try {
		output = statSync(USERSCRIPT).mtimeMs
	} catch {
		return false
	}
	const inputs = [path.join(root, 'scripts', 'build.mjs'), ...listFiles(path.join(root, 'src'))]
	return inputs.every((file) => {
		try {
			return statSync(file).mtimeMs <= output
		} catch {
			return true
		}
	})
}

/**
 * 构建最新产物：产物比源文件新时直接复用，避免一次 `npm test` 里
 * 每个测试文件（各自独立进程）都重新构建一遍。
 * @returns {void}
 */
export function ensureBuilt() {
	if (isBuildUpToDate()) return
	execFileSync(process.execPath, [path.resolve(root, 'scripts', 'build.mjs')], { stdio: 'inherit' })
}

/**
 * 构建油猴脚本并组装一份站点产物，供静态服务。
 *
 * 组装到临时目录，避免污染工作区（CI 里是就地组装 `.github/pages/`）。
 * @returns {Promise<string>} 站点目录
 */
export async function buildSite() {
	ensureBuilt()
	return assemblePages(await mkdtemp(path.join(tmpdir(), 'akinator-pages-')))
}

/** 常见扩展名的 MIME。 */
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
}

/**
 * 启动一个静态文件服务器。
 *
 * `prefix` 用于把站点挂在子路径下（GitHub Pages 项目站就是 `/<repo>/`），
 * 这样才能暴露「靠浏览器把越界 `..` 钳回站点根」侥幸能跑的相对路径错误。
 * @param {string} directory 目录
 * @param {string} [prefix] 挂载前缀，如 `/akinator-auto-runner`
 * @returns {Promise<{ origin: string; close: () => Promise<void> }>} 句柄
 */
export async function startStaticServer(directory, prefix = '') {
	const base = String(prefix).replace(/\/+$/, '')
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://localhost')
		let pathname = decodeURIComponent(url.pathname)
		if (base && pathname !== base && !pathname.startsWith(`${base}/`)) {
			response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
			response.end('not found')
			return
		}
		pathname = pathname.slice(base.length) || '/'
		if (pathname.endsWith('/')) pathname += 'index.html'
		const filePath = path.join(directory, pathname)
		if (!filePath.startsWith(directory) || !existsSync(filePath)) {
			response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
			response.end('not found')
			return
		}
		response.writeHead(200, { 'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream' })
		response.end(readFileSync(filePath))
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	const port = typeof address === 'object' && address ? address.port : 0
	return {
		origin: `http://127.0.0.1:${port}${base}`,
		/**
		 * 关闭服务器。
		 * @returns {Promise<void>} 完成
		 */
		close() {
			return new Promise((resolve) => server.close(() => resolve()))
		},
	}
}
