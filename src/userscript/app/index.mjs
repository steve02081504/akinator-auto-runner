/**
 * 油猴脚本应用核心：串联设置、数据库、akinator 客户端、运行引擎与持久化。
 *
 * 运行状态机拆在 {@link module:userscript/app/run}，这里只做数据 / 配置 / 持久化与转发。
 * @module userscript/app
 */

import { AkinatorClient } from '../../shared/akinator.mjs'
import { emptyCharacterState } from '../../shared/character_state.mjs'
import { CHARACTER_STATE_KEY, DEVOTION_KEY, MAX_LOG_ENTRIES, PLAYLIST_KEY, SID } from '../../shared/constants.mjs'
import { devotionFor, devotionSummary, emptyDevotion, ensureDevotion } from '../../shared/devotion.mjs'
import { writeFilesToDirectory } from '../../shared/folder.mjs'
import { emptyPlaylist, ensurePlaylist, hasInPlaylist, removeFromPlaylist, toggleInPlaylist } from '../../shared/playlist.mjs'
import { characterToDatabase, createCharacter, databaseToFiles, emptyDatabase, ensureDatabase } from '../../shared/schema.mjs'
import { Store } from '../../shared/store.mjs'
import { asArray, asRecord, debounce, download, now, slugify } from '../../shared/util.mjs'
import { loadSettings, loadSubscriptions, saveSettings, saveSubscriptions, storageGet, storageSet } from '../gm.mjs'
import { applyLocale, geti18n } from '../i18n.mjs'
import { PageAkinatorClient } from '../page_client.mjs'
import { fetchJsonText, LocalFolderDatabase, pickDirectory, supportsDirectoryAccess } from '../persistence.mjs'
import { clearLogs, clearSession, loadLogs, loadSession, saveLogs, saveSession } from '../session.mjs'

import { RunController } from './run.mjs'

/**
 * 判断来源地址是否是可拉取的远程地址。
 * @param {string | undefined} url 地址
 * @returns {boolean} 是否远程
 */
function isRemoteUrl(url) {
	return typeof url === 'string' && /^https?:\/\//i.test(url)
}

/**
 * 给角色补上远程来源信息。
 * @param {Aki.Character} character 角色
 * @param {{ url: string; name?: string }} source 来源
 * @returns {Aki.Character} 带来源的角色
 */
function remoteCharacter(character, source) {
	return {
		...character,
		source: {
			url: source.url,
			name: source.name ?? character.name ?? source.url,
			fetchedAt: now(),
			loadedAt: now(),
		},
	}
}

/**
 * 把订阅列表里的一条记录转成占位角色（只有 url 与基础信息，用到时再拉取）。
 * @param {Record<string, unknown>} entry 列表项
 * @param {Aki.Subscription} subscription 订阅
 * @returns {Aki.Character} 占位角色
 */
function placeholderFromEntry(entry, subscription) {
	const name = String(entry.name ?? '')
	const url = String(entry.url ?? '')
	return createCharacter({
		name,
		description: String(entry.description ?? ''),
		image: String(entry.image ?? ''),
		aliases: asArray(entry.aliases),
		tags: asArray(entry.tags),
		region: String(entry.region ?? 'en'),
		sid: Number(entry.sid) || SID.character,
		source: {
			url: url ? new URL(url, subscription.url).href : subscription.url,
			name: name || subscription.name,
			fetchedAt: now(),
			loadedAt: 0,
		},
	})
}

/**
 * 应用核心。UI 与站点桥都通过它与数据 / 运行 / 持久化交互。
 */
