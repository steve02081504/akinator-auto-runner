import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

import { root } from './helpers.mjs'

const css = await readFile(path.resolve(root, 'src', 'shared', 'sponsor.css'), 'utf8')
const templates = await Promise.all([
	'src/userscript/views/sponsor.html',
	'.github/pages/views/sponsor.html',
].map((file) => readFile(path.resolve(root, file), 'utf8')))

/**
 * akinator 的反广告脚本会整表禁用「选择器长得像广告屏蔽规则」的样式（实测 `.aki-ad`、`[id$="-ad"]` 中招，
 * 面板的 `.aar-*` 与 `[data-ad-slot]` 没事），所以赞助位类名一律不带 `ad` 词元。
 */
const AD_FILTER_LIKE = /(^|[-_.])ad([-_.]|$)/i

test('赞助位：类名不带广告屏蔽规则特征', () => {
	for (const template of templates) {
		const classes = [...template.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/))
		for (const name of classes)
			if (name && !name.includes('${'))
				assert.doesNotMatch(name, AD_FILTER_LIKE, `类名 ${name} 会被 akinator 反广告脚本当成屏蔽规则`)
	}
	for (const [, name] of css.matchAll(/\.([A-Za-z][\w-]*)/g))
		assert.doesNotMatch(name, AD_FILTER_LIKE, `选择器 .${name} 会被 akinator 反广告脚本当成屏蔽规则`)
})

test('赞助位：模板类名都在 sponsor.css 里有定义', () => {
	const classes = [...templates[0].matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)).filter((name) => name && !name.includes('${'))
	for (const name of classes)
		assert.ok(css.includes(`.${name}`), `模板类 ${name} 在 sponsor.css 里没有定义`)
})
