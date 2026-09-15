# AGENTS.md

Akinator 全自动答题助手：油猴脚本 + GitHub Pages 站点，共享同一套 `src/shared/` 核心。

- 用户视角 / 安装说明看 `README.md`；不常碰的实现细节与踩坑看 `INTERNALS.md`。

## 结构

- `src/shared/`：无环境依赖的核心。`akinator.mjs`（同源 HTTP 客户端与 `AkinatorError`；设置 `clientProvider: api` 时的内置会话 / 页面驱动失败时的兜底）、`engine.mjs`（录制/回放状态机）、`store.mjs` + `schema.mjs`（数据模型与按权重概率采样；`databaseToFiles` 把题库拆成文件夹结构）、`folder.mjs`（文件夹句柄读写：`readDatabaseFromDirectory` / `writeDatabaseToDirectory`）、`devotion.mjs`（本机厨力统计）、`character_state.mjs`（本机角色运行状态：候选策略 / 历史 / 已猜中 id）、`delay.mjs`（类人延时换算）、`protocol.mjs`（postMessage 协议）、`report.mjs`（日志报告文本生成）、`sponsor.mjs` + `sponsor.css`（自荐广告位）、`icons.mjs`（iconify/Lucide 内联 SVG 图标，**界面一律用它，不要 emoji**）、`constants.mjs`、`util.mjs`。
- `src/shared/i18n/`：fount 同款本地化核心（`geti18n`/`i18nElement`/`initTranslations`/`setLanguage`/`onLanguageChange`/`setLocalizeLogic`），`locale_match.mjs` 是前缀语言匹配（`FALLBACK_LOCALE = 'en-UK'`），语言包在 `locales/*.json`（`en-UK` + `zh-CN`，嵌套点分键，经 import attributes 加载）。
- `src/shared/template.mjs`：fount `async_eval` 模板系统（`${expression}` + `@steve02081504/async-eval`），API 为 `templatesFor(root)`（站点，运行时 fetch `views/`）与 `templatesFromSources(sources)`（油猴，esbuild `.html` text loader 内联）；渲染自动应用 `data-i18n`。模板文件里不做循环，列表在 JS 侧用 `renderListAsHtmlString(template, items)`。
- `src/shared/theme.mjs`：日夜模式（`applyTheme`、`nextTheme`、`getStoredTheme`/`storeTheme`、`watchSystemTheme`），取值 `auto`/`light`/`dark`，站点与油猴共用。
- `src/shared/lib/onElementRemoved.mjs`：fount 同款、被 i18n 依赖。
- `src/userscript/`：`index.mjs` 入口、`ad.mjs`（akinator 主页面左下角的浮动广告宿主，独立 Shadow DOM）、`page_client.mjs`（**页面驱动的 akinator 客户端**：点页面按钮 + 读 DOM / 页面自身的响应，见下）、`page.mjs`（akinator 游戏页接管，见下）、`navigation.mjs`（非游戏页 / 上一局已结束时先复刻 akinator 的「开始」POST `/game` 跳到游戏页，再自动续跑）、`foreground.mjs`（遮挡 / 后台时骗页面保持前台并换掉 rAF，免得切题动画停住）、`debug.mjs`（一键导出页面信息）、`session.mjs`（日志与会话快照的跨页面持久化）、`i18n.mjs`（薄装配：语言偏好存设置 `language`）、`persistence.mjs`（本地文件夹链接 / IDB 降级 / 云端拉取）、`bridge.mjs`（弹窗内桥）、`bell.mjs`、`gm.mjs`、`idb.mjs`。
  - `app/`：`index.mjs` = `App` 门面（设置 / 数据库 / 订阅 / 持久化 / 日志 / 会话快照 / 事件广播），`run.mjs` = `RunController` 运行状态机（`App` 只转发 `startRun` / `provideAnswer` / `provideProposal` / `resolveIntervention` / `stopRun`）。
  - `ui/`：`index.mjs` = `PanelUI` 生命周期（挂载 / 标签 / 状态 / 日志 / 角色编辑器的题目虚拟队列 / 拖拽展开）；`run_view.mjs` / `characters_view.mjs`（角色列表 + 角色编辑器，含可编辑的题目概率）/ `data_view.mjs` 各产出一个标签页的模板数据；`events.mjs` 把 DOM 事件翻译成 `App` 动作；`templates.mjs` 提供渲染 API 与共用视图片段。面板是 Shadow DOM + 模板渲染，模板在 `views/*.html`，构建期经 `scripts/build.mjs` 的 `.html`/`.css` text loader 内联。
  - **新增模板文件后必须同步在 `views/index.mjs` 注册**，否则运行期抛 `[template:missing]`（已有测试兜底）。
