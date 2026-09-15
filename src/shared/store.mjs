/**
 * 数据库读写门面：角色 CRUD、答案记录、题库统计与变更通知。
 * @module shared/store
 */

import { emptyCharacterState, matchesGuess, recordChoice, rememberGuess, stateFor } from './character_state.mjs'
import { answerWeights, createCharacter, emptyDatabase, emptyWeights, ensureDatabase, pickAnswerIndex, reduceWeights, uniqueId } from './schema.mjs'
import { matchesQuery, normalizeQuestion, now } from './util.mjs'

/**
 * 角色列表的过滤条件。
 * @typedef {object} CharacterFilter
 * @property {string} [query] 名称 / 别名 / 标签模糊匹配
 * @property {string} [tag] 标签
 * @property {string} [region] 区域
 */

/**
 * 数据存储。持有一个 {@link Aki.Database} 与一份本机角色运行状态，并广播变更。
 */
export class Store {
	/**
	 * @param {Aki.Database} [database] 初始数据库
	 * @param {Aki.CharacterState} [characterState] 本机角色运行状态（不进入数据库）
	 */
	constructor(database, characterState) {
		/** @type {Aki.Database} */
		this.db = database ?? emptyDatabase()
		/** @type {Aki.CharacterState} */
		this.characterState = characterState ?? emptyCharacterState()
		/** @type {((db: Aki.Database) => void)[]} */
		this.listeners = []
		/** @type {boolean} */
		this.suppress = false
	}

	/**
	 * 订阅变更。
	 * @param {(db: Aki.Database) => void} listener 监听器
	 * @returns {() => void} 取消订阅
	 */
	subscribe(listener) {
		this.listeners.push(listener)
		return () => {
			this.listeners = this.listeners.filter((item) => item !== listener)
		}
	}

	/**
	 * 用一个新的数据库替换当前内容。
	 * @param {Aki.Database | unknown} database 新数据库或可解析的值
	 * @param {string} [name] 兜底名称
	 * @returns {Aki.Database} 归一化后的数据库
	 */
	replace(database, name) {
		this.db = ensureDatabase(database, name)
		this.changed(false)
		return this.db
	}

	/**
	 * 标记数据库已变化并通知订阅者。
	 * @param {boolean} [touch] 是否更新时间戳
	 * @returns {void}
	 */
	changed(touch = true) {
		if (touch) this.db.updatedAt = now()
		if (this.suppress) return
		for (const listener of this.listeners) listener(this.db)
	}

	/**
	 * 批量修改时暂停通知，结束后统一通知。
	 * @param {() => void} work 修改逻辑
	 * @returns {void}
	 */
	batch(work) {
		const previous = this.suppress
		this.suppress = true
		try {
			work()
		} finally {
			this.suppress = previous
		}
		this.changed()
	}

	/**
	 * 列出角色。
	 * @param {CharacterFilter} [filter] 过滤条件
	 * @returns {Aki.Character[]} 角色数组（按名称排序）
	 */
	listCharacters(filter = {}) {
		const characters = Object.values(this.db.characters)
		const filtered = characters.filter((character) => {
			if (filter.region && character.region !== filter.region) return false
			if (filter.tag && !character.tags.includes(filter.tag)) return false
			if (!matchesQuery(filter.query ?? '', [character.name, ...character.aliases, ...character.tags])) return false
			return true
		})
		return filtered.sort((a, b) => a.name.localeCompare(b.name))
	}

	/**
	 * 取得角色。
	 * @param {string} id 角色 id
	 * @returns {Aki.Character | undefined} 角色
	 */
	getCharacter(id) {
		return this.db.characters[id]
	}

	/**
	 * 新增角色。
	 * @param {Partial<Aki.Character>} input 角色字段
	 * @returns {Aki.Character} 新角色
	 */
	addCharacter(input) {
		const character = createCharacter(input)
		character.id = character.id || uniqueId(this.db, character.name)
		this.db.characters[character.id] = character
		this.changed()
		return character
	}

