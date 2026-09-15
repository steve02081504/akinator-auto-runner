# 题库数据

站点内置题库就是一个「文件夹」：`index.json` 是索引，`characters/*.json` 每个文件一个角色。

- `index.json`：题库清单，`characters[].url` 相对本文件所在目录（即 `data/`）解析。
- `characters/*.json`：单角色文件，便于单独更新与 PR；也是油猴面板「导出为文件夹」的产物格式。

## 格式

`index.json` 列出各角色文件：

```json
{
	"version": 1,
	"name": "Akinator Auto Runner 题库清单",
	"characters": [
		{ "name": "龙胆", "url": "characters/龙胆.json", "description": "内置角色" }
	]
}
```

单角色文件是一个「只有一个角色的数据库」（也接受角色数组、单个角色对象）：

```json
{
	"version": 1,
	"name": "龙胆",
	"characters": {
		"龙胆": {
			"id": "龙胆",
			"name": "龙胆•阿芙萝黛蒂",
			"aliases": ["龙胆"],
			"description": "…",
			"image": "",
			"tags": ["anime"],
			"region": "cn",
			"sid": 1,
			"answers": {
				"你描述的对象的性别是女性吗？": {
					"answer": 0,
					"question": "你描述的对象的性别是女性吗？",
					"weights": [3, 0, 0, 0, 0],
					"count": 3,
					"updatedAt": 0
				}
			}
		}
	}
}
```

- `answers` 的键是**归一化后的问题文本**（去空白、转小写）。
- `weights` 是五个回答的权重（下标即答案索引：`0=是 1=否 2=不知道 3=可能是 4=可能不是`），回放时按权重概率随机抽取作答；也能在油猴面板的角色编辑页里手动调。
- `answer` 是角色选定的答案索引，`count` 是权重总和。字段说明见 `src/schema.mjs` 与 `src/types.d.ts`。

贡献方式：站点「贡献」页选择角色 → 「在 GitHub 上贡献」，会跳到新建 `data/characters/<名字>.json` 并携带内容；也可在油猴面板对单个角色点「导出」再自行 PR。