- `.github/pages/`：Pages 静态站源头。**项目站部署在 `/<repo>/`（即 `/akinator-auto-runner/`），相对路径要按真实层级写、不要靠浏览器把越界 `..` 钳回站点根**：`index.html` 在站点根，引用 `shared/...`；`scripts/*.mjs` 用 `../shared/...`；`scripts/<子目录>/*.mjs` 用 `../../shared/...`（组装后 `shared/` 落在站点根）。`index.html` 是静态壳（hero + 标签页 + 各面板），动态 HTML 全在 `views/*.html`；`scripts/` 内含 `i18n/index.mjs`（语言偏好存 localStorage `akinator-auto-runner:locale`）、`theme/index.mjs`、`parts/sponsor.mjs`、`lib/dom.mjs`（`elementById`/`valueOf`）。站点样式自包含在 `styles.css`，**不用外部 CSS CDN**。
- `src/types.d.ts`：仅作文档的 JSDoc 类型总表（`Aki.*`）。
- `data/`：内置题库文件夹（`index.json` 用 `characters[]` 列出各角色文件 + `characters/*.json`；加载器也兼容旧的 `packs[]`）。
- `scripts/build.mjs`：esbuild 只打包油猴脚本到 `dist/`；`scripts/assemble-pages.mjs` 负责组装站点（`assemblePages(outDir)`，CLI 默认就地组装 `.github/pages/`）；`.github/workflows/pages.yml` 在 CI 里 `npm run build` + 组装后部署 `.github/pages`。

## 关键设计决策（务必遵守）

### 必须在 akinator 源内执行

akinator 走 Cloudflare，跨域直连 403。脚本设计为在 `*.akinator.com` 页面（含被站点打开的弹窗内）运行，**由 akinator 页面自身的 JS** 用同源请求调 `/game`、`/answer`、`/exclude`、`/choice` 等；脚本只负责点页面按钮、读 DOM（见下「页面驱动」）。站点不直接请求 akinator，只通过弹窗 + `postMessage` 驱动它。

**不要把 akinator 塞进 iframe**：它回 `X-Frame-Options: SAMEORIGIN`，iframe 只会得到空框（脚本不注入，站点永远显示「未检测到脚本」）。站点「连接」改成 `window.open` 开独立窗口（`WINDOW_NAME` 复用同一窗口），脚本侧用 `window.opener` 当 peer。为防别的站点拿弹窗偷题库，脚本只在来源是 `SITE_ORIGIN`（`constants.mjs`）或本机回环时建立桥，消息也用具体 `targetOrigin` 而非 `'*'`。

### akinator 三阶段

- `POST /game` 返回 HTML，含 `session` / `signature` / `identifiant` 与首题、答案标签；**页面自身的 JS** 拿它发请求。脚本不解析它，只从 DOM 读题。
- 页面自身点按钮后：`/answer` 返回下一题，或**命题**（页面切到 `#proposeGameBlock`），或**认输**（既无题也无命题）。
- 命题阶段：页面的「是」发 `/choice`（游戏结束）、「否」发 `/exclude` 继续。
- 区域基址 `https://{region}.akinator.com`；`sid`：1=角色 2=物品 14=动物。站点用弹窗 url 切区域，脚本始终用 `location.origin`。
- **一局 = 一次 akinator 游戏**：akinator 每局结束后页面处于终态，必须重新 `POST /game`（整页跳转）才能再开一局。

### 页面驱动与页面接管（`page_client.mjs` / `page.mjs`）

