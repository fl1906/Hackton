---
name: mini-archify
description: "最简工作流图生成器。一个脚本，引用已安装的 Archify 渲染器，生成可交互的 HTML 泳道图。"
---

# Mini-Archify — 最简工作流图

## 项目结构

```
demo/
├── mini-archify.mjs      ← 唯一入口（单文件，~40 行）
├── SKILL.md               ← 本技能文档
├── test-candidate.json    ← 测试用例
└── examples/locdcm.json   ← LOCDCM 示例
```

**依赖**: Archify 已安装在 `~/.agents/skills/archify/`，Node.js >=18

## 用法

```bash
cd demo
node mini-archify.mjs <candidate.json> [输出.html]
```

不指定输出路径时，自动将 `.json` 替换为 `.html`。

## candidate.json 结构

```json
{
  "schema_version": 2,
  "diagram_type": "workflow",
  "meta": {
    "title": "图标题",
    "output": "输出路径.html"
  },
  "lanes": [
    { "id": "lane1", "label": "泳道1" },
    { "id": "lane2", "label": "泳道2" }
  ],
  "nodes": [
    { "id": "node1", "lane": "lane1", "col": 0, "type": "frontend", "label": "节点名" }
  ],
  "edges": [
    { "id": "e1", "from": "node1", "to": "node2", "label": "连线标签" }
  ]
}
```

## 字段速查

### meta
| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | ✅ | 图标题 |
| `output` | ✅ | 输出 HTML 路径（相对路径） |
| `locale` | - | `zh-CN` 中文界面 |
| `animation` | - | `trace` 开启动画 |
| `quality_profile` | - | `showcase` 或 `standard` |

### lanes（泳道）
| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 唯一 ID |
| `label` | ✅ | 显示名称 |
| `variant` | - | `normal`（默认）或 `exception` |

### nodes（节点）
| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 唯一 ID |
| `lane` | ✅ | 所属泳道 ID |
| `col` | ✅ | 列号（0-5，从左到右） |
| `type` | ✅ | 节点类型（见下方） |
| `label` | ✅ | 显示文字 |
| `sublabel` | - | 副标题 |
| `tag` | - | 标签 |
| `width` | - | 宽度（默认自动适应） |
| `yOffset` | - | 同列垂直偏移 |

**节点类型**: `external`（外部/开始结束）、`frontend`（前端）、`backend`（后端）、`security`（安全/决策）、`database`（数据库）、`messagebus`（消息/调用）

### edges（连线）
| 字段 | 必填 | 说明 |
|---|---|---|
| `from` | ✅ | 起点节点 ID |
| `to` | ✅ | 终点节点 ID |
| `label` | - | 连线标签 |
| `variant` | - | `default`、`emphasis`（主路径加粗）、`dashed`（虚线）、`security`（安全/错误） |
| `role` | - | `main`（主路径）、`branch`（分支）、`return`（返回）、`async`（异步）、`error`（错误） |

### mainPath（主路径）
可选，列出主路径节点 ID 顺序，渲染器高亮标记。

```json
"mainPath": ["start", "step1", "step2", "end"]
```

### cards（信息卡）
可选，在图的角落添加说明卡片。

```json
"cards": [
  {
    "dot": "amber",
    "title": "说明标题",
    "items": ["要点1", "要点2"]
  }
]
```
`dot` 可选值: `cyan`, `emerald`, `violet`, `amber`, `rose`, `orange`, `slate`

## 关键规则

1. **每个节点必须有唯一 `id`**，且 `lane` 和 `col` 必须存在
2. **同一泳道 + 同一列**的多个节点要用 `yOffset` 错开垂直位置
3. **主路径上的连续节点必须有对应的 edge**（否则报错）
4. **连线标签不要太长**，CJK 文字按 2 个字符计算宽度
5. **`fromSide`/`toSide`/`route`** 只在自动路由失败时手动指定，优先用自动路由

## 快速测试

```bash
cd demo
node mini-archify.mjs test-candidate.json test-leave.html
```

然后用浏览器打开 `test-leave.html`。

## 常见错误及修复

| 错误 | 修复 |
|---|---|
| `node-overlap` | 同列节点加 `yOffset`，或分到不同列 |
| `route-preset-conflict` | 去掉手动 `route`，改用自动路由 |
| `mainPath has no matching edge` | 在 `edges` 中补上缺失的连线 |
| `schema/enum` | 检查字段值是否在允许列表中 |