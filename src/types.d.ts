/* global PermissionState */

/**
 * 全局类型声明（JSDoc 通过 `Aki.*` 引用）。
 * 同时声明运行时可选的宿主 API（油猴管理器注入）。
 */

declare function GM_setValue(key: string, value: unknown): void;
declare function GM_getValue<T = unknown>(key: string, defaultValue?: T): T;
declare function GM_deleteValue(key: string): void;
declare function GM_listValues(): string[];
declare function GM_addStyle(css: string): HTMLStyleElement;
declare function GM_notification(details: {
  title?: string;
  text?: string;
  timeout?: number;
  onclick?: () => void;
}): void;
declare function GM_registerMenuCommand(name: string, callback: () => void): void;
declare function GM_xmlhttpRequest(details: Record<string, unknown>): void;
declare const GM_info: { script: { version: string; name: string } } | undefined

declare const unsafeWindow: (Window & typeof globalThis) | undefined

declare module '*.css' {
  const content: string
  /**
   *
   */
  export default content
}

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemDirectoryHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
}

interface Window {
  chooseAnswer?: (index: number) => void
  jouer?: () => void
  __akinatorAutoRunner?: { version: string; top: boolean }
  showDirectoryPicker(options?: unknown): Promise<FileSystemDirectoryHandle>
}

declare namespace Aki {
  /** 单题的答案记录，键为归一化问题文本。 */
  interface AnswerRecord {
    /** 协议答案索引：0=是 1=否 2=不知道 3=可能是 4=可能不是。 */
    answer: number;
    /** 录制时的原始问题文本。 */
    question: string;
    /** akinator 提供的问题 id（若已知）。 */
    questionId?: string;
    /** 五个回答的权重（下标即答案索引）；回放按权重概率随机作答，可在角色编辑页手改（保存时约成最简整数比）。 */
    weights: number[];
    /** 权重总和（观测 / 编辑后的总权重）。 */
    count: number;
    /** 最后更新时间戳。 */
    updatedAt: number;
  }

  /** 某角色在本机的运行状态（不进题库数据）。 */
  interface CharacterStateRecord {
    /** 候选策略：auto=有匹配就选、否则排除；exclude=永远排除（用于挂机刷权重）。 */
    policy: 'auto' | 'exclude';
    /** 候选选择历史（最多 50 条）。 */
    history: ChoiceRecord[];
    /** akinator 猜中过的候选 id，用于下次按 id 直接命中。 */
    guessed: string[];
  }

  /** 本机全部角色的运行状态。 */
  interface CharacterState {
    characters: Record<string, CharacterStateRecord>;
  }

  /** 一次候选选择的记录。 */
  interface ChoiceRecord {
    at: number;
    /** 命题基 id。 */
    baseId: string;
    /** 候选列表（id + 名称）。 */
    candidates: { id: string; name: string }[];
    /** 动作：pick=选中某项，exclude=都不是。 */
    action: 'pick' | 'exclude';
    /** 选中项 id（action=pick 时）。 */
    pickId?: string;
    /** 是否由用户手动决定。 */
    manual?: boolean;
  }

  /** 一个候选角色（来自 /answer 或 /ws/list.php）。 */
  interface Proposal {
    /** 命题基 id。 */
    baseId: string;
    /** 候选列表。 */
    candidates: Guess[];
    /** 当前问题（选择阶段的上下文）。 */
    question?: Question;
  }

  /** 单个角色的本机「厨力」统计（不进入题库数据）。 */
  interface DevotionRecord {
    /** 本机为该角色作答次数。 */
    answers: number;
    /** 为题库补充（新增）的问题数。 */
    contributed: number;
    /** 完成的对局数。 */
    sessions: number;
    /** akinator 命中次数。 */
    wins: number;
    /** 未命中 / 认输次数。 */
    losses: number;
    /** 累计问题字符数。 */
    totalQuestionChars: number;
    /** 最近的问题长度（滚动窗口）。 */
    recentLengths: number[];
    /** 首次 / 最近参与时间戳。 */
    firstAt: number;
    lastAt: number;
    /** 活跃日期（YYYY-MM-DD）。 */
    activeDays: string[];
  }