- 引擎的客户端是 `PageAkinatorClient`：**点 akinator 页面上的作答 / 候选按钮**，让页面自身的 JS 提交请求、驱动精灵与进度，再从 DOM 读回下一步（`#question-label` / `#proposeGameBlock` / `#name_proposition` / `#img_character`）。**不要**改回自己 `fetch` 开会话：那样脚本的会话与页面的会话各走一步，脚本自动作答时页面（精灵 / 进度）不动，脚本失败后用户手动点击还会因为两边步数错位而报错。
- 页面答案按钮 id 是 `a_yes`/`a_no`/`a_dont_know`/`a_probably`/`a_probaly_not`（末一个是 akinator 自己的拼写，别改），索引读 `data-index`；候选 id 尽力从 `#id_proposition` 隐藏域 / `#a_propose_yes[data-id]` 读，读不到就退回按名字匹配。
- **认输以页面自身请求的响应为准**：`page_client.mjs` 给页面的 XHR / fetch 装只读观察器，`/answer` 响应里既无 `question` 也无 `id_proposition` 才算认输（有 `id_proposition` 即候选，还能拿到候选 id）。**别用 DOM「无题无候选稳定 N 秒」这类定时器判认输**：akinator 切题时会先收起旧题（题面空、按钮隐藏），慢加载会被误判成认输（曾连续踩坑）。拿到响应后还要等页面把新题 / 候选渲染出来（`#domReadyFor`）才返回；观察器记录比 DOM 晚一拍时用 `DOM_FALLBACK_GRACE_MS` 缓冲，避免用到上一次的旧响应。
- **「继续？」确认要自动点「是」**：点「都不是」后 akinator 常先弹一个 `继续？` 确认——它把 `#a_propose_yes/no` 藏起来、换成 `#a_continue_yes/no`，**还会把 `localStorage.game_ended` 置 `yes`**。`#continuePromptVisible()` 靠 `#a_continue_yes` 是否可见识别它，`#waitForStep` 里替用户点一次 `#a_continue_yes` 继续；`#classify` 在这种状态下返回 `undefined`（**不能**因为 `game_ended` 就认输），`#proposeVisible()` 也要求真正的是 / 否按钮可见。别用 DOM 文字（`继续？`）判断，它随语言变。
- `PageMirror` 只做两件事：把**真人**在页面上的点击翻译成引擎动作（`event.isTrusted` 为真才接管；脚本自己合成的点击放行给 akinator 页面，避免同一题提交两次），以及在引擎自己拿主意的倒计时 / 「纠正 / 追加」询问时浮一层 UI。问答本身由 akinator 页面渲染，**别再往页面上写题 / 写候选**。
- **底层提供商**由设置 `clientProvider` 决定（面板「高级设置」里有开关）：`page`=只用页面驱动；`api`=只用内置 HTTP 会话（自己 `POST /game`，页面看不到）；`auto`（默认）=先用页面驱动，页面操作出错（`PageAkinatorError`）就记一条日志并改用内置会话重跑这一轮。`App.createClient(provider)` 返回对应客户端；引擎的异常经 `handlers.onError` 冒泡给 `RunController` 判断，别把兜底逻辑写进引擎。
- 在**非游戏页**（首页 / 主题选择页）或**游戏页但上一局已结束**（`navigation.hasActiveQuestion()` 为假）时点开始：`RunController.startRun` 会先 `app.saveNow()` 落盘，再把运行参数暂存到 `PENDING_RUN_KEY`，并用 akinator 自己的方式（POST `/game`，字段 `sid`/`cm`/`anim`）跳到游戏页；`index.mjs` 页面加载后 `takePendingRun()` 自动续跑。**别改回在非游戏页直接跑引擎**：那样页面上什么都看不到。跳转会重新注入脚本，因此 `saveNow()` 还要顺带落盘本机角色状态与厨力（`CHARACTER_STATE_KEY` / `DEVOTION_KEY`），否则刷新后「已猜中 id」丢失。
- **多局 / 连续多次 `startRun` 会按「一局一次页面」自动重开**：页面驱动时 `RunEngine` 每次只跑一局（`rounds: 1`），跑完若还差局数，`RunController` 就再 `enterGamePage` 刷新页面续跑；`startRun()` 在发生刷新的那一次只返回已跑完的部分。站点 / 面板靠事件（`state` / `done`）感知，别依赖 `startRun()` 的返回值跨刷新。内置会话（`api`）可以一次跑完多局，不走刷新。
- 面板 / 站点的答案按钮一律用 `constants.mjs` 的 `ANSWER_I18N_KEYS` + `geti18n`，**不要**再用 akinator 返回的英文 `question.answers`。`bridge.mjs` 把站点来源缓存在 sessionStorage，以免弹窗内跳转后 referrer 变回 akinator 导致桥断开；运行中收到站点 `init` 时不整体替换题库（否则会冲掉刚续跑时录到的角色 / 答案）。
- 遇到「页面结构 / 响应形态不对」这类问题，先用 `debug.mjs` 的 `dumpPage`（面板日志栏的剪贴板按钮 / 油猴菜单）把当前页面的关键 DOM、`localStorage`、页面自身最近一次作答响应打包复制 + 下载，再据此改；**别靠猜**（认输判定已经因为猜 DOM 连续踩坑）。

### 数据主键、订阅与按需拉取

