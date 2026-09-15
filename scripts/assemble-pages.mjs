/**
 * 组装 GitHub Pages 产物：把站点源头 `.github/pages/` 与它引用的共享代码、
 * 题库、油猴产物收拢到同一个可静态服务的目录。
 *
 * 站点源头不打包（fount 同款目录复用），脚本里用 `../shared/*.mjs` 引用核心；
 * 浏览器会把越出站点根的 `..` 钳回根，所以把 `src/shared/` 放到站点根的
 * `shared/` 即可让站点与油猴共用同一份源码。
 *
 * 默认就地组装进 `.github/pages/`（CI 部署用，产物已被 git 忽略），
 * 本地开发不必跑：`npm run build` 只出油猴脚本，站点直接开 `.github/pages/` 预览即可。
 * @module scripts/assemble-pages
 */

import { existsSync } from 'node:fs'
import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Pages 站点源头目录，也是默认的组装输出目录。 */
export const PAGES_SOURCE = resolve(root, '.github/pages')

/**
 * 组装站点到 `outDir`，可直接作为 Pages artifact 上传。
 *
 * 就地组装（`outDir` 即站点源头）时只补进依赖；别的目录则先整棵拷过去，
 * 便于测试用干净临时目录。
 * @param {string} [outDir] 输出目录，默认 `.github/pages/`
 * @returns {Promise<string>} 输出目录绝对路径
 */
export async function assemblePages(outDir = PAGES_SOURCE) {
	const out = resolve(outDir)
	if (out !== PAGES_SOURCE) {
		await rm(out, { recursive: true, force: true })
		await cp(PAGES_SOURCE, out, { recursive: true })
	}
	await mkdir(out, { recursive: true })
	await cp(resolve(root, 'src/shared'), resolve(out, 'shared'), { recursive: true })
	if (existsSync(resolve(root, 'data')))
		await cp(resolve(root, 'data'), resolve(out, 'data'), { recursive: true })
	const userjs = resolve(root, 'dist/akinator-auto-runner.user.js')
	if (existsSync(userjs))
		await cp(userjs, resolve(out, 'akinator-auto-runner.user.js'))
	return out
}

/**
 * 命令行入口：组装到第一个参数指定的目录（默认 `.github/pages/`）。
 * @returns {Promise<void>} 完成
 */
async function main() {
	console.log(`assembled pages at ${await assemblePages(process.argv[2])}`)
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url))
	main().catch((err) => {
		console.error(err)
		process.exitCode = 1
	})