  /** 本机全部「厨力」统计。 */
  interface Devotion {
    characters: Record<string, DevotionRecord>;
    totals: {
      answers: number;
      contributed: number;
      sessions: number;
      wins: number;
      losses: number;
      firstAt: number;
      lastAt: number;
      activeDays: string[];
    };
  }

  /** 单个角色的数据来源。 */
  interface CharacterSource {
    /** 来源地址（云端 URL 或本地文件名）。 */
    url: string;
    /** 展示名。 */
    name: string;
    /** 最近一次拉取 / 导入时间戳。 */
    fetchedAt: number;
    /** 最近一次成功拉到完整角色数据的时间戳；0 表示还是只有基础信息的占位。 */
    loadedAt: number;
  }

  /** 一个被记录的角色。 */
  interface Character {
    /** 稳定 id（slug + 去重后缀）。 */
    id: string;
    /** 显示名。 */
    name: string;
    /** 别名（用于判定 akinator 的猜测是否命中）。 */
    aliases: string[];
    /** 简介。 */
    description: string;
    /** 图片：URL、data URI 或 git 仓库内的相对路径。 */
    image: string;
    /** 标签。 */
    tags: string[];
    /** 所属 akinator 区域，如 en / cn。 */
    region: string;
    /** 题库类型 sid：1=角色 2=物品 14=动物。 */
    sid: number;
    /** 贡献者署名（可选）。 */
    author?: string;
    /** 记录来源：该角色数据来自的 JSON 地址 / 文件。 */
    source?: CharacterSource;
    /** 合并过程中并入的其它 id（用于跨版本对齐 / 去重）。 */
    mergedIds: string[];
    /** 创建 / 更新时间戳（毫秒）。 */
    createdAt: number;
    updatedAt: number;
    /** 问题键 → 答案记录。 */
    answers: Record<string, AnswerRecord>;
  }

  /** 一条云端订阅。 */
  interface Subscription {
    /** 唯一 id。 */
    id: string;
    /** 订阅对象：`list`=角色列表（拉成占位），`character`=单个角色数据。 */
    kind: 'list' | 'character';
    /** JSON 地址。 */
    url: string;
    /** 展示名。 */
    name: string;
    /** 是否启用。 */
    enabled: boolean;
    /** 启动时 / 选择时自动更新。 */
    autoUpdate: boolean;
    /** 最近一次成功拉取时间戳。 */
    lastFetchedAt?: number;
    /** 最近一次错误信息。 */
    lastError?: string;
  }

  /** 本地 / 云端数据库（可共享：只含角色信息，题目概率挂在角色的 answers 上）。 */
  interface Database {
    version: number;
    name: string;
    updatedAt: number;
    characters: Record<string, Character>;
  }

  /** akinator 返回的猜测结果。 */
  interface Guess {
    /** 命题 id。 */
    id: string;
    /** 角色名。 */
    name: string;
    /** 描述。 */
    description: string;
    /** 图片地址。 */
    photo: string;
    /** 置信度（0..1 或 0..100，已归一化为百分比）。 */
    confidence: number | null;
    /** 候选列表大小。 */
    nbElements?: number;
    /** 原始响应。 */
    raw: Record<string, unknown>;
  }

  /** 当前问题。 */
  interface Question {
    /** 归一化问题键。 */
    key: string;
    /** 原始问题文本。 */
    text: string;
    /** akinator 的问题 id（若已知）。 */
    questionId?: string;
    /** 五个答案按钮的本地化标签。 */
    answers: string[];
    /** 当前步数（从 0 开始）。 */
    step: number;
    /** 进度百分比。 */
    progression: number;
  }

  /** 客户端一步的结果。 */
  type StepResult =
    | { type: 'question'; question: Question }
    | { type: 'proposal'; proposal: Proposal }
    | { type: 'win'; guess: Guess }
    | { type: 'defeat' };

  /** 运行日志条目。 */
  interface LogEntry {
    time: number;
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
  }

  /** 运行模式。 */
  type RunMode = 'record' | 'replay';

  /** 歌单播放模式：顺序循环 / 随机 / 单曲循环。 */
  type PlaylistMode = 'loop' | 'shuffle' | 'single';