- 答案以**归一化问题文本**为主键（`normalizeQuestion`），`questionId` 仅作附带元数据（首题 HTML 里未必有 id，文本更稳）。
- **题目没有独立实体**：一道题只有挂在某个角色上才有意义，因此概率存在角色 `answers[key]` 里（`weights` 是五个回答的权重，`answer` 是角色选定项、`count` 是权重总和）。回放时 `RunEngine` 用 `sampleAnswerIndex` **按历史权重概率随机抽取**作答（不是永远取最大权重，免得总按同一个答案提交把别的可能压死）；`pickAnswerIndex`（取最大权重）只用于数据归一化兜底与编辑器展示。**回放不写回权重**：`source === 'recorded'` 且非录制模式时 `#commitAnswer` 直接返回，不累加选择次数（否则挂机回放会把权重无限膨胀）；只有录制复习、用户补充新题、以及「纠正 / 追加」干预才动题库。**不要改回每次回放都 `recordAnswer`**。**不要再引入全局题目表**（`Aki.Database` 只有 `characters`）。旧数据里只有 `answer`/`count` 的答案记录会被 `normalizeAnswerRecord` 迁移成一个单峰权重。
- **权重按最简整数比存储**：`reduceWeights`（`schema.mjs`）把所有非零权重同时除以它们的最大公约数（`[2,4,6,8,0]` → `[1,2,3,4,0]`），`Store.simplifyWeights` 对所有角色逐题约分并同步 `count`。编辑页保存（`ui/events.mjs` 的 `saveCharacter`）、合并（`Store.mergeCharacter` 内）与 `App.saveNow` 都会调用它；比例不变，故不影响回放采样。含小数权重（编辑器手填）或全 0 时原样保留。
- **没有全库合并 / 全库导入导出**：`mergeDatabases` 与合并策略已移除。数据只有两条来路——本地文件夹，或订阅。
- **本地文件夹就是题库本体**（`LocalFolderDatabase`，File System Access）：链接的文件夹含 `index.json` + `characters/*.json`，任何改动（录制 / 编辑 / 增删）都经 `saveNow` 自动写回；不支持 FS API 时降级为 IndexedDB 自动保存。**不要**再改回单文件本地库。
- **两类订阅**（`Aki.Subscription.kind`）：`list` 拉取角色列表，只登记带 `source.url` 与基础信息的**占位角色**（`source.loadedAt = 0`，答案为空），不拉角色正文；`character` 拉取单个角色数据，`Store.saveRemote(character, { placeholder: false })` 整体覆盖本地副本。单角色导出 / 订阅用 `source.url` 作为其「更新地址」。
- **按需拉取**：运行（`App.startRun`）或打开编辑器（`ui/events.mjs` 的 `editCharacter`）前会对带远程 `source.url` 的角色调 `App.loadRemoteCharacter` 拉取并覆盖，拉取失败只记日志、用本地副本继续。占位角色因此「打开前」始终是空答案。
- 每个角色带 `source` 记录来源 URL，便于单独更新。

### 挂机与认输策略

- 题库数据（`Aki.Database`）**只放可共享的东西**：角色基本信息 + 角色的 `answers`（含题目概率 `weights`），外加 `version` / `name` / `updatedAt` 信封；**没有** `meta`、也没有角色级运行期字段，更没有独立的题目表。
- 角色的候选策略与选择历史、akinator 猜中过的 id 属于**本机运行期状态**，放在 `shared/character_state.mjs`（`Aki.CharacterState`），由 `Store.characterState` 持有并在油猴侧以 `CHARACTER_STATE_KEY` 单独持久化，和 devotion 一样不进题库数据。
- `policy`：`auto`=候选命中就选、否则排除；`exclude`=永远排除（用于刷权重）。
- 候选阶段有 `onProposal` 回调；UI/站点可让用户选，`manual` 的排除会把策略锁定为 `exclude`（`store.recordChoice`，可用 `{ lockPolicy: false }` 跳过）。**录制时的排除只是在纠正 akinator 的错误猜测**，不代表角色不在 akinator 题库里，因此引擎在 `mode === 'record'` 时不锁定策略——否则录完之后回放会永远「都不是」，命中不了正确候选。
- 命中判定（`store.guessMatches`）看本机记住的猜测 id 与角色名 / 别名；只有猜中才会记住 id。
- **命中时顺带同步资料**：`onGuess(autoCorrect: true)` 会调 `Store.syncFromGuess`，用 akinator 猜测里的名称 / 描述 / 图片覆盖本地旧值（**值相同就不动**；改名时旧名进 `aliases`），并记一条 `logs.metadataSynced`。只在命中的那一步同步，候选展示（「都不是」）不动本地数据——候选可能是错的。
- 每局的 runs/wins 只统计在本机 devotion（`shared/devotion.mjs`，`App.onRoundEnd` 里记录），引擎不再往题库写运行统计。
- 是否询问候选、是否响铃 / 弹通知都取决于**本次运行的 mode**（`App.#decideProposal` / `#requestAnswer` 的 `mode` 参数），别改回读 `settings.mode`：录制时必定询问候选，且不响铃 / 不弹通知（人就在页面上作答，通知只会打扰）。
- 提醒要**等用户静默满 `settings.bellDelayMs`（默认 60s）**才响：`App.#scheduleBell` 按 `lastUserActionAt` 算剩余时间，用户每作答 / 选候选一次（`provideAnswer` / `provideProposal`）就清掉待响的定时器。