export class App {
	/**
	 * @param {{ embedded?: boolean }} [options] 选项
	 */
	constructor(options = {}) {
		/** @type {boolean} */
		this.embedded = options.embedded ?? false
		/** @type {Aki.Settings} */
		this.settings = loadSettings()
		/** @type {Aki.Subscription[]} */
		this.subscriptions = loadSubscriptions()
		/** @type {Store} */
		this.store = new Store(emptyDatabase('local'), storageGet(CHARACTER_STATE_KEY, emptyCharacterState()))
		/** @type {LocalFolderDatabase} */
		this.localDb = new LocalFolderDatabase()
		/** @type {Aki.Devotion} */
		this.devotion = ensureDevotion(storageGet(DEVOTION_KEY, emptyDevotion()))
		this.saveDevotion = debounce(() => storageSet(DEVOTION_KEY, this.devotion), 1000)
		this.saveCharacterState = debounce(() => storageSet(CHARACTER_STATE_KEY, this.store.characterState), 1000)
		/** @type {Aki.Playlist} 本机歌单（挂机回放队列）。 */
		this.playlist = ensurePlaylist(storageGet(PLAYLIST_KEY, emptyPlaylist()))
		/** @type {Aki.LogEntry[]} 内存 + 持久化的运行日志（跨页面保留）。 */
		this.logs = loadLogs()
		/** @type {Aki.SessionSnapshot | undefined} 最近一次会话快照（跨页面保留）。 */
		this.lastSession = loadSession()
		/** 上一次会话是否是被页面刷新 / 跳转打断的。 */
		this.sessionInterrupted = !!this.lastSession?.running
		this.saveLogs = debounce(() => saveLogs(this.logs), 500)
		// 防抖写入时读取「当下」的快照：否则运行收尾时的直接写入会被先前排队的
		// 运行中快照（running: true）覆盖，导致下次进页面误判为「上次会话被中断」。
		this.saveSession = debounce(() => {
			if (this.lastSession) saveSession(this.lastSession)
		}, 400)
		/** @type {Map<string, Set<(data: unknown) => void>>} */
		this.listeners = new Map()
		/** @type {string} */
		this.sourceName = '未选择文件'
		this.autosave = debounce(() => {
			this.saveNow().catch(() => undefined)
		}, 800)
		/** @type {RunController} */
		this.runner = new RunController(this)
		if (this.sessionInterrupted) this.persistSession({ running: false })
		this.store.subscribe(() => {
			this.prunePlaylist()
			this.saveCharacterState()
			this.emit('database', this.store.db)
			if (this.settings.autoSave) this.autosave()
		})
		// 运行期间把状态同步进「上次会话」快照，刷新后据此提示续跑。
		this.on('state', (state) => this.persistSession({
			running: true,
			round: state.round,
			step: state.step,
			wins: state.wins,
			losses: state.losses,
			question: state.question?.text,
		}))
	}

	/**
	 * 追加一条日志：写入内存、持久化并广播。
	 * @param {Aki.LogEntry} entry 日志条目
	 * @returns {void} 无
	 */
	pushLog(entry) {
		this.logs = [...this.logs.slice(-(MAX_LOG_ENTRIES - 1)), entry]
		this.saveLogs()
		this.emit('log', entry)
	}

	/**
	 * 清空日志（内存 + 持久化）。
	 * @returns {void} 无
	 */
	clearLogs() {
		this.logs = []
		clearLogs()
		this.emit('logsCleared')
	}

	/**
	 * 清除会话快照。
	 * @returns {void} 无
	 */
	clearSession() {
		this.lastSession = undefined
		this.sessionInterrupted = false
		clearSession()
	}

	/**
	 * 改写并广播会话快照。
	 * @param {Partial<Aki.SessionSnapshot>} patch 修改项
	 * @returns {void} 无
	 */
	persistSession(patch) {
		const base = this.lastSession ?? {
			characterId: '',
			mode: this.settings.mode,
			running: false,
			round: 0,
			step: 0,
			wins: 0,
			losses: 0,
			startedAt: now(),
			updatedAt: now(),
		}
		if (!base.characterId) return
		this.lastSession = { ...base, ...patch, updatedAt: now() }
		this.saveSession()
	}

	/**
	 * 开始记录一次会话。
	 * @param {string} characterId 角色 id
	 * @param {Aki.RunMode} mode 运行模式
	 * @returns {void} 无
	 */
	startSession(characterId, mode) {
		this.lastSession = {
			characterId,
			mode,
			running: true,
			round: 0,
			step: 0,
			wins: 0,
			losses: 0,
			startedAt: now(),
			updatedAt: now(),
		}
		this.sessionInterrupted = false
		saveSession(this.lastSession)
		this.emit('session', this.lastSession)
	}

	/**
	 * 结束记录一次会话。
	 * @param {{ rounds: number; wins: number; losses: number }} summary 运行汇总
	 * @returns {void} 无
	 */
	finishSession(summary) {
		const session = this.lastSession
		if (!session) return
		this.lastSession = {
			...session,
			running: false,
			wins: summary.wins,
			losses: summary.losses,
			finishedAt: now(),
			updatedAt: now(),
		}
		saveSession(this.lastSession)
		this.emit('session', this.lastSession)
	}