  /**
   * 本机歌单（挂机回放队列）。
   *
   * 只保存要播放的角色顺序与播放状态，不进入题库数据；`currentId` 是当前曲目，
   * 页面驱动下每局结束都会刷新页面，因此这些字段必须能跨页面持久化。
   */
  interface Playlist {
    /** 队列里的角色 id（播放顺序）。 */
    ids: string[];
    /** 播放模式。 */
    mode: PlaylistMode;
    /** 是否正在按歌单挂机播放。 */
    active: boolean;
    /** 当前曲目（角色 id）；不在 `ids` 中时为空串。 */
    currentId: string;
  }

  /**
   * 跨页面保留的「最近一次运行会话」快照。
   *
   * akinator 页面刷新 / 跳转会重建页面，运行本身无法续接；快照只用来留住
   * 上下文（角色、模式、进度、卡在哪一题）并在 UI 上给出续跑入口。
   */
  interface SessionSnapshot {
    /** 目标角色 id。 */
    characterId: string;
    /** 运行模式。 */
    mode: RunMode;
    /** 快照生成时是否仍在运行（页面重载后为 true 即说明被中断）。 */
    running: boolean;
    round: number;
    step: number;
    wins: number;
    losses: number;
    /** 最后停留在的问题文本。 */
    question?: string;
    startedAt: number;
    updatedAt: number;
    finishedAt?: number;
  }

  /** 面板可切换的标签页。 */
  type PanelTab = 'run' | 'characters' | 'data' | 'player';

  /**
   * 持久化的面板界面状态。
   *
   * akinator 每局结束都会刷新页面、重建面板；记住上次停在哪一页、展开 / 收起状态，
   * 刷新后原样还原，别把用户从播放器页拽回运行页。
   */
  interface PanelState {
    /** 当前标签页。 */
    tab: PanelTab;
    /** 是否铺满屏幕的展开态。 */
    expanded: boolean;
    /** 是否收起为标题栏。 */
    collapsed: boolean;
  }

  /** 一次运行（可能多局）的配置。 */
  interface RunOptions {
    mode: RunMode;
    /** 目标角色 id。 */
    characterId: string;
    /** 局数（<=0 表示无限循环直到停止）。 */
    rounds: number;
    /** 自动决策前的平均类人延时（毫秒）；0 表示不延时。实际耗时会再叠加随机 / 时段 / 题目长度扰动。 */
    stepDelayMs: number;
    /** 未知问题时是否响铃并询问用户。 */
    askUnknown: boolean;
    /** akinator 给出候选时是否询问用户选择。 */
    askProposal: boolean;
    /** 猜测正确后是否立即结束本局（否则继续到 akinator 命中）。 */
    stopOnWin: boolean;
    /** 单局最大步数。 */
    maxSteps: number;
    /** akinator 区域子域。 */
    region: string;
    /** 题库类型。 */
    sid: number;
    /** 儿童模式。 */
    childMode: boolean;
  }

  /**
   * 启动一次运行的请求。
   *
   * 录制模式下可以省略 `characterId`：`draft` 会被用于即时创建一个占位角色，
   * 运行结束后按其结果自动成型。
   */
  interface StartRunRequest extends Partial<RunOptions> {
    /** 新角色预填字段（仅在不带 characterId 的录制模式使用）。 */
    draft?: Partial<Character>;
    /** 本次运行是否由歌单驱动：跑完后按播放模式续播下一首（跨刷新）。 */
    queue?: boolean;
  }

  /** 一次「边录边建」结束后的结果。 */
  interface CreatedCharacter {
    /** 角色 id。 */
    id: string;
    /** 是否因为一个答案都没录到而被丢弃。 */
    discarded?: boolean;
    /** 最终名称。 */
    name?: string;
    /** 最终图片。 */
    image?: string;
    /** 录到的题目数。 */
    questions: number;
    /** akinator 是否给出过猜测。 */
    guessed?: boolean;
    /** 是否被并入题库里已有的同名角色（此时 `id` 是那个现有角色）。 */
    merged?: boolean;
    /** akinator 的最后一次猜测。 */
    guess?: Guess | null;
    /** 运行汇总。 */
    summary?: { rounds: number; wins: number; losses: number };
  }

