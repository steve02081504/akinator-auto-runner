import assert from 'node:assert/strict'
import { test } from 'node:test'

import { databaseToFiles, ensureDatabase } from '../src/shared/schema.mjs'

test('databaseToFiles：索引 + 每个角色一个文件', () => {
	const database = ensureDatabase({ name: 'demo', characters: [{ name: '龙胆', answers: {} }, { name: '龙胆', answers: {} }] })
	const files = databaseToFiles(database)
	const names = Object.keys(files).sort()
	assert.ok(names.includes('index.json'), '应包含索引文件')
	const characterFiles = names.filter((name) => name.startsWith('characters/'))
	assert.equal(characterFiles.length, 2, `同名角色文件应去重，实际 ${characterFiles.join(' | ')}`)
	const index = JSON.parse(files['index.json'])
	assert.equal(index.characters.length, 2, '索引应列出全部角色')
	for (const entry of index.characters)
		assert.ok(files[entry.url], `索引应指向存在的角色文件 ${entry.url}`)
	for (const name of characterFiles) {
		const parsed = ensureDatabase(JSON.parse(files[name]), name)
		assert.equal(Object.keys(parsed.characters).length, 1, '每个角色文件是一个单角色数据库')
	}
})