	/**
	 * 更新角色字段。
	 * @param {string} id 角色 id
	 * @param {Partial<Aki.Character>} patch 修改内容
	 * @returns {Aki.Character | undefined} 更新后的角色
	 */
	updateCharacter(id, patch) {
		const character = this.db.characters[id]
		if (!character) return undefined
		Object.assign(character, patch, { updatedAt: now() })
		this.changed()
		return character
	}

	/**
	 * 删除角色。
	 * @param {string} id 角色 id
	 * @returns {boolean} 是否删除成功
	 */
	removeCharacter(id) {
		if (!this.db.characters[id]) return false
		delete this.db.characters[id]
		this.changed()
		return true
	}

	/**
	 * 读取某角色的某题答案记录。
	 * @param {string} characterId 角色 id
	 * @param {string} questionText 问题文本
	 * @returns {Aki.AnswerRecord | undefined} 答案记录
	 */
	getAnswer(characterId, questionText) {
		return this.db.characters[characterId]?.answers[normalizeQuestion(questionText)]
	}

	/**
	 * 记录（或覆盖）某题答案：在答案权重上加一，并更新该角色的答案。
	 * @param {string} characterId 角色 id
	 * @param {{ text: string; questionId?: string }} question 问题
	 * @param {number} answerIndex 答案索引
	 * @returns {Aki.AnswerRecord | undefined} 答案记录
	 */
	recordAnswer(characterId, question, answerIndex) {
		const character = this.db.characters[characterId]
		if (!character) return undefined
		const key = normalizeQuestion(question.text)
		const existing = character.answers[key]
		if (existing) {
			const weights = answerWeights(existing)
			weights[answerIndex] = (weights[answerIndex] ?? 0) + 1
			existing.weights = weights
			existing.count = weights.reduce((sum, value) => sum + value, 0)
			existing.answer = answerIndex
			existing.questionId = question.questionId ?? existing.questionId
			existing.updatedAt = now()
		} else {
			const weights = emptyWeights()
			weights[answerIndex] = 1
			character.answers[key] = {
				answer: answerIndex,
				question: question.text,
				questionId: question.questionId,
				weights,
				count: 1,
				updatedAt: now(),
			}
		}
		character.updatedAt = now()
		this.changed()
		return character.answers[key]
	}

	/**
	 * 纠正某题的答案：把该角色这道题的权重重置为「只选这次答案」，并覆盖角色自身的答案。
	 *
	 * 用于「自动选的答案是错的」这种场景：旧分布本身不可信，留着只会继续误导自动选择。
	 * @param {string} characterId 角色 id
	 * @param {{ text: string; questionId?: string }} question 问题
	 * @param {number} answerIndex 答案索引
	 * @returns {Aki.AnswerRecord | undefined} 答案记录
	 */
	correctAnswer(characterId, question, answerIndex) {
		const character = this.db.characters[characterId]
		if (!character) return undefined
		const key = normalizeQuestion(question.text)
		const existing = character.answers[key]
		const weights = emptyWeights()
		weights[answerIndex] = 1
		character.answers[key] = {
			answer: answerIndex,
			question: question.text,
			questionId: question.questionId ?? existing?.questionId,
			weights,
			count: 1,
			updatedAt: now(),
		}
		character.updatedAt = now()
		this.changed()
		return character.answers[key]
	}

	/**
	 * 找到与给定角色同名的另一个角色（按名称与别名、忽略大小写）。
	 *
	 * 用于「边录边建」结束时的去重：录到的其实就是题库里已有的角色时，把结果并进去而不是再建一个。
	 * @param {Aki.Character} character 角色
	 * @returns {Aki.Character | undefined} 同名角色
	 */
	findDuplicate(character) {
		const names = new Set([character.name, ...character.aliases].map((name) => name.trim().toLowerCase()).filter(Boolean))
		if (!names.size) return undefined
		return Object.values(this.db.characters).find((other) =>
			other.id !== character.id
			&& [other.name, ...other.aliases].some((name) => names.has(name.trim().toLowerCase())))
	}

