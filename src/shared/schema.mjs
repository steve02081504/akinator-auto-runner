/**
 * 数据模型：创建、归一化、校验与合并数据库。
 * @module shared/schema
 */

import { ANSWER_KEYS, DB_VERSION } from './constants.mjs'
import { asRecord, deepClone, now, slugify } from './util.mjs'

/**
 * 创建一个空数据库。
 * @param {string} [name] 数据库名称
 * @returns {Aki.Database} 空数据库
 */
export function emptyDatabase(name = 'characters') {
	return {
		version: DB_VERSION,
		name,
		updatedAt: now(),
		characters: {},
	}
}

/**
 * 一组全零的答案权重（长度等于答案选项数）。
 * @returns {number[]} 权重数组
 */
export function emptyWeights() {
	return ANSWER_KEYS.map(() => 0)
}

/**
 * 归一化权重：接受数组或索引对象，长度补齐到答案数、丢弃非法值。
 * @param {unknown} value 原始权重
 * @returns {number[] | undefined} 归一化数组，无法识别时返回 undefined
 */
function normalizeWeights(value) {
	if (Array.isArray(value))
		return ANSWER_KEYS.map((_, index) => {
			const weight = Number(value[index])
			return Number.isFinite(weight) && weight > 0 ? weight : 0
		})
	if (value && typeof value === 'object')
		return ANSWER_KEYS.map((_, index) => {
			const weight = Number(value[String(index)])
			return Number.isFinite(weight) && weight > 0 ? weight : 0
		})
	return undefined
}

/**
 * 取答案记录的权重；缺失时按旧的「单答案 + 次数」推导。
 * @param {Partial<Aki.AnswerRecord> | undefined} record 答案记录
 * @returns {number[]} 权重数组
 */
export function answerWeights(record) {
	const weights = normalizeWeights(record?.weights)
	if (weights) return weights
	const answer = Number(record?.answer)
	if (Number.isInteger(answer) && answer >= 0 && answer < ANSWER_KEYS.length) {
		const result = emptyWeights()
		result[answer] = Math.max(1, Number(record?.count) || 1)
		return result
	}
	return emptyWeights()
}

/**
 * 取权重最高的答案索引；同权重时优先 `fallback`。
 * @param {number[]} weights 权重数组
 * @param {number} [fallback] 平局时优先的答案索引
 * @returns {number} 答案索引
 */
export function pickAnswerIndex(weights, fallback = 0) {
	const start = Number.isInteger(fallback) && fallback >= 0 && fallback < weights.length ? fallback : 0
	let best = start
	for (let index = 0; index < weights.length; index++)
		if (weights[index] > weights[best]) best = index
	return best
}

/**
 * 按历史权重随机抽取一个答案索引：权重越大越可能被抽中。
 *
 * 回放时按「历史作答概率」而不是「最大权重」作答，免得总按同一个答案提交把别的可能压死。
 * 权重全为 0 / 非法时退回 `pickAnswerIndex` 的兜底。
 * @param {number[]} weights 权重数组
 * @param {number} [fallback] 全部为 0 时的兜底答案索引
 * @returns {number} 答案索引
 */
export function sampleAnswerIndex(weights, fallback = 0) {
	const safe = weights.map((value) => Math.max(0, Number(value) || 0))
	const total = safe.reduce((sum, value) => sum + value, 0)
	if (!(total > 0)) return pickAnswerIndex(safe, fallback)
	let threshold = Math.random() * total
	for (const [index, value] of safe.entries()) {
		threshold -= value
		if (threshold < 0) return index
	}
	return safe.length - 1
}

/**
 * 求两个非负整数的最大公约数。
 * @param {number} a 整数
 * @param {number} b 整数
 * @returns {number} 最大公约数
 */
function greatestCommonDivisor(a, b) {
	let left = Math.abs(a)
	let right = Math.abs(b)
	while (right) [left, right] = [right, left % right]
	return left
}

/**
 * 把一组权重约成最简整数比（所有非零权重同时除以它们的最大公约数），保持各答案的相对比例。
 *
 * 例如 `[2, 4, 6, 8, 0]` → `[1, 2, 3, 4, 0]`。出现非整数权重（编辑器手填的小数）或全为 0 时原样返回。
 * @param {number[]} weights 权重数组
 * @returns {number[]} 约分后的权重数组
 */
