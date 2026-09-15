/**
 * 本机「角色运行状态」：候选策略与选择历史、akinator 已猜中的 id。
 *
 * 和「厨力」一样属于本机运行期信息，只在本地保存，不进入题库数据。
 * @module shared/character_state
 */

/** 每个角色最多保留的候选选择历史条数。 */
const HISTORY_LIMIT = 50

/**
 * 创建一个空的角色运行状态。
 * @returns {Aki.CharacterState} 空状态
 */
export function emptyCharacterState() {
	return { characters: {} }
}

/**
 * 取得（或创建）某角色的运行状态。
 * @param {Aki.CharacterState} state 运行状态
 * @param {string} id 角色 id
 * @returns {Aki.CharacterStateRecord} 记录
 */
export function stateFor(state, id) {
	return state.characters[id] ??= { policy: 'auto', history: [], guessed: [] }
}

/**
 * 记录一次候选选择。
 *
 * 手动排除会把策略锁定为 `exclude`（用于明知 akinator 猜不出该角色、只想刷权重时），
 * 但录制时的排除只是在纠正 akinator 的错误猜测，不代表角色不在 akinator 题库里，
 * 因此调用方可用 `lockPolicy: false` 跳过锁定。
 * @param {Aki.CharacterState} state 运行状态
 * @param {string} id 角色 id
 * @param {Aki.ChoiceRecord} record 记录
 * @param {{ lockPolicy?: boolean }} [options] 选项
 * @returns {void}
 */
export function recordChoice(state, id, record, options = {}) {
	const entry = stateFor(state, id)
	entry.history.push(record)
	if (entry.history.length > HISTORY_LIMIT) entry.history.splice(0, entry.history.length - HISTORY_LIMIT)
	if (record.action === 'exclude' && record.manual && options.lockPolicy !== false) entry.policy = 'exclude'
}

/**
 * 记住 akinator 猜中过的候选 id（用于下次按 id 直接命中）。
 * @param {Aki.CharacterState} state 运行状态
 * @param {string} id 角色 id
 * @param {string} guessId 猜测 id
 * @returns {void}
 */
export function rememberGuess(state, id, guessId) {
	const entry = stateFor(state, id)
	if (guessId && !entry.guessed.includes(guessId)) entry.guessed.push(guessId)
}

/**
 * 判断 akinator 的猜测是否命中该角色。
 * @param {Aki.CharacterState} state 运行状态
 * @param {Aki.Character} character 角色
 * @param {Aki.Guess} guess 猜测
 * @returns {boolean} 是否命中
 */
export function matchesGuess(state, character, guess) {
	if (guess.id && state.characters[character.id]?.guessed.includes(guess.id)) return true
	const target = guess.name.trim().toLowerCase()
	return !!target && [character.name, ...character.aliases].some((name) => name.trim().toLowerCase() === target)
}