	/**
	 * 把来源角色（通常是一次录制的占位角色）合并进目标角色。
	 *
	 * 每道题的权重按答案逐项相加并约成最简整数比，题目取两者并集；基础资料只补空、
	 * 别名与标签取并集；`answer` 取合并后权重最大的一项。
	 * @param {string} targetId 目标角色 id
	 * @param {Aki.Character} source 来源角色
	 * @returns {Aki.Character | undefined} 合并后的目标角色
	 */
	mergeCharacter(targetId, source) {
		const target = this.db.characters[targetId]
		if (!target || !source || target === source) return target
		this.batch(() => {
			for (const [key, incoming] of Object.entries(source.answers)) {
				const existing = target.answers[key]
				if (!existing) {
					target.answers[key] = incoming
					continue
				}
				const incomingWeights = answerWeights(incoming)
				const weights = reduceWeights(answerWeights(existing).map((value, index) => value + (incomingWeights[index] ?? 0)))
				existing.weights = weights
				existing.count = weights.reduce((sum, value) => sum + value, 0)
				existing.answer = pickAnswerIndex(weights, existing.answer)
				existing.questionId ??= incoming.questionId
				existing.updatedAt = now()
			}
			for (const alias of source.aliases)
				if (alias && alias !== target.name && !target.aliases.includes(alias)) target.aliases.push(alias)
			for (const tag of source.tags)
				if (!target.tags.includes(tag)) target.tags.push(tag)
			if (!target.description) target.description = source.description
			if (!target.image) target.image = source.image
			target.updatedAt = now()
		})
		return target
	}

	/**
	 * 把所有角色每道题的权重约成最简整数比，并同步 `count`。
	 *
	 * 编辑 / 合并后的保存会调用它；权重比例不变，因此不影响回放采样。
	 * @returns {boolean} 是否有改动
	 */
	simplifyWeights() {
		let touched = false
		for (const character of Object.values(this.db.characters))
			for (const record of Object.values(character.answers)) {
				const weights = answerWeights(record)
				const reduced = reduceWeights(weights)
				if (reduced.length === weights.length && reduced.every((value, index) => value === weights[index])) continue
				record.weights = reduced
				record.count = reduced.reduce((sum, value) => sum + value, 0)
				touched = true
			}
		if (touched) this.changed()
		return touched
	}

	/**
	 * 取得某角色的本机运行状态（策略 / 选择历史 / 已猜中的 id）。
	 * @param {string} characterId 角色 id
	 * @returns {Aki.CharacterStateRecord} 记录
	 */
	getChoice(characterId) {
		return stateFor(this.characterState, characterId)
	}

	/**
	 * 记录 akinator 猜中某角色。
	 * @param {string} characterId 角色 id
	 * @param {string} guessId 猜测 id
	 * @returns {void}
	 */
	rememberGuess(characterId, guessId) {
		rememberGuess(this.characterState, characterId, guessId)
		this.changed()
	}

	/**
	 * 记录一次候选选择。
	 * @param {string} characterId 角色 id
	 * @param {Aki.ChoiceRecord} record 记录
	 * @param {{ lockPolicy?: boolean }} [options] 选项
	 * @returns {void}
	 */
	recordChoice(characterId, record, options) {
		recordChoice(this.characterState, characterId, record, options)
		this.changed()
	}

	/**
	 * 判断 akinator 的猜测是否命中该角色。
	 * @param {Aki.Character} character 角色
	 * @param {Aki.Guess} guess 猜测
	 * @returns {boolean} 是否命中
	 */
	guessMatches(character, guess) {
		return matchesGuess(this.characterState, character, guess)
	}