export function reduceWeights(weights) {
	const values = ANSWER_KEYS.map((_, index) => Number(weights?.[index]) || 0)
	if (!values.every((value) => Number.isInteger(value) && value >= 0)) return weights
	const divisor = values.reduce((acc, value) => value ? greatestCommonDivisor(acc, value) : acc, 0)
	if (divisor <= 1) return values
	return values.map((value) => value / divisor)
}

/**
 * 归一化一个答案记录。
 *
 * `weights` 是各答案的权重（角色对该题每个回答的倾向），`answer` 是角色选定的答案，
 * `count` 是权重总和。
 * @param {Partial<Aki.AnswerRecord>} input 原始记录
 * @returns {Aki.AnswerRecord} 归一化后的记录
 */
export function normalizeAnswerRecord(input) {
	const answer = Number(input.answer)
	const weights = normalizeWeights(input.weights) ?? answerWeights(input)
	return {
		answer: Number.isInteger(answer) && answer >= 0 && answer < ANSWER_KEYS.length ? answer : pickAnswerIndex(weights, 2),
		question: String(input.question ?? ''),
		questionId: input.questionId ? String(input.questionId) : undefined,
		weights,
		count: weights.reduce((sum, value) => sum + value, 0),
		updatedAt: Number(input.updatedAt) || now(),
	}
}

/**
 * 创建一个新角色。
 * @param {Partial<Aki.Character> | Record<string, unknown>} input 初始字段
 * @returns {Aki.Character} 新角色
 */
export function createCharacter(input) {
	const timestamp = now()
	return {
		id: String(input.id ?? ''),
		name: String(input.name ?? '').trim(),
		aliases: toStringArray(input.aliases),
		description: String(input.description ?? ''),
		image: String(input.image ?? ''),
		tags: toStringArray(input.tags),
		region: String(input.region ?? 'en'),
		sid: Number(input.sid) || 1,
		author: input.author ? String(input.author) : undefined,
		source: normalizeCharacterSource(input.source),
		mergedIds: toStringArray(input.mergedIds),
		createdAt: Number(input.createdAt) || timestamp,
		updatedAt: Number(input.updatedAt) || timestamp,
		answers: normalizeAnswers(input.answers),
	}
}

/**
 * 归一化角色来源。
 * @param {Partial<Aki.CharacterSource> | undefined} source 原始来源
 * @returns {Aki.CharacterSource | undefined} 归一化来源
 */
function normalizeCharacterSource(source) {
	if (!source || !source.url) return undefined
	return {
		url: String(source.url),
		name: String(source.name ?? source.url),
		fetchedAt: Number(source.fetchedAt) || now(),
		loadedAt: Number(source.loadedAt) || 0,
	}
}

/**
 * 判断一个值是否像单个角色对象。
 * @param {unknown} value 待判断的值
 * @returns {boolean} 是否像角色
 */
function isCharacterLike(value) {
	if (!value || typeof value !== 'object') return false
	const record = asRecord(value)
	if (typeof record.name !== 'string') return false
	return typeof record.answers === 'object' || typeof record.id === 'string' || typeof record.description === 'string'
}

/**
 * 归一化答案表。
 * @param {Record<string, Partial<Aki.AnswerRecord>> | undefined} answers 原始答案表
 * @returns {Record<string, Aki.AnswerRecord>} 归一化答案表
 */
function normalizeAnswers(answers) {
	/** @type {Record<string, Aki.AnswerRecord>} */
	const result = {}
	if (!answers || typeof answers !== 'object') return result
	for (const [key, value] of Object.entries(answers)) {
		if (!value || typeof value !== 'object') continue
		result[String(key)] = normalizeAnswerRecord(value)
	}
	return result
}

/**
 * 把任意值转成字符串数组。
 * @param {unknown} value 输入值
 * @returns {string[]} 字符串数组
 */
function toStringArray(value) {
	if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean)
	if (typeof value === 'string' && value) return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
	return []
}

/**
 * 把任意外部数据归一化为合法数据库，尽量不抛错。
 * @param {unknown} input 已解析的 JSON 值
 * @param {string} [name] 兜底名称
 * @returns {Aki.Database} 数据库
 */