### 歌单与播放器（本机挂机队列）

- 歌单是**本机运行期状态**（`PLAYLIST_KEY`，不写进题库数据），纯逻辑在 `shared/playlist.mjs`（`ensurePlaylist` / `addToPlaylist` / `nextTrackId` …），由 `App` 持有，改动一律经 `App.commitPlaylist()` 落盘并广播 `playlist` 事件。角色被删除时 `App.prunePlaylist()` 会把它从队列里摘掉。
- 三种播放模式（`Aki.PlaylistMode`）：`loop`=顺序循环、`shuffle`=随机（尽量避开当前曲目）、`single`=单曲循环。**单曲播放的「自动续播」仍是同一首，但手动左右切歌仍换角色**（`nextTrackId(playlist, { auto })` 用 `auto` 区分）。
- 队列播放用 `startRun({ ..., queue: true })` 标记：一首跑完 `RunController.#continuePlaylist` 按模式挑下一首、把 `currentId` 写回歌单，再 `enterGamePage` 跳游戏页（页面驱动每局都要刷新），由「待运行」机制在刷新后续播。**别改成接着旧会话跑**。手动开跑（非 `queue`）会退出歌单播放；停止按钮走 `stopPlaylist()`。
- 歌单续播**不能只靠「待运行」参数**：参数会被消费、也会在 `PENDING_RUN_TTL_MS`（60s）后失效（页面在后台被节流 / 延迟跳转、用户手动刷新时很容易发生），结果留下「歌单还标记着播放、唱片在转但引擎停了」的空转。因此 `index.mjs` 在加载、且没有待运行参数时，若 `playlist.active` 就调 `App.resumePlaylist()` 从当前曲目续播（仅顶层窗口，`!isBridged`，免得站点弹窗也跟着抢跑）。运行页停止按钮也走 `stopPlaylist()`（见上），保证停下的同时把 `active` 清掉。
- 面板新增「播放器」标签页（`ui/player_view.mjs` + `views/player.html` / `playlist-track.html`）：唱片用角色头像做标签、`playing` 时 CSS 旋转（`animation-play-state`），进度条是 akinator 的**置信率**（`runState.progression`）。`state` 事件只在**就地**刷新进度条 / 唱片类名（`PanelUI.renderPlayerProgress`），**别整页重建**——重建会让唱片动画从头转。
- 角色卡（`views/character-card.html`）上的「加入歌单」按钮是 `data-action="toggle-playlist"`；歌单视图里的曲目用 `playlist-play-track` / `playlist-remove`，控制条用 `playlist-play` / `playlist-pause` / `playlist-prev` / `playlist-next` / `playlist-mode` / `playlist-clear`。

### 面板运行页只做局部刷新

- 运行页（`views/run.html`）顶部控件（模式开关 / 目标选择 / 高级设置 / 起停按钮）不随每步作答变化，**随进度变化的区块**（`run-status` / `session` / `created` / `ask` / `proposal` / `guess` / `delay` / `intervention`）单独收在 `[data-role="run-parts"]`（模板 `views/run-parts.html`）里，由 `PanelUI.renderRunParts()` 就地重渲染。
- 状态事件只在**运行开始 / 结束**（`running` 变化）时整体 `renderBody` 一次（顶部按钮的启用态、录制指示等要跟着变），其余每步只 `renderRunParts`；`ask` / `proposal` / `delay` / `intervention` / `created` 等运行期事件经 `#showRunBlock`，已停在运行页时也只刷新区块并滚到对应卡片。**别改回每步整体重渲染**：那会重置滚动位置、收起 `<details>`、冲掉输入焦点。
- `#showRunBlock` **默认只在用户已停在运行页时动作**：用户切到角色 / 数据页或正在编辑角色时，运行期事件只更新状态、不 `this.tab = 'run'`、不渲染出题区块。**别改回一律把用户拽回运行页**（曾导致编辑途中被出题打断）；用户在 akinator 页面上照样能作答，切回运行页时会看到最新状态。**唯一的例外是需要人补充答案 / 拍板**：`ask(reason='unknown')` 与 `intervention` 传 `{ focus: true }`，此时才切回运行页；`ask(reason='record')` / `proposal` / `delay` / `created` 仍不打扰当前标签页。
- **点播放 / 点标签页不改运行页归属**：角色卡的 `run-character` 不强制 `ui.tab = 'run'`（留在当前标签页），标签页切换一律走 `PanelUI.setTab()`。
- **面板状态跨 akinator 每局刷新保持**：`PanelUI` 把标签页 / 展开 / 收起写进 `UI_STATE_KEY`（`setTab` / `setExpanded` / `toggleCollapsed` 里 `#persistState`），`mount` 时 `loadPanelState` 还原。别把默认 `tab = 'run'` 当成刷新后的必然状态——播放器页 / 展开态都要原样回来。
- **编辑态只属于「角色」标签页**：`PanelUI.#inEditor()`（`editing && tab === 'characters'`）统一决定是否显示编辑器，`renderBody` / `#bodyData` / 各事件回调与 `events.mjs` 的 `handleInput` / `handleChange` 都用它。用户编辑途中切到别的标签页（比如去答题页补充问题）看到的是那个标签页，切回角色页草稿仍在。**别改回 `this.editing ? 'editor' : this.tab`**：那会让编辑器盖到每个标签页上（曾出这个 bug）。

