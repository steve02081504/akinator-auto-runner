# Akinator Auto Runner

在 [akinator](https://akinator.com/) 上**录制、回放并扩充共享角色题库**，顺便给喜欢的角色刷权重。

包含两部分：

| 组成 | 说明 |
| --- | --- |
| 油猴脚本 | 运行在 `*.akinator.com`，注入控制面板，负责真正的答题 / 录制 / 回放 |
| GitHub Pages 站点 | 浏览与贡献题库、订阅数据源、用弹窗连接脚本运行 |

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) / [Violentmonkey](https://violentmonkey.github.io/)。
2. 打开 <https://steve02081504.github.io/akinator-auto-runner/akinator-auto-runner.user.js> 安装脚本。
3. 访问 <https://akinator.com/>，右下角出现「Akinator 自动答题」面板即可开始。

站点方式：打开 Pages 页面 → 「运行」标签 → 「连接 akinator」。脚本已装则该弹窗被站点接管，未装则显示安装按钮。（akinator 走 Cloudflare 且回 `X-Frame-Options: SAMEORIGIN` 拒绝被 iframe 嵌入，所以抓取只在其页面内同源完成，站点也只能开独立窗口再用 `postMessage` 通信。）

## 使用

- **录制**：逐题询问你，把「角色 → 问题 → 各回答的概率」记进角色的知识库。不先建角色也行——留空名字直接开录，结束后按 akinator 的猜测自动命名、抓图并弹结果卡。
- **回放**：按每题记录的回答概率随机作答（权重越大越可能被选中），可连跑多局反复刷权重。自动作答前按类人节奏倒计时，期间点了别的选项会问你是「纠正错误回答」还是「追加概率」。
- 遇到没记录过的问题会响铃提醒你补充；akinator 给出候选列表时，可记录「选哪一个 / 都不是」，偏门角色也能挂机。
- 题目只挂在角色下：面板「角色 → 编辑」里能看到该角色录过的题，并手动调每个回答的权重（题目没有独立的意义，也就没有单独的题目页）。
- 题库是一个文件夹（`index.json` + `characters/*.json`）：在面板里「链接文件夹」后，录制 / 编辑都自动写回；也能把它「导出为文件夹」，或在浏览器不支持文件系统操作时逐个文件下载。单个角色可单独导出成 JSON。
- 可订阅远程角色：订阅「角色列表」会先登记占位角色（只有名字等基础信息与数据地址），真正运行 / 编辑它时才拉取并覆盖；订阅「单个角色」则直接登记其数据地址，用时刷新。
- 刷新 / 跳转 akinator 页面后，日志与「上次会话」仍在面板里，可一键继续该角色。
- 在 akinator 的首页 / 主题选择页点「开始」时，会先自动跳到真正的游戏页再开跑；问答直接由 akinator 页面本身完成（脚本只点它的按钮、读 DOM，精灵动画与进度都正常，你随时可以手动接管）。
- 中英双语 + 跟随系统的日 / 夜主题，都在面板 / 站点右上角切换。

## 贡献题库

站点「贡献」页选择角色 → 「在 GitHub 上贡献」，会自动带着内容跳转 GitHub 新建文件并发起 PR。数据格式见 [`data/README.md`](data/README.md)。

## 开发

```sh
npm install
npm run build   # 只产出 dist/akinator-auto-runner.user.js
npm run lint    # 使用用户全局 ESLint 配置（Deno 版）
npm test        # node --test + playwright-core + 本机 Chrome
```

- 脚本源码在 `src/userscript/`，共享逻辑在 `src/shared/`，站点源头在 `.github/pages/`（默认分支 `master`）。本地预览直接开 `.github/pages/index.html`。
- 架构决策与开发约定见 [`AGENTS.md`](AGENTS.md)，不常碰的实现细节与踩坑见 [`INTERNALS.md`](INTERNALS.md)。
- 站点组装只在 CI 里跑：先 `npm run build` 出油猴脚本，再 `node scripts/assemble-pages.mjs` 把 `src/shared/`、`data/` 与脚本就地在 `.github/pages/` 补齐，然后整体部署（见 `.github/workflows/pages.yml`）。本地不要跑组装，免得往站点源头里塞副本。

## 免责声明

akinator 及其商标归 Elokence 所有，本项目与其无关联，仅供个人学习与自用。请合理使用，避免对官方服务造成压力。