	/**
	 * 订阅事件。
	 * @param {string} event 事件名
	 * @param {(data: unknown) => void} listener 监听器
	 * @returns {() => void} 取消订阅
	 */
	on(event, listener) {
		const set = this.listeners.get(event) ?? new Set()
		set.add(listener)
		this.listeners.set(event, set)
		return () => set.delete(listener)
	}

	/**
	 * 广播事件。
	 * @param {string} event 事件名
	 * @param {unknown} [data] 数据
	 * @returns {void}
	 */
	emit(event, data) {
		const set = this.listeners.get(event)
		if (!set) return
		for (const listener of set)
			try {
				listener(data)
			} catch (error) {
				console.error('[akinator-auto-runner]', error)
			}
	}

	/**
	 * 启动时恢复上次链接的文件夹并刷新订阅。
	 * @returns {Promise<void>} 完成
	 */
	async init() {
		await applyLocale()
		await this.localDb.restore().catch(() => false)
		const database = await this.localDb.read().catch(() => undefined)
		if (database) this.store.replace(database, this.localDb.name)
		this.sourceName = this.localDb.name
		this.emit('ready', this.localDb.name)
		await this.refreshSubscriptions({ silent: true })
	}

	/**
	 * 保存设置。
	 * @param {Partial<Aki.Settings>} patch 修改项
	 * @returns {void}
	 */
	updateSettings(patch) {
		this.settings = { ...this.settings, ...patch }
		saveSettings(this.settings)
		this.emit('settings', this.settings)
	}

	/**
	 * 用文本载入数据库（替换当前内容）。
	 * @param {string} text JSON 文本
	 * @param {string} [sourceName] 来源名
	 * @returns {Aki.Database} 载入后的数据库
	 */
	loadText(text, sourceName) {
		const parsed = JSON.parse(text)
		this.store.replace(parsed, sourceName ?? 'local')
		if (sourceName) this.sourceName = sourceName
		return this.store.db
	}

	/**
	 * 链接一个本地文件夹作为题库：读取 `index.json` + `characters/*.json`，
	 * 之后任何改动都会写回（见 {@link App#saveNow}）。
	 * @returns {Promise<Aki.Database>} 题库
	 */
	async linkFolder() {
		const database = await this.localDb.link()
		this.store.replace(database, this.localDb.name)
		this.sourceName = this.localDb.name
		await this.saveNow()
		this.pushLog({ time: now(), level: 'success', message: geti18n('logs.linkedFolder', { name: this.sourceName }) })
		return this.store.db
	}

	/**
	 * 立即把题库写回链接的文件夹 / IndexedDB，并同步落盘本机运行状态与厨力。
	 *
	 * 页面驱动下每局结束都可能刷新页面重开，这些本机数据必须跟着题库一起落盘，
	 * 否则刷新后「已猜中 id」丢失，回放只能退回按名字匹配。
	 * @returns {Promise<void>} 完成
	 */
	async saveNow() {
		this.store.simplifyWeights()
		storageSet(CHARACTER_STATE_KEY, this.store.characterState)
		storageSet(DEVOTION_KEY, this.devotion)
		storageSet(PLAYLIST_KEY, this.playlist)
		try {
			const written = await this.localDb.write(this.store.db)
			this.sourceName = this.localDb.name
			if (!written) this.pushLog({ time: now(), level: 'info', message: geti18n('logs.savedIdb') })
		} catch (error) {
			this.pushLog({ time: now(), level: 'error', message: geti18n('logs.saveFailed', { message: error instanceof Error ? error.message : String(error) }) })
		}
	}

	/**
	 * 把当前题库导出为一个文件夹：索引 JSON + `characters/` 下每个角色一个 JSON。
	 *
	 * 支持 File System Access API 时让用户选一个目录写入（选已链接的目录即可直接更新）；
	 * 否则逐个下载文件作为降级。
	 * @returns {Promise<void>} 完成
	 */
	async exportDatabaseFolder() {
		const files = databaseToFiles(this.store.db)
		if (supportsDirectoryAccess) {
			const root = await pickDirectory()
			await writeFilesToDirectory(root, files)
		} else
			for (const [path, text] of Object.entries(files)) download(path.split('/').pop() ?? 'character.json', text)
		this.pushLog({ time: now(), level: 'success', message: geti18n('logs.exportedFolder', { count: Object.keys(this.store.db.characters).length }) })
	}

