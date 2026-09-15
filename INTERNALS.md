# INTERNALS.md

不常碰、但改动时会踩坑的实现细节。日常开发先看 `AGENTS.md`。

## 面板 UI 细节

- 面板标题栏含语言 / 主题 / 展开 / 收起四枚开关；展开态给宿主加 `aar-expanded` 类并把内联定位改成四周 `8px`，面板因此半透明铺满屏幕、四周只留一圈透明边。
- 标签页 / 展开 / 收起经 `PanelUI.#persistState()` 写进 `UI_STATE_KEY`（`akinator-auto-runner:ui`），`mount()` 里 `loadPanelState()` 还原：akinator 每局刷新重建面板后，用户仍停在上次的标签页、保持展开态。`setExpanded(true)` 在 `mount` 里调用时宿主的初始内联定位（`right/bottom: 16px`）会先被 `floatStyle` 记住，再改成 `8px`。
- 角色编辑器的题目概率列表（`PanelUI`）走**虚拟队列**：`editorData` 只把该角色 `answers` 排序后存进 `editorQueue`，`renderEditorChunk` 每批渲染 `CHUNK_SIZE` 行（`question-weights` + `weight-row`），`#watchEditorQuestions` 用 IntersectionObserver 观察列表末尾的 `[data-role="editor-question-more"]` 哨兵，滚到附近再 `#appendEditorChunk`。新增列表页也照这个模式，别一次性 `renderListAsHtmlString` 几百行。
- 概率输入框改的是**编辑器草稿**（`ui.editing.draft.answers`），`handleInput` 里就地重算百分比与分布条、不重渲染，避免打断输入；保存时才整体写回 `store.updateCharacter`。

## 页面驱动（`page_client.mjs`）

- `PageAkinatorClient.answer()` / `exclude()` 会 `element.click()` 点 akinator 页面按钮，然后等页面自己提交完。**不要**在点击后自己发请求：页面自身的 JS 才是真相来源。
- **候选「是」后必须等 `/choice` 汇报走完**：akinator 靠这条请求计数并汇报本局选择；多局 / 歌单循环时脚本若抢在它返回前就 `POST /game` 开下一局，页面被导航走、汇报被中断，选择不会被 akinator 记入统计（曾踩坑）。`isStepUrl` 因此也观察 `/choice`，`choose()` 点击后经 `#waitForChoice` 等到页面自身的 `/choice` 响应（超时只放弃等待、不影响本局结果）。
- **认输必须来自页面自身请求的响应**：`installResponseObserver()` 给页面的 `XMLHttpRequest` / `fetch` 装一个**只读观察器**（不自己发请求、不碰响应体），把 `/answer`、`/exclude`、`/cancel_answer` 的 JSON 记下来。响应里没有 `question`、也没有 `id_proposition` 才是认输；有 `id_proposition` 就是候选（还能拿到候选 id）。只看 DOM 判断认输必然出错：切题时页面先收起旧题（题面空、按钮隐藏），加载慢时这段空态会被错当成认输——**别再加「无题无候选稳定 N 秒就当认输」这类定时器**。
- **「继续？」确认**：点「都不是」后 akinator 会先弹 `继续？`（`#a_continue_yes/no` 可见、`#a_propose_yes/no` 被藏起，`localStorage.game_ended` 被置 `yes`）。`#waitForStep` 看到 `#a_continue_yes` 可见就替用户点一次，再等 `/exclude` 响应；`#classify` 此时返回 `undefined`、`#proposeVisible` 也要求真正的是/否可见，**别把 `game_ended` 当认输**（它在确认时就已置 yes）。判断只认按钮 id，别认文案。
- 拿到响应后还要等页面把新题 / 候选渲染出来（`#domReadyFor`）才返回，否则下一次点击会落在还没渲染好的页面上。观察器的响应记录是异步的，可能比 DOM 渲染晚一拍，所以「没看到响应、只看 DOM」的分支要等 `DOM_FALLBACK_GRACE_MS` 缓冲，免得用上一次的旧响应（曾出现「已排除 other，却把后续 pika 也当成 other」）。没有观察到响应时退回看 DOM，此时认输只认 `localStorage.game_ended` 由假变真（akinator 自己写的结束标志）。
- `PageMirror` 只接管 `event.isTrusted` 为真的点击（真人），脚本自己合成的点击必须放行给 akinator 页面，否则同一题会被提交两次（真人点一次 + 引擎再点一次）。
- 每局结束页面进入终态，`navigation.hasActiveQuestion()` 靠「问题文本非空 + 至少一个答案按钮可见」判断；为假时 `RunController` 直接 `enterGamePage` 刷新续跑，所以一局只跑一局（`rounds: 1`），多局由刷新 + `PENDING_RUN_KEY` 串起来。副作用：`RunEngine.state.round` / `rounds` 每页都从 1、每页只显示 1 局，跨页的局数与胜负请看 devotion（真实胜负统计在那里累计）。
- `App.saveNow()` 现在会**同步落盘** `CHARACTER_STATE_KEY` / `DEVOTION_KEY`：跳转/刷新会重建页面，若只依赖防抖写入，刷太快会把「已猜中 id」丢掉，回放退化成只按名字匹配。
- 提供商兜底：页面驱动抛的是 `PageAkinatorError`（继承 `AkinatorError`），引擎在 `catch` 里把它交给 `handlers.onError`；`RunController` 据此在 `clientProvider: auto` 下改用内置 `AkinatorClient` 重跑整轮（内置会话自己 `POST /game`，页面看不到，属正常降级）。判断不要靠错误文本。
- 回放取答案是 `sampleAnswerIndex`（按 `weights` 概率采样），不是 `pickAnswerIndex`（取最大）；后者只在数据归一化 / 编辑器展示里用。改这里会让测试里「多峰权重」的回放变得随机，写测试时想让结果确定就只留一个非零权重。
- 测试里可用 `window.__akinatorAutoRunnerStepTimeoutMs` 缩短页面等待、用 `window.__mockTransitionMs` 拉长 mock 的切题过渡。

