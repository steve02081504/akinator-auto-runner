import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

const OWNER = 'steve02081504'
const REPO = 'akinator-auto-runner'
const HOMEPAGE = `https://${OWNER}.github.io/${REPO}/`

const banner = `// ==UserScript==
// @name         Akinator Auto Runner
// @name:zh-CN   Akinator 全自动答题助手
// @namespace    https://github.com/${OWNER}/${REPO}
// @version      ${pkg.version}
// @description  Record, replay and grow a shared Akinator character/answer database right on akinator.com.
// @description:zh-CN 在 akinator.com 上录制、回放并扩充共享角色/答案数据库，自动刷权重、缺题响铃。
// @author       ${OWNER}
// @homepageURL  https://github.com/${OWNER}/${REPO}
// @supportURL   https://github.com/${OWNER}/${REPO}/issues
// @updateURL    ${HOMEPAGE}akinator-auto-runner.user.js
// @downloadURL  ${HOMEPAGE}akinator-auto-runner.user.js
// @match        https://*.akinator.com/*
// @match        https://akinator.com/*
// @icon         https://akinator.com/favicon.ico
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==
`

const common = {
	bundle: true,
	target: ['chrome109', 'firefox115'],
	platform: 'browser',
	loader: { '.css': 'text', '.html': 'text' },
	legalComments: 'none',
	logLevel: 'warning',
}

/**
 * 构建入口：只产出油猴脚本，站点由 {@link module:scripts/assemble-pages} 在 CI 里组装。
 * @returns {Promise<void>} 完成
 */
async function main() {
	const outfile = resolve(root, 'dist/akinator-auto-runner.user.js')
	await build({
		...common,
		entryPoints: [resolve(root, 'src/userscript/index.mjs')],
		outfile,
		format: 'iife',
		banner: { js: banner },
		minify: false,
		sourcemap: false,
	})
	const { length: bytes } = await readFile(outfile)
	console.log(`built ${outfile} (${(bytes / 1024).toFixed(1)} KiB)`)
}

main().catch((err) => {
	console.error(err)
	process.exitCode = 1
})