	/**
	 * 只导出单个角色的信息与题库为文件下载。
	 *
	 * 只含该角色自身的字段与答案权重，不牵扯其他角色，便于单独分享 / 更新。
	 * @param {string} id 角色 id
	 * @returns {void}
	 */
	exportCharacter(id) {
		const character = this.store.getCharacter(id)
		if (!character) return
		const filename = `${slugify(character.name || character.id) || 'character'}.json`
		download(filename, JSON.stringify(characterToDatabase(character, character.id), null, '\t'))
	}

	/**
	 * 新增一条订阅。
	 * @param {{ kind?: 'list' | 'character'; url: string; name?: string; autoUpdate?: boolean }} input 订阅信息
	 * @returns {Aki.Subscription} 订阅
	 */
	addSubscription(input) {
		/** @type {Aki.Subscription} */
		const subscription = {
			id: `${now()}-${Math.random().toString(36).slice(2, 8)}`,
			kind: input.kind === 'character' ? 'character' : 'list',
			url: input.url,
			name: input.name || input.url,
			enabled: true,
			autoUpdate: input.autoUpdate ?? true,
		}
		this.subscriptions.push(subscription)
		saveSubscriptions(this.subscriptions)
		this.emit('subscriptions', this.subscriptions)
		return subscription
	}

	/**
	 * 更新订阅。
	 * @param {string} id 订阅 id
	 * @param {Partial<Aki.Subscription>} patch 修改项
	 * @returns {void}
	 */
	updateSubscription(id, patch) {
		this.subscriptions = this.subscriptions.map((item) => item.id === id ? { ...item, ...patch } : item)
		saveSubscriptions(this.subscriptions)
		this.emit('subscriptions', this.subscriptions)
	}

	/**
	 * 删除订阅。
	 * @param {string} id 订阅 id
	 * @returns {void}
	 */
	removeSubscription(id) {
		this.subscriptions = this.subscriptions.filter((item) => item.id !== id)
		saveSubscriptions(this.subscriptions)
		this.emit('subscriptions', this.subscriptions)
	}

	/**
	 * 刷新单条订阅。
	 *
	 * `list` 订阅：拉取角色列表，登记占位角色（只有 url 与基础信息，用到时再拉）。
	 * `character` 订阅：拉取单个角色数据并整体覆盖本地副本。
	 * @param {Aki.Subscription} subscription 订阅
	 * @returns {Promise<void>} 完成
	 */
	async refreshSubscription(subscription) {
		const text = await fetchJsonText(subscription.url)
		const parsed = JSON.parse(text)
		if (subscription.kind === 'character') {
			const database = ensureDatabase(parsed, subscription.name)
			for (const character of Object.values(database.characters))
				this.store.saveRemote(remoteCharacter(character, { url: subscription.url, name: subscription.name }), { placeholder: false })
			return
		}
		const raw = asRecord(parsed)
		const entries = Array.isArray(raw.characters) ? raw.characters : Array.isArray(raw.packs) ? raw.packs : []
		this.store.savePlaceholders(entries
			.filter((entry) => entry && typeof entry === 'object')
			.map((entry) => placeholderFromEntry(asRecord(entry), subscription)))
	}

	/**
	 * 刷新所有（或指定）启用的订阅。
	 * @param {{ silent?: boolean; ids?: string[] }} [options] 选项
	 * @returns {Promise<void>} 完成
	 */
	async refreshSubscriptions(options = {}) {
		for (const subscription of this.subscriptions) {
			if (!subscription.enabled) continue
			if (options.ids && !options.ids.includes(subscription.id)) continue
			if (options.silent && !subscription.autoUpdate) continue
			try {
				await this.refreshSubscription(subscription)
				this.updateSubscription(subscription.id, { lastFetchedAt: now(), lastError: undefined })
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				this.updateSubscription(subscription.id, { lastError: message })
				this.pushLog({ time: now(), level: 'warn', message: geti18n('logs.subscriptionFailed', { name: subscription.name, message }) })
			}
		}
	}