  /** 运行状态快照。 */
  interface RunState {
    running: boolean;
    mode: RunMode;
    characterId: string;
    round: number;
    rounds: number;
    step: number;
    progression: number;
    question?: Question;
    guess?: Guess;
    proposal?: Proposal;
    wins: number;
    losses: number;
    /** 当前是否在等待用户作答。 */
    awaitingUser: boolean;
    lastError?: string;
  }

  /** 引擎向 UI 回调的接口。 */
  interface EngineHandlers {
    /** 状态变化。 */
    onState?: (state: RunState) => void;
    /** 日志。 */
    onLog?: (entry: LogEntry) => void;
    /** 遇到未知问题，返回答案索引；返回 null 表示中止本局。 */
    onUnknown?: (question: Question, recorded?: AnswerRecord) => Promise<number | null>;
    /** 需要用户手动作答（录制模式）。 */
    onAsk?: (question: Question, recorded?: AnswerRecord) => Promise<number | null>;
    /** 每次作答（含自动 / 用户 / 新增题库）后触发。 */
    onAnswer?: (info: { question: Question; answerIndex: number; added: boolean; source: 'recorded' | 'user' | 'default' }) => void;    /** akinator 给出候选列表时，返回选择结果；不提供则按角色策略自动决定。 */
    onProposal?: (proposal: Proposal, suggested: Guess | undefined) => Promise<ProposalDecision | null> | ProposalDecision | null;
    /**
     * 自动决策前的类人延时；返回 null 表示照常提交，否则用返回值覆盖原决定。
     *
     * 只有「引擎自己拿主意」的决定（回放查表、录制复习、候选自动选择）才会走这里。
     */
    onDelay?: (context: DelayContext) => Promise<DelayOutcome | null> | DelayOutcome | null;
    /** 候选被排除时展示 akinator 的猜测。 */
    onGuess?: (guess: Guess | undefined, autoCorrect: boolean) => boolean | void | Promise<boolean | void>;
    /** akinator 认输（没有候选可猜）。 */
    onDefeat?: () => void;
    /** 本局因异常中止时触发（带原始错误，供「页面驱动失败 → 兜底」判断）。 */
    onError?: (error: unknown) => void;
    /** 每局结束。 */
    onRoundEnd?: (result: { round: number; won: boolean; guess?: Guess }) => void;
    /** 全部结束。 */
    onDone?: (summary: { rounds: number; wins: number; losses: number }) => void;
    /** 数据库发生变化，需要持久化。 */
    onDatabaseChange?: () => void;
  }

  /** 候选选择阶段的决定。 */
  interface ProposalDecision {
    /** pick=选中某个候选；exclude=都不是，继续作答。 */
    action: 'pick' | 'exclude';
    /** 选中项 id（action=pick 时）。 */
    pickId?: string;
    /** 是否由用户手动决定。 */
    manual?: boolean;
  }

  /** 自动答案的处理方式：纠正=清空该题概览并覆盖角色答案；追加=只加一次计数。 */
  type AnswerTreatment = 'correct' | 'append';

  /** 引擎对当前问题的答案决定（尚未落库）。 */
  interface AnswerDecision {
    /** 答案索引；null 表示中止本局。 */
    answer: number | null;
    /** 该角色的历史答案（若有）。 */
    recorded?: AnswerRecord;
    /** 决定来源：回放查表 / 用户手动作答 / 兜底「不知道」。 */
    source: 'recorded' | 'user' | 'default';
    /** 是否由用户手动作答（手动作答不延时）。 */
    manual: boolean;
    /** 是否是本题的新记录（供厨力统计判断「贡献」）。 */
    added: boolean;
    /** 用户打断自动选择后对数据的处理方式。 */
    treatment?: AnswerTreatment;
  }

  /** 自动决策前的类人延时上下文。 */
  type DelayContext =
    | {
      kind: 'answer';
      question: Question;
      /** 问题文本长度，用来估算读题时间。 */
      textLength: number;
      /** 预计延时毫秒。 */
      durationMs: number;
      /** 引擎原本打算提交的答案索引。 */
      answer?: number;
    }
    | {
      kind: 'proposal';
      proposal: Proposal;
      suggested?: Guess;
      /** 预计延时毫秒。 */
      durationMs: number;
    };

