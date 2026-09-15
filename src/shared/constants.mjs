/**
 * 跨模块共享的常量：仓库地址、答案索引、区域、模式等。
 * @module shared/constants
 */

/** GitHub 仓库所有者。 */
const REPO_OWNER = 'steve02081504'

/** GitHub 仓库名。 */
const REPO_NAME = 'akinator-auto-runner'

/** 默认分支。 */
const REPO_BRANCH = 'master'

/** GitHub Pages 站点根地址（必须以斜杠结尾）。 */
export const PAGES_URL = `https://${REPO_OWNER}.github.io/${REPO_NAME}/`

/**
 * 允许通过 `postMessage` 驱动脚本的站点来源。
 *
 * 浏览器上报的 referrer 只保留源（`https://steve02081504.github.io`），不含路径；
 * 本地开发 / 测试走 `localhost` / `127.0.0.1` 回环，另由脚本放行。
 */
export const SITE_ORIGIN = `https://${REPO_OWNER}.github.io`

/** 油猴脚本安装地址。 */
export const USERSCRIPT_URL = `${PAGES_URL}akinator-auto-runner.user.js`

/** 云端题库数据根地址。 */
export const DATA_BASE_URL = `${PAGES_URL}data/`

/** 仓库网页地址。 */
export const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`

/** GitHub「新建文件」地址前缀，用于贡献 PR。 */
export const REPO_NEW_FILE_URL = `${REPO_URL}/new/${REPO_BRANCH}`

/** 数据格式版本。 */
export const DB_VERSION = 1

/** 五个答案的英文键，顺序即协议索引顺序。 */
export const ANSWER_KEYS = ['yes', 'no', 'dont_know', 'probably', 'probably_not']

/** 五个答案的英文标签（API 未返回时兜底）。 */
export const ANSWER_LABELS = ['Yes', 'No', 'Don\'t know', 'Probably', 'Probably not']

/** 五个答案对应的 i18n 键（顺序即协议索引顺序，界面上一律优先用它）。 */
export const ANSWER_I18N_KEYS = ['answers.yes', 'answers.no', 'answers.dontKnow', 'answers.probably', 'answers.probablyNot']

/** akinator 的题库类型（sid 参数）。 */
export const SID = {
	character: 1,
	object: 2,
	animal: 14,
}

/** 设置项在 GM 存储 / localStorage 中的键前缀。 */
export const SETTINGS_KEY = 'akinator-auto-runner:settings'

/** 订阅的云端题库地址设置键。 */
export const SUBSCRIPTION_KEY = 'akinator-auto-runner:subscriptions'

/** 本机「厨力」统计存储键（不进入题库数据）。 */
export const DEVOTION_KEY = 'akinator-auto-runner:devotion'

/** 本机角色运行状态（候选策略 / 选择历史 / 已猜中 id）存储键（不进入题库数据）。 */
export const CHARACTER_STATE_KEY = 'akinator-auto-runner:character-state'

/** 本机「歌单」（挂机播放队列：角色 id 顺序、播放模式、当前曲目）存储键（不进入题库数据）。 */
export const PLAYLIST_KEY = 'akinator-auto-runner:playlist'

/** 面板界面状态（标签页 / 展开 / 收起）存储键：akinator 每局刷新后据此还原面板。 */
export const UI_STATE_KEY = 'akinator-auto-runner:ui'

/** 运行日志存储键（跨页面保留，便于刷新后仍能看到 / 下载）。 */
export const LOG_KEY = 'akinator-auto-runner:logs'

/** 最近一次运行会话快照的存储键（跨页面保留，防止刷新丢上下文）。 */
export const SESSION_KEY = 'akinator-auto-runner:session'

/** 待运行的参数存储键：在非游戏页点开始时暂存，跳到游戏页加载后自动续跑。 */
export const PENDING_RUN_KEY = 'akinator-auto-runner:pending-run'

/** 日志最多保留条数。 */
export const MAX_LOG_ENTRIES = 500

/** 运行日志的文件名前缀。 */
export const LOG_FILE_PREFIX = 'akinator-auto-runner-logs'