	/**
	 * 按需拉取远程角色的真实数据并覆盖本地副本（运行 / 编辑该角色前调用）。
	 *
	 * 只有带远程 `source.url` 的角色才会联网；本地新建 / 文件夹里的角色直接返回。
	 * 拉取失败时保留本地副本并记一条日志，不阻断运行。
	 * @param {string} id 角色 id
	 * @returns {Promise<Aki.Character | undefined>} 刷新后的角色
	 */
	async loadRemoteCharacter(id) {
		const character = this.store.getCharacter(id)
		const url = character?.source?.url
		if (!character || !isRemoteUrl(url)) return character
		try {
			const text = await fetchJsonText(url)
			const database = ensureDatabase(JSON.parse(text), character.name)
			const incoming = database.characters[id] ?? Object.values(database.characters)[0]
			if (incoming) this.store.saveRemote(remoteCharacter(incoming, { url, name: character.source?.name }), { placeholder: false })
		} catch (error) {
			this.pushLog({ time: now(), level: 'warn', message: geti18n('logs.remoteFailed', { name: character.name, message: error instanceof Error ? error.message : String(error) }) })
		}
		return this.store.getCharacter(id)
	}

	/**
	 * 检测当前 akinator 区域。
	 * @returns {string} 区域子域
	 */
	currentRegion() {
		if (this.settings.region) return this.settings.region
		const match = location.hostname.match(/^([a-z]+)\.akinator\.com$/i)
		return match ? match[1].toLowerCase() : 'en'
	}

	/**
	 * 根据设置创建 akinator 客户端。
	 *
	 * `page`：页面驱动（点 akinator 页面自身的按钮、读回 DOM，与页面共用同一个会话）。
	 * `api`：内置 HTTP 会话（自己 `POST /game`，页面看不到，作为兜底 / 兼容用）。
	 * `auto`：先用页面驱动，`RunController` 在页面操作出错时回退到内置 HTTP 会话重跑。
	 * @param {'auto' | 'page' | 'api'} [provider] 底层提供商
	 * @returns {import('../page_client.mjs').PageAkinatorClient | AkinatorClient} 客户端
	 */
	createClient(provider = this.settings.clientProvider ?? 'auto') {
		const region = this.currentRegion()
		const sid = this.settings.sid ?? SID.character
		if (provider === 'api') {
			const onAkinator = location.hostname.endsWith('akinator.com')
			return new AkinatorClient({
				region,
				baseUrl: onAkinator ? `https://${region}.akinator.com` : location.origin,
				sid,
				childMode: this.settings.childMode,
			})
		}
		return new PageAkinatorClient({ region, sid, childMode: this.settings.childMode })
	}

	/**
	 * 开始运行（录制 / 回放）。
	 *
	 * 回放 / 续录远程订阅的角色前，先按需拉取其最新数据并覆盖本地副本。
	 * @param {Aki.StartRunRequest} [overrides] 覆盖参数
	 * @returns {Promise<{ rounds: number; wins: number; losses: number }>} 统计
	 */
	async startRun(overrides) {
		const characterId = overrides?.characterId
		if (characterId) await this.loadRemoteCharacter(characterId).catch(() => undefined)
		return this.runner.startRun(overrides)
	}

	/**
	 * 停止运行。
	 * @returns {void}
	 */
	stopRun() {
		this.runner.stopRun()
	}

	/**
	 * 提交手动作答 / 中止。
	 * @param {number | null} answer 答案索引，null 中止
	 * @returns {void}
	 */
	provideAnswer(answer) {
		this.runner.provideAnswer(answer)
	}

	/**
	 * 提交候选选择 / 中止。
	 * @param {Aki.ProposalDecision | null} decision 决定，null 中止
	 * @returns {void}
	 */
	provideProposal(decision) {
		this.runner.provideProposal(decision)
	}

	/**
	 * UI 选择「纠正错误回答」或「追加概率」。
	 * @param {Aki.AnswerTreatment} treatment 处理方式
	 * @returns {void} 无
	 */
	resolveIntervention(treatment) {
		this.runner.resolveIntervention(treatment)
	}