  /** 打断延时后返回的覆盖决定。 */
  type DelayOutcome = Partial<AnswerDecision> & Partial<ProposalDecision> & { answer?: number };

  /** 引擎异步等待用户作答的实现。 */
  interface AnswerRequest {
    question: Question;
    /** 已记录的答案（若有）。 */
    recorded?: AnswerRecord;
    /** 为什么需要用户：unknown=题库缺失，record=录制模式。 */
    reason: 'unknown' | 'record';
    resolve: (answer: number | null) => void;
  }

  /** 站点 ↔ 脚本的 postMessage 消息。 */
  interface BridgeMessage {
    source: 'aki-auto-runner'
    type: string
    id?: string
    payload?: unknown
  }

  /** 站点下发的初始化数据。 */
  interface BridgeInit {
    settings?: Partial<Settings>
    databaseText?: string
    subscriptions?: Subscription[]
  }

  /** 站点下发的指令。 */
  interface BridgeCommand {
    action: 'start' | 'stop' | 'answer' | 'proposal' | 'interrupt' | 'intervene' | 'updateSettings' | 'requestDatabase' | 'save'
    options?: StartRunRequest
    answer?: number | null
    decision?: ProposalDecision | null
    /** 延时期间改选后对数据的处理方式。 */
    treatment?: AnswerTreatment
    settings?: Partial<Settings>
  }

  /** 当前正在等待打断决定的延时的快照（供 UI 画倒计时）。 */
  interface DelayState {
    /** 正在等待的自动决策类型。 */
    kind: 'answer' | 'proposal';
    /** 总时长（毫秒）。 */
    durationMs: number;
    /** 开始时刻。 */
    startedAt: number;
    /** 引擎原本打算提交的答案索引（kind=answer 时）。 */
    answer?: number;
    /** 当前问题（kind=answer 时）。 */
    question?: Question;
    /** 候选（kind=proposal 时）。 */
    proposal?: Proposal;
    /** 命中的候选（kind=proposal 时）。 */
    suggested?: Guess;
  }

  /** 用户在延时期间改选后的待决问题。 */
  interface InterventionState {
    /** 引擎原本打算提交的答案索引。 */
    original: number;
    /** 用户点的新答案索引。 */
    clicked: number;
    /** 该问题文本（用于展示）。 */
    question?: Question;
  }

  /** 脚本上报的 hello 信息。 */
  interface HelloInfo {
    version: string
    /** 是否由站点驱动（站点弹窗 / iframe 内）。 */
    embedded: boolean
    characters: number
    /** 最近若干条日志（供站点重连后回填日志面板）。 */
    logs?: LogEntry[]
    /** 最近一次会话快照。 */
    session?: SessionSnapshot | null
  }

  /** 主题模式。 */
  type ThemeMode = 'auto' | 'light' | 'dark'

  /** 本地化翻译器（shared/i18n）。 */
  interface Translator {
    t(key: string, params?: Record<string, unknown>): string
    getLocale(): string
    setLocale(locale: string): void
    onChange(listener: (locale: string) => void): () => void
  }

  /** 设置。 */
  interface Settings {
    /** 默认运行模式。 */
    mode: RunMode;
    region: string;
    sid: number;
    childMode: boolean;
    /** akinator 底层提供商：`auto`=页面驱动、出错时兜底；`page`=只用页面驱动；`api`=只用内置 HTTP 会话。 */
    clientProvider: 'auto' | 'page' | 'api';
    /** 自动决策前的平均类人延时（毫秒），实际耗时会被随机 / 时段 / 题目长度扰动。 */
    stepDelayMs: number;
    rounds: number;
    askUnknown: boolean;
    askProposal: boolean;
    stopOnWin: boolean;
    maxSteps: number;
    bellEnabled: boolean;
    /** 用户静默多久后才响铃 / 通知（毫秒）。 */
    bellDelayMs: number;
    autoSave: boolean;
    /** 界面语言（locale，如 `zh-CN` / `en-UK`）。 */
    language: string;
    /** 日夜模式。 */
    theme: ThemeMode;
  }
}