export function ensureDatabase(input, name = 'imported') {
	const database = emptyDatabase(name)
	if (Array.isArray(input)) {
		addCharactersFromList(database, input)
		return database
	}
	if (!input || typeof input !== 'object') return database
	if (isCharacterLike(input)) {
		const character = createCharacter(input)
		character.id = character.id || uniqueId(database, character.name)
		database.characters[character.id] = character
		return database
	}
	const raw = asRecord(input)
	database.name = String(raw.name ?? name)
	database.updatedAt = Number(raw.updatedAt) || now()
	if (isCharacterLike(raw.character)) {
		const character = createCharacter(raw.character)
		character.id = character.id || uniqueId(database, character.name)
		database.characters[character.id] = character
		return database
	}
	const rawCharacters = raw.characters
	if (Array.isArray(rawCharacters)) addCharactersFromList(database, rawCharacters)
	else if (rawCharacters && typeof rawCharacters === 'object')
		for (const [id, value] of Object.entries(asRecord(rawCharacters))) {
			if (!value || typeof value !== 'object') continue
			const partial = asRecord(value)
			partial.id = partial.id || id
			const character = createCharacter(partial)
			if (character.name) database.characters[character.id] = character
		}
	reindexCharacterIds(database)
	return database
}

/**
 * 把一组角色对象加入数据库并分配 id。
 * @param {Aki.Database} database 目标数据库
 * @param {unknown[]} list 角色列表
 * @returns {void}
 */
function addCharactersFromList(database, list) {
	for (const item of list) {
		if (!item || typeof item !== 'object') continue
		const character = createCharacter(item)
		if (!character.name) continue
		character.id = character.id || uniqueId(database, character.name)
		database.characters[character.id] = character
	}
}

/**
 * 根据名称生成一个数据库中唯一的 id。
 * @param {Aki.Database} database 数据库
 * @param {string} name 角色名
 * @returns {string} 唯一 id
 */
export function uniqueId(database, name) {
	const base = slugify(name) || 'character'
	if (!database.characters[base]) return base
	let index = 2
	while (database.characters[`${base}-${index}`]) index++
	return `${base}-${index}`
}

/**
 * 去掉数据库内重复或缺失的角色 id。
 * @param {Aki.Database} database 数据库
 * @returns {void}
 */
function reindexCharacterIds(database) {
	/** @type {Record<string, Aki.Character>} */
	const rebuilt = {}
	for (const character of Object.values(database.characters)) {
		const id = character.id && !rebuilt[character.id] ? character.id : uniqueId({ ...database, characters: rebuilt }, character.name)
		character.id = id
		rebuilt[id] = character
	}
	database.characters = rebuilt
}

/**
 * 把一个角色包装成单角色数据库，便于单独上传 / 更新。
 * @param {Aki.Character} character 角色
 * @param {string} [name] 数据库名
 * @returns {Aki.Database} 数据库
 */
export function characterToDatabase(character, name) {
	const database = emptyDatabase(name ?? character.id)
	database.characters[character.id] = deepClone(character)
	return database
}

/**
 * 把数据库拆成「索引 + 每个角色一个文件」的文件夹结构，用于文件夹导出 / 分享。
 *
 * 返回相对路径 → 文本的映射：`index.json` 列出各角色文件的相对地址，
 * 角色文件放在 `characters/` 下（每个成员都是一个角色数据 JSON）。
 * @param {Aki.Database} database 数据库
 * @returns {Record<string, string>} 相对路径 → 文件文本
 */
export function databaseToFiles(database) {
	/** @type {Record<string, string>} */
	const files = {}
	/** @type {{ name: string; url: string; description: string }[]} */
	const index = []
	const used = new Set()
	for (const character of Object.values(database.characters)) {
		const base = slugify(character.name || character.id) || 'character'
		let slug = base
		let counter = 2
		while (used.has(slug)) slug = `${base}-${counter++}`
		used.add(slug)
		const url = `characters/${slug}.json`
		index.push({ name: character.name, url, description: character.description || '' })
		files[url] = JSON.stringify(characterToDatabase(character, character.id), null, '\t')
	}
	files['index.json'] = JSON.stringify({
		version: DB_VERSION,
		name: database.name,
		updatedAt: now(),
		characters: index,
	}, null, '\t')
	return files
}

/**
 * 生成一组答案权重的分布概览。
 * @param {number[]} weights 各答案的权重
 * @returns {{ index: number; key: string; count: number; ratio: number }[]} 分布（按答案索引升序）
 */
export function answerDistribution(weights) {
	const counts = ANSWER_KEYS.map((_, index) => Number(weights?.[index]) || 0)
	const total = counts.reduce((sum, value) => sum + value, 0)
	return counts.map((count, index) => ({
		index,
		key: ANSWER_KEYS[index],
		count,
		ratio: total ? count / total : 0,
	}))
}