### 类人延时与「纠正 / 追加」

- `shared/delay.mjs` 把 `settings.stepDelayMs`（默认 5000，含义是「平均每步耗时」）换算成实际等待：`humanDelayMs(base, { textLength, date })` = 平均值 × 随机扰动（±30%）× 时段系数（凌晨 3 点 / 午后 12:30 峰值为 +30%）+ 读题时间（每字符 20ms，上限 3s）。基数为 0 时不延时（测试里靠它跳过）。
- 只有**引擎自己拿主意**的决定才延时：回放查表、**录制时复习已答过的题**（录制不再逐题必问）、候选自动选择；用户手动作答不延时（人本身就是那个延时）。引擎在 `RunEngine.#applyDelay` 里等，经 `handlers.onDelay` 交给 App。
- `App` 的 `#awaitDelay` 广播 `delay` 事件（面板 / akinator 页面 / 站点各画一条倒计时进度条），期间作答按钮保持可点。用户点了**不同的**答案就广播 `intervention`，由 `resolveIntervention('correct' | 'append')` 决定：`correct`=把该角色这题的权重重置为单峰并覆盖角色答案（`store.correctAnswer`），`append`=只给这次答案加一份权重（`store.recordAnswer`）。
- 站点侧走 `MessageType.delay` / `MessageType.intervention`（脚本 → 站点）与 `command: { action: 'interrupt' | 'intervene' }`（站点 → 脚本）；`interrupt` 与 `answer` 等价（App 自己分辨是抢答还是常规作答）。

### 「边录边建」：录制不必先建角色

- `App.startRun` 接受 `Aki.StartRunRequest`（`Partial<RunOptions> & { draft?: Partial<Character> }`）；`mode === 'record'` 且没有 `characterId` 时会即时 `store.addCharacter` 一个占位角色（名字留空则用 `run.autoName` 生成时间戳名）。
- 运行结束后 `App.finishRecord` 用 akinator 最后一次猜测回填角色：只有「自动命名」的才覆盖名字（旧名进 `aliases`），图片 / 描述仅在字段为空时补；一个字都没录到则 `removeCharacter` 丢弃占位角色，并广播 `created` 事件（`discarded: true`）。
- **录到的是题库里已有的同一个角色时并入它**：回填后用 `Store.findDuplicate`（按名称 / 别名、忽略大小写）找同名角色，命中就 `Store.mergeCharacter` 把各题权重逐项相加（约成最简整数比）、题目取并集、基础资料只补空，再 `removeCharacter` 丢掉占位角色，`created` 事件带上 `merged: true` 且 `id` 指向现有角色（两端结果卡用 `run.mergedTitle` / `run.mergedHint`）。别改回「永远新建一个」。
- `created` 事件经油猴 `bridge.mjs` 以 `MessageType.characterCreated` 转发给站点；两端都据此弹「结果卡」并选中新角色。
- 两端运行页都有一枚 segmented 模式开关；录制模式保留角色下拉，并多一条空值选项「新建角色」：选定已有角色就直接续录它（只在这一步才需要把 `characterId` 传进 `startRun`），选「新建角色」才用名字输入（留空自动命名）建占位角色。站点侧用 `state.runCharacterPicked` 记住用户是否显式选过角色——没选过时切到录制默认「新建角色」，免得把新题录进题库里的第一个角色。

### 赞助位是刻意保留的广告

