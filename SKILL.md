---
name: mini-archify
description: "独立数据流图生成器。单个零依赖脚本，把 dataflow JSON 渲染为自包含 HTML 泳道图，不需要安装 Archify。"
---

# Mini-Archify — 独立数据流图

## 用法

```bash
node mini-archify.mjs <candidate.json> [输出.html]
```

- 不指定输出路径时，优先用 `meta.output`，否则将 `.json` 替换为 `.html`
- **零依赖**：仅需 Node.js >=18，不需要 Archify 或任何 npm 包
- 输出为自包含 HTML（内联 SVG，约 16KB），支持明/暗主题、`?theme=light|dark` 强制主题

## 数据流模式（dataflow）

数据流图按**舞台（stage）分列、行（row）分层**布局，从左到右表示数据生命周期：来源 → 接入 → 处理 → 存储 → 消费。

```json
{
  "schema_version": 1,
  "diagram_type": "dataflow",
  "meta": { "title": "图标题", "output": "输出.html" },
  "stages": [ { "label": "来源" }, { "label": "消费" } ],
  "nodes": [
    { "id": "web", "type": "frontend", "label": "Web 应用", "stage": 0, "row": 0 }
  ],
  "flows": [
    { "id": "f1", "from": "web", "to": "api", "label": "clickstream" }
  ]
}
```

## 字段速查

### meta
| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | ✅ | 图标题 |
| `output` | - | 默认输出路径（必须是相对路径，以 `.html` 结尾） |
| `subtitle` | - | 副标题 |
| `locale` | - | `zh-CN` 时图例显示中文 |
| `animation` | - | `trace` 为主路径加流动动画 |
| `quality_profile` | - | 仅接受 `standard` / `showcase`（本渲染器忽略其差异） |
| `viewBox` | - | `[宽, 高]`，最小 `[360, 360]`；省略时自动适配 |
| `legend.mode` | - | `auto`（默认）/ `all` / `hidden` |
| `legend.entries` | - | 覆盖图例项：`{ "emphasis": { "label": "...", "visible": true } }` |

### stages（舞台，2–5 个）
| 字段 | 必填 | 说明 |
|---|---|---|
| `label` | ✅ | 舞台名，显示在列顶部 |

### nodes（节点，≥2 个）
| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 唯一 ID（字母开头，仅字母数字 `_` `-`） |
| `type` | ✅ | `frontend` `backend` `database` `cloud` `security` `messagebus` `external` |
| `label` | ✅ | 显示文字 |
| `stage` | ✅ | 舞台下标（0 起） |
| `row` | ✅ | 行下标（0–4） |
| `sublabel` | - | 副标题 |
| `tag` | - | 右上角小标签 |
| `width` / `height` | - | 手动尺寸（省略时按文字自动适应，112–160 宽） |
| `yOffset` | - | 同行垂直微调 |

### flows（连线）
| 字段 | 必填 | 说明 |
|---|---|---|
| `from` / `to` | ✅ | 起止节点 ID |
| `label` | ✅ | **命名数据资产而非动作**：`clickstream`、`identity map`、`normalized facts` |
| `classification` | - | 第二行小字：`PII touch`、`non-PII`、`read-only`、`batch` |
| `variant` | - | `default` `emphasis`（主路径加粗绿色）`security`（红）`dashed`（异步/批） |
| `fromSide` / `toSide` | - | `left` `right` `top` `bottom`（省略时自动选择） |
| `route` | - | `straight` / 自动肘线；`via` 点数组可手动布线 |
| `width` | - | 线宽覆盖 |

### cards（信息卡，可选）
```json
"cards": [ { "dot": "emerald", "title": "标题", "items": ["要点1", "要点2"] } ]
```
`dot`: `cyan` `emerald` `violet` `amber` `rose` `orange` `slate`

## 布局规则（渲染器自动处理）

| 项目 | 值 |
|---|---|
| 舞台中心 x | `100 + stage × 215`，带宽 168 |
| 行顶 y | `128, 242, 356, 470, 584`（+ `yOffset`） |
| 默认节点 | 112×58，同行间距 ≥10px |
| 画布 | 宽 `208 + (舞台数−1) × 215` 起，高 ≥720，含图例区 74 |
| 端口 | 同节点同边多条流按 16px 间距自动展开 |
| 路由 | 同向端口走肘线，跨列默认左→右，自动避让直线 |

## 关键规则

1. **flow.label 命名数据**，不要写 "API 调用"、"发送" 这类传输动词
2. **variant 语义**：主路径用 `emphasis`；PII/权限/敏感边界用 `security`；异步或批处理派生用 `dashed`
3. 同节点多出口/入口**无需手动指定端口**，自动按 16px 展开；仅自动路由不满意时才用 `fromSide`/`toSide`/`via`
4. 文本宽度按 **CJK 字符 = 2 单位**估算，标签过长会被警告
5. 节点不能超出可读区域（顶部 y≥104，底部留 74px 图例区）

## 诊断（退出码 1 时输出）

| 诊断 | 修复 |
|---|---|
| `dataflow/node-overlap` | 同行节点加 `yOffset` 或换 `row` |
| `dataflow/node-above-area` / `node-below-area` | 调整 `row` / `yOffset`，或增大 `meta.viewBox[1]` |
| `dataflow/node-outside-x` | 增大 `meta.viewBox[0]` |
| `dataflow/short-flow` | 两节点离得太近，换行或换舞台 |
| `schema` 类错误 | 按消息补字段 / 改枚举值 |

## 快速测试

```bash
node mini-archify.mjs examples-dataflow.json /tmp/out.html   # 官方示例
open /tmp/out.html
```