	/**
	 * 命中时用 akinator 猜测里的最新资料同步本地角色（名称 / 描述 / 图片），仅在值不同时覆盖。
	 *
	 * akinator 会更新角色图片 / 描述，本地副本可能还是旧的；命中既然确认了是同一个角色，
	 * 就顺手把它的资料同步过来。改名时把旧名收进 `aliases`，免得丢掉用于命中判定的名字。
	 * @param {string} characterId 角色 id
	 * @param {Aki.Guess} guess akinator 的猜测
	 * @returns {string[]} 被更新的字段（`name` / `description` / `image`）
	 */
	syncFromGuess(characterId, guess) {
		const character = this.db.characters[characterId]
		if (!character || !guess) return []
		/** @type {string[]} */
		const changedFields = []
		const name = String(guess.name ?? '').trim()
		const description = String(guess.description ?? '').trim()
		const image = String(guess.photo ?? '').trim()
		if (name && name !== character.name) {
			if (character.name && !character.aliases.includes(character.name)) character.aliases.push(character.name)
			character.name = name
			changedFields.push('name')
		}
		if (description && description !== character.description) {
			character.description = description
			changedFields.push('description')
		}
		if (image && image !== character.image) {
			character.image = image
			changedFields.push('image')
		}
		if (changedFields.length) {
			character.updatedAt = now()
			this.changed()
		}
		return changedFields
	}

	/**
	 * 按 id 写入角色：已存在则整体覆盖，否则新增。
	 * @param {Aki.Character} character 角色
	 * @returns {Aki.Character} 写入后的角色
	 */
	upsertCharacter(character) {
		const existing = this.db.characters[character.id]
		if (existing) Object.assign(existing, character)
		else this.db.characters[character.id] = character
		this.changed()
		return this.db.characters[character.id]
	}

	/**
	 * 批量按 id 写入角色（覆盖 / 新增），只广播一次变更。
	 * @param {Aki.Database} database 来源数据库
	 * @returns {number} 写入的角色数
	 */
	upsertDatabase(database) {
		const characters = Object.values(database.characters)
		this.batch(() => {
			for (const character of characters) this.db.characters[character.id] = character
		})
		return characters.length
	}

	/**
	 * 按 id / 来源地址 / 名称找到现有角色。
	 * @param {Aki.Character} incoming 远程角色
	 * @returns {Aki.Character | undefined} 现有角色
	 */
	findRemote(incoming) {
		const url = incoming.source?.url
		return Object.values(this.db.characters).find((character) =>
			character.id === incoming.id
			|| (!!url && character.source?.url === url)
			|| character.name.trim().toLowerCase() === incoming.name.trim().toLowerCase())
	}

	/**
	 * 写入一个远程角色。
	 *
	 * `placeholder` 为真时只登记基础信息（订阅列表拉到的占位），保留已有答案与加载标记；
	 * 为假时用远程数据整体覆盖（订阅的单个角色数据，用到时拉取覆盖）。
	 * @param {Aki.Character} incoming 远程角色
	 * @param {{ placeholder?: boolean }} [options] 选项
	 * @returns {Aki.Character} 写入后的角色
	 */
	saveRemote(incoming, options = {}) {
		const match = this.findRemote(incoming)
		if (!match) {
			this.db.characters[incoming.id] = incoming
			this.changed()
			return incoming
		}
		if (options.placeholder) {
			match.name = incoming.name || match.name
			if (!match.description) match.description = incoming.description
			if (!match.image) match.image = incoming.image
			if (!match.region) match.region = incoming.region
			for (const tag of incoming.tags)
				if (!match.tags.includes(tag)) match.tags.push(tag)
			match.source ??= incoming.source
			match.updatedAt = now()
		} else {
			const { id, createdAt, mergedIds } = match
			Object.assign(match, incoming, { id, createdAt, mergedIds })
		}
		this.changed()
		return match
	}

	/**
	 * 批量登记订阅列表里的角色占位（只有 url 与基础信息，用到时再拉取）。
	 * @param {Aki.Character[]} characters 占位角色
	 * @returns {number} 登记数量
	 */
	savePlaceholders(characters) {
		this.batch(() => {
			for (const character of characters) this.saveRemote(character, { placeholder: true })
		})
		return characters.length
	}

	/**
	 * 序列化为 JSON 字符串。
	 * @returns {string} JSON 文本
	 */
	toJSON() {
		return JSON.stringify(this.db, null, '\t')
	}
}