- `src/shared/sponsor.mjs` 定义了一条自荐赞助位（fount 项目）与 `sponsorData(variant)`（含内联 SVG 图标），样式在 `src/shared/sponsor.css`，HTML 在两端的 `views/sponsor.html`。
- **油猴的广告挂在 akinator 主页面**（`src/userscript/ad.mjs` 注入 `#akinator-auto-runner-ad`，固定左下角、独立 Shadow DOM），**不在脚本面板里**；被站点弹窗内嵌时不注入（站点自己有广告）。站点顶部保留一处 banner。
- 带「广告」角标、AdChoices 说明、slot 标识与关闭按钮（关闭后 24h 内不再显示，存于 `akinator-auto-runner:sponsor`）。**不要移除广告位**，也**不要移除 akinator 页面上的广告**——脚本只关闭弹窗的「回官方站」提示（`#notOfficial`）。
- **类名一律用 `aki-card*`，别用 `aki-ad*`**：akinator 的反广告脚本（页面上 `prebid` / `html-load.com` 那套）会扫描样式表，把「选择器长得像广告屏蔽规则」的整张表作废（实测 `.aki-ad`、`[id$="-ad"]` 中招，`.aar-*`、`[data-ad-slot]` 没事），会表现为广告元素在、样式全丢。开广告拦截时该脚本被拦掉所以反而正常。`tests/sponsor.test.mjs` 会兜住这个约束。

### 跨页面状态与日志

- akinator 每个页面重载都会重新注入脚本，内存里的运行状态必然丢失，**不要假装能续接 akinator 会话**；续跑靠「重开一局 + 待运行参数」而不是接着旧会话。
- `App.logs` 与会话快照（`Aki.SessionSnapshot`）通过 `src/userscript/session.mjs` 写进油猴存储（`akinator-auto-runner:logs` / `:session`，日志上限 `MAX_LOG_ENTRIES`）。日志一律走 `App.pushLog`（内存 + 防抖持久化 + 广播），别再直接 `emit('log')`。快照的中断判定与防抖写入细节见 `INTERNALS.md`。
- 面板「继续上次会话」务必把 `session.characterId` 传进 `#startRun`（录制模式也要）：否则录制分支会当成没有目标角色、又建一个占位角色。
- akinator 走 Cloudflare，会偶发返回挑战页 / HTML 或 5xx；页面驱动下这些都由 **akinator 页面自身的 JS** 承受，脚本只等 DOM 变化（`PageAkinatorClient.STEP_TIMEOUT_MS`），超时报错结束本局即可，别在脚本里再自己发请求或重试。
- 日志报告用 `shared/report.mjs` 的 `formatLogReport(meta, entries)`；油猴面板与站点都有下载按钮，站点还会在 `pong` 时用脚本 `hello.logs` 回填日志面板。

### 本机数据不进题库

`devotion.mjs`（厨力）与 `character_state.mjs`（候选策略 / 历史 / 已猜中 id）都只存本机（`DEVOTION_KEY` / `CHARACTER_STATE_KEY`，经 `gm.js` 存油猴存储或 localStorage），不写入共享 JSON；站点通过 `postMessage` 的 `database` 消息接收题库后仅展示。**任何角色级运行期字段都不许再往 `Aki.Character` 里加**。

### 构建与 lint

- **不要**再生成 `docs/`：站点源头就是 `.github/pages/`（本地预览直接开它即可）；`npm run build` 只产油猴脚本，站点组装只在 CI 里跑（`scripts/assemble-pages.mjs` 就地拷入 `shared/`、`data/`、脚本），**本地不要跑组装**，免得往站点源头里塞副本。
- 依赖一律写 `latest`、**不跟踪锁文件**（`package-lock.json` 等已在 `.gitignore`）；CI 用 `npm install --ignore-scripts`（不是 `npm ci`）。Pages 用 Actions 源（`build_type=workflow`）。
- ESLint 使用用户全局配置（`$HOME/eslint.config.mjs`，Deno 版 eslint）。用 `eslint . --quiet` 判成败，**只追 0 error，不追 warning**。
- 该配置的 `no-extra-parens` 会删掉 JSDoc 类型转换所需的括号，因此**禁用表达式级 JSDoc 转换**，改用 `util.mjs` 的 `asRecord` / `asArray` 跟 `schema.mjs` 的 `ensureDatabase`。
- 项目**不做 tsc 检查**；JSDoc 仍然要写全，且**不允许出现 `any`**（用 `unknown` / `Record<string, unknown>` / 具体 `Aki.*` 类型）。
- 风格：tab 缩进、无分号、单引号、`curly: multi`（单语句分支不加花括号）、`import/order` 分组字母序。

### 测试约定