## 遮挡 / 后台时保持前台（`foreground.mjs`）

- `index.mjs` 在 **document-start 同步**调用 `keepPageForeground()`（在页面自身脚本之前），否则页面已经缓存了原生 rAF / 读到过 hidden，再改就晚了。
- 覆盖 `document.hidden` / `visibilityState` / `webkit*` / `hasFocus` 只对**页面自己读这些值然后暂停**的逻辑有用；浏览器对隐藏标签的**定时器 / rAF 节流发生在调度层，JS 改属性骗不过它**，所以必须同时把 `unsafeWindow.requestAnimationFrame` 换成 `setTimeout(fn, 16)`（`cancelAnimationFrame` 配套），绕开「窗口被遮挡时 rAF 被暂停」。被完全隐藏的标签里 `setTimeout` 仍会被节流到 ~1s，但比 rAF 全停好。
- 覆盖属性 + 补发 `visibilitychange` / `focus` 后，被暂停的页面循环才会恢复；对已经在前台的页面无副作用。测试用 `tests/userscript.test.mjs` 的 `simulateBackground()`（在用户脚本之前把 rAF 换成不回调的空实现、`document` 报 hidden）来复现，断言过渡仍能跑完。

## 调试 dump（`debug.mjs`）

- 面板日志栏的剪贴板按钮 / 油猴菜单的「导出页面信息」会把当前 akinator 页的关键信息（两个游戏区块的可见性与 `outerHTML`、所有 `a_*` 按钮的 id/文案/`onclick`、`localStorage` 的 session/pid/step/progression/game_ended、`PageAkinatorClient` 最近一次观察到的作答响应、当前运行状态）打包：复制到剪贴板 + 下载 JSON。
- 页面结构 / 响应形态对不上时**先 dump 再改**，别靠猜（认输判定、候选 id、`继续?` 这类问题都是靠猜连续踩坑才补上 dump 的）。

## 桥与站点下发题库

- `Bridge.#handleInit` 在**运行中**（`app.runner.engine` 存在）不整体替换题库：页面驱动下每局都会刷新、续跑在刷新后立即开始，此时若被站点 `init` 的 `databaseText` 覆盖，会把刚录到的角色 / 答案冲掉（表现为测试里角色还在、但这道题的记录没了）。

## 会话快照的持久化

- 防抖写入必须**在触发时读取当下的 `this.lastSession`**，不能捕获调用时的快照：运行收尾会直接写 `running: false`，而先前排队的那次 `running: true` 写入若晚到就会把它盖回去，下次进页面便误报「上次会话被中断」。
- 构造 App 时若快照仍是 `running`，说明上次被刷新 / 跳转打断：置 `sessionInterrupted` 并立刻把快照标成 `running: false`；面板据此在运行页显示「上次会话」卡（继续该角色 / 忽略）。

## 模板求值（`async-eval`）

- 模板里的 `${...}` 由 `async-eval` 求值，**引用未在数据里出现的标识符会抛 ReferenceError 并退化成字面量文本**（静默污染 HTML）。渲染 `option` 等模板时务必把每个 `${}` 用到的字段都传进去（含 `selected` 这类布尔）。
- 缺字段时 `formatTemplate` 会对同一段模板反复试探更长的表达式并逐个报错，**列表逐项渲染时会被放大到卡死**（曾有列表页漏传字段，点进去直接冻结整个页面）。
