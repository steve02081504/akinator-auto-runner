import assert from 'node:assert/strict'
import { test } from 'node:test'

import { emptyDatabase, reduceWeights } from '../src/shared/schema.mjs'
import { Store } from '../src/shared/store.mjs'

/**
 * 造一个像 akinator 猜测的对象。
 * @param {Partial<Aki.Guess>} [overrides] 覆盖字段
 * @returns {Aki.Guess} 猜测
 */
function makeGuess(overrides = {}) {
	return {
		id: 'pika',
		name: 'Pikachu',
		description: 'electric mouse',
		photo: 'https://example.com/pika.png',
		confidence: null,
		raw: {},
		...overrides,
	}
}

test('syncFromGuess：命中时用 akinator 的最新资料覆盖旧图片与描述', () => {
	const store = new Store(emptyDatabase('test'))
	const character = store.addCharacter({ name: 'Pikachu', description: 'old', image: 'https://example.com/old.png' })

	const changed = store.syncFromGuess(character.id, makeGuess())

	assert.deepEqual(changed, ['description', 'image'], '应只报告真正变化的字段')
	assert.equal(character.description, 'electric mouse')
	assert.equal(character.image, 'https://example.com/pika.png')
	assert.equal(character.name, 'Pikachu')
})

test('syncFromGuess：值没变时不改动也不报告', () => {
	const store = new Store(emptyDatabase('test'))
	const character = store.addCharacter({ name: 'Pikachu', description: 'electric mouse', image: 'https://example.com/pika.png' })

	const changed = store.syncFromGuess(character.id, makeGuess())

	assert.deepEqual(changed, [], '资料一致时不应更新')
})

test('syncFromGuess：改名时把旧名收进别名', () => {
	const store = new Store(emptyDatabase('test'))
	const character = store.addCharacter({ name: '皮卡丘' })

	const changed = store.syncFromGuess(character.id, makeGuess())

	assert.deepEqual(changed, ['name', 'description', 'image'])
	assert.equal(character.name, 'Pikachu')
	assert.ok(character.aliases.includes('皮卡丘'), '旧名应保留在别名里')
})

test('syncFromGuess：空猜测字段不覆盖本地已有值', () => {
	const store = new Store(emptyDatabase('test'))
	const character = store.addCharacter({ name: 'Pikachu', description: 'kept', image: 'https://example.com/kept.png' })

	const changed = store.syncFromGuess(character.id, makeGuess({ description: '', photo: '' }))

	assert.deepEqual(changed, [])
	assert.equal(character.description, 'kept')
	assert.equal(character.image, 'https://example.com/kept.png')
})

test('syncFromGuess：角色不存在时安全返回空数组', () => {
	const store = new Store(emptyDatabase('test'))
	assert.deepEqual(store.syncFromGuess('missing', makeGuess()), [])
})

test('reduceWeights：把权重约成最简整数比', () => {
	assert.deepEqual(reduceWeights([2, 4, 6, 8, 0]), [1, 2, 3, 4, 0])
	assert.deepEqual(reduceWeights([0, 9, 0, 0, 0]), [0, 1, 0, 0, 0])
	assert.deepEqual(reduceWeights([0, 0, 0, 0, 0]), [0, 0, 0, 0, 0], '全零保持原样')
	assert.deepEqual(reduceWeights([0.5, 1, 0, 0, 0]), [0.5, 1, 0, 0, 0], '含小数时不约分')
})

test('simplifyWeights：保存前把每道题约分并同步 count', () => {
	const store = new Store(emptyDatabase('test'))
	const character = store.addCharacter({ name: 'Simplify' })
	store.recordAnswer(character.id, { text: 'Same question?' }, 0)
	store.recordAnswer(character.id, { text: 'Same question?' }, 0)
	const key = Object.keys(character.answers)[0]
	assert.deepEqual(character.answers[key].weights, [2, 0, 0, 0, 0])

	const touched = store.simplifyWeights()

	assert.equal(touched, true)
	assert.deepEqual(character.answers[key].weights, [1, 0, 0, 0, 0])
	assert.equal(character.answers[key].count, 1)
	assert.equal(store.simplifyWeights(), false, '已是最简时不应再报改动')
})

test('mergeCharacter：逐题累加权重、补齐资料并取并集题目', () => {
	const store = new Store(emptyDatabase('test'))
	const target = store.addCharacter({ name: 'Pikachu', aliases: ['皮卡丘'], tags: ['pokemon'] })
	store.recordAnswer(target.id, { text: 'Is it yellow?' }, 0)
	store.recordAnswer(target.id, { text: 'Is it yellow?' }, 1)
	const incoming = store.addCharacter({ name: 'Pikachu', description: 'electric mouse', image: 'https://example.com/pika.png' })
	store.recordAnswer(incoming.id, { text: 'Is it yellow?' }, 0)
	store.recordAnswer(incoming.id, { text: 'Does it zap?' }, 3)

	const merged = store.mergeCharacter(target.id, store.getCharacter(incoming.id))

	assert.equal(merged, target)
	assert.equal(Object.keys(target.answers).length, 2, '题目取并集')
	const yellow = target.answers[Object.keys(target.answers).find((key) => key.includes('yellow'))]
	assert.deepEqual(yellow.weights, [2, 1, 0, 0, 0])
	assert.equal(target.description, 'electric mouse', '空资料用来源补齐')
	assert.equal(target.image, 'https://example.com/pika.png')
	assert.deepEqual(target.aliases, ['皮卡丘'])
	assert.deepEqual(target.tags, ['pokemon'])
})

test('findDuplicate：按名称 / 别名找到另一个同名角色', () => {
	const store = new Store(emptyDatabase('test'))
	const original = store.addCharacter({ name: 'Pikachu' })

	assert.equal(store.findDuplicate(original), undefined, '不应把自己当成重复')

	const incoming = store.addCharacter({ name: '皮卡丘', aliases: ['Pikachu'] })

	assert.equal(store.findDuplicate(incoming)?.id, original.id, '别名命中')
})

test('listCharacters：搜索忽略中圆点 / 空白 / 全半角差异', () => {
	const store = new Store(emptyDatabase('test'))
	store.addCharacter({ name: '龙胆•阿芙萝黛蒂', aliases: ['龙胆'] })

	for (const query of ['龙胆', '阿芙萝黛蒂', '龙胆•阿芙萝黛蒂', '龙胆·阿芙萝黛蒂', '龙胆・阿芙萝黛蒂', '龙胆 阿芙萝黛蒂'])
		assert.equal(store.listCharacters({ query }).length, 1, `「${query}」应命中`)

	assert.equal(store.listCharacters({ query: '不存在的角色' }).length, 0)
})