- 运行 `npm test`（`node --test --test-concurrency=1`，playwright-core + 本机 Chrome/Edge，可用 `CHROME_PATH` 指定）。
- `tests/mock-akinator.mjs` 是模拟服务器：`setScenario([...])` 注入后续 `/answer` 剧本（`question` / `proposal` / `defeat`；`garbage` 返回非 JSON，用来验证重试）；游戏页（`GET /` 与 `POST /game`）带**页面自身的 JS**：点答案 / 候选按钮由页面自己发请求、自己更新 DOM（并像 akinator 一样先收起旧题、再用 `requestAnimationFrame` 调度、默认 200ms 后显示新题来模拟切题过渡——真实 akinator 的过渡靠动画帧驱动，窗口被遮挡时会停摆，故测试可据此模拟；时长用 `window.__mockTransitionMs` 可拉长，结束时置 `localStorage.game_ended`），`window.__pageClicks` 记录页面处理过的点击，`getGamePosts()` 统计 `POST /game` 次数（用于断言脚本没自己开会话）；设 `window.__mockRequireContinueConfirm = true` 会让「都不是」先弹 `继续？`（`#a_continue_yes/no`）以模拟 akinator 的二次确认；`/theme-selection` 返回无游戏区块的选择页，用于验证先跳游戏页；剧本只作用于首题之后的 `/answer`。剧本用尽后返回最后一项，**若最后一项是 `proposal` 会让候选 `while` 循环空转**，记得在末尾补 `{ kind: 'defeat' }`。
- `tests/userscript.test.mjs` 通过 `page.addInitScript` 注入 `dist` 里的脚本，用 `window.__akinatorAutoRunnerApp` 驱动，覆盖：候选命中、录制入题库、缺题询问、候选排除、主页面广告宿主、边录边建（自动成型 / 空占位丢弃 / 面板点击 / 与现有同名角色合并）、重复作答的权重累计、回放不再增加选择次数、角色编辑页的概率虚拟队列与新权重回放按权重概率作答、类人延时的倒计时与「纠正 / 追加」（含倒计时期间点面板答案按钮）、日志 / 会话跨刷新、日志下载与清空、**页面驱动（只点 akinator 页面自身按钮、不另开会话 / 切题过渡不误判认输）**、**前台欺骗（窗口被遮挡 / 后台时切题过渡仍能跑完：覆盖 `visibilityState` / `hasFocus`、把 rAF 换成 `setTimeout`）**、**提供商（`api` 走内置会话、`auto` 页面失败兜底）**、页面接管（页面按钮作答 / 选候选 / 倒计时浮层抢答 / 非游戏页先跳游戏页再自动开跑）、通知只在回放且静默满期后响、自动作答只刷新题目区块而保留顶部控件、题库数据只含角色信息与题目概率。**同一页面再开一局会刷新页面并由「待运行」机制续跑**，需要在开跑前装监听器（录制 / 延时 / 干预）的用例改用 `openPageInContext()` 把第二局跑在干净的游戏页上；测兜底时可用 `window.__akinatorAutoRunnerStepTimeoutMs` 把页面等待缩短。
- `tests/delay.test.mjs` 纯 node 校验 `shared/delay.mjs` 的换算（随机抖动 / 时段系数 / 读题时间），不依赖浏览器。
- `tests/site.test.mjs` 静态服务组装的站点（`buildSite()` 组装到临时目录）。`startStaticServer(dir, prefix)` 支持挂在子路径（如 `/akinator-auto-runner`）下，专门兜住「靠 `..` 钳位才能跑」的站点相对路径错误。
- `tests/bridge.test.mjs` 端到端验证站点 ↔ 弹窗脚本：context 级 `addInitScript` 注入脚本，`context.route('https://en.akinator.com/**')` 把弹窗请求转给 `mock-akinator`，点「连接」后断言 `#connection.is-connected`、`init` 回传（弹窗脚本库名变成站点的 `packs`）、弹窗内同源跳转后桥仍连着（referrer 变回 akinator 也不断）、站点远程驱动一次录制运行、关窗回到未连接。改协议 / 桥 / 站点运行流程时同步补这里。
- 写测试时：取消监听用 `app.on()` 返回的函数，别 `listeners.get('ask').clear()`（会连面板的监听一起清掉）；`stepDelayMs: 0` 关掉延时，测试里默认这么传以免白等，要测倒计时就传大值再在 `delay` 事件里作答或 `provideAnswer`；新增列表页照 `PanelUI` 的虚拟队列模式（见 `INTERNALS.md`），别一次性 `renderListAsHtmlString` 几百行。
- 改动协议 / 引擎 / 数据模型时同步补测试。