	/**
	 * 收尾一次「边录边建」的运行。
	 * @param {string} characterId 角色 id
	 * @param {{ guess: Aki.Guess | undefined; summary: { rounds: number; wins: number; losses: number }; autoNamed: boolean }} result 结果
	 * @returns {void} 无
	 */
	finishRecord(characterId, result) {
		this.runner.finishRecord(characterId, result)
	}

	/**
	 * 取得某角色的厨力摘要。
	 * @param {string} id 角色 id
	 * @returns {ReturnType<typeof devotionSummary>} 摘要
	 */
	getDevotion(id) {
		return devotionSummary(devotionFor(this.devotion, id))
	}

	/**
	 * 取得整份厨力统计。
	 * @returns {Aki.Devotion} 统计
	 */
	getDevotionAll() {
		return this.devotion
	}

	/**
	 * 判断某角色是否已在歌单里。
	 * @param {string} id 角色 id
	 * @returns {boolean} 是否在歌单
	 */
	isInPlaylist(id) {
		return hasInPlaylist(this.playlist, id)
	}

	/**
	 * 把角色加入 / 移出歌单（角色卡上的「加入歌单」按钮）。
	 * @param {string} id 角色 id
	 * @returns {void} 无
	 */
	togglePlaylist(id) {
		toggleInPlaylist(this.playlist, id)
		this.commitPlaylist()
	}

	/**
	 * 把角色移出歌单（歌单视图里的删除按钮）。
	 * @param {string} id 角色 id
	 * @returns {void} 无
	 */
	removePlaylistItem(id) {
		removeFromPlaylist(this.playlist, id)
		this.commitPlaylist()
	}

	/**
	 * 切换歌单播放模式。
	 * @param {Aki.PlaylistMode} mode 模式
	 * @returns {void} 无
	 */
	setPlaylistMode(mode) {
		if (mode !== 'loop' && mode !== 'shuffle' && mode !== 'single') return
		this.playlist.mode = mode
		this.commitPlaylist()
	}

	/**
	 * 清空歌单并停止播放。
	 * @returns {void} 无
	 */
	clearPlaylist() {
		this.playlist.ids = []
		this.playlist.currentId = ''
		this.stopPlaylist()
	}

	/**
	 * 更新歌单（用于运行期改写当前曲目 / 播放状态）。
	 * @param {Partial<Aki.Playlist>} patch 修改项
	 * @returns {void} 无
	 */
	updatePlaylist(patch) {
		Object.assign(this.playlist, patch)
		this.commitPlaylist()
	}

	/**
	 * 丢弃歌单里已经不存在的角色，并在必要时重置当前曲目 / 播放状态。
	 * @returns {void} 无
	 */
	prunePlaylist() {
		const kept = this.playlist.ids.filter((id) => !!this.store.getCharacter(id))
		if (kept.length === this.playlist.ids.length) return
		this.playlist.ids = kept
		if (!kept.includes(this.playlist.currentId)) this.playlist.currentId = ''
		if (!kept.length) this.playlist.active = false
		this.commitPlaylist()
	}

	/**
	 * 落盘并广播歌单变化。
	 * @returns {void} 无
	 */
	commitPlaylist() {
		storageSet(PLAYLIST_KEY, this.playlist)
		this.emit('playlist', this.playlist)
	}

	/**
	 * 从歌单开始挂机播放（从当前曲目或第一首起）。
	 * @returns {Promise<void>} 完成
	 */
	async playPlaylist() {
		await this.runner.playPlaylist()
	}

	/**
	 * 页面加载后接着播放歌单（歌单仍标记为播放中时由入口调用）。
	 * @returns {Promise<boolean>} 是否已开始续播
	 */
	async resumePlaylist() {
		return this.runner.resumePlaylist()
	}

	/**
	 * 播放歌单里的某个角色（点击曲目 / 切歌）。
	 * @param {string} id 角色 id
	 * @returns {Promise<void>} 完成
	 */
	async playTrack(id) {
		await this.runner.playTrack(id)
	}

	/**
	 * 切歌：按方向播放歌单里相邻 / 随机的曲目。
	 * @param {number} direction 1=下一首，-1=上一首
	 * @returns {Promise<void>} 完成
	 */
	async stepTrack(direction) {
		await this.runner.stepTrack(direction)
	}

	/**
	 * 停止歌单挂机播放。
	 * @returns {void} 无
	 */
	stopPlaylist() {
		this.runner.stopPlaylist()
	}
}
