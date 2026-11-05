<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# 榫卯 sunmao · 数据维护说明

这个项目的数据由人和 Agent 共同维护。你是其中一个客户端，Web UI 是另一个。
**引擎是笨的、确定的、无 LLM 的** —— 所有"智能"在你这边。

## 你的工作界面

```
data/designs/*.json   ← 你写这个
data/catalog/*.json   ← 你读这个（偶尔扩充）
docs/*.md             ← 你读这个（领域知识）
pnpm validate         ← 你跑这个（验证）
```

改完文件后**一定**跑 `pnpm validate`。它是你的唯一验收标准。

## 加一件新家具

1. 读 `docs/` 里相关章节，确认连接方式和配件选型
2. 新建 `data/designs/<名字>.json`，按下面的格式写
3. 跑 `pnpm validate <名字>`，根据报错修到全绿
4. 不需要改任何代码。UI 通过 `loadWorkspace(id)` 自动读它

## design.json 格式

```jsonc
{
  "id": "bookshelf",              // 与文件名一致
  "name": "置物架",                // 显示名
  "revision": 0,
  "units": "mm",                   // 只能是 "mm"
  "meta": {
    "description": "一句话说明",
    "heightRange": [300, 1800],    // 可选：可调高度范围
    "frameHeight": 720,            // 可选：建模落位高度，会与台面上表面校验
    "loadRating": 50,              // 可选：设计承重 kg
    "profileSeries": "4040",
    "note": "补充说明"
  },
  "parts": [ /* 见下 */ ],
  "accessories": [
    { "ref": "bracket-outer-4040", "qty": 8, "note": "四角各 2 个" }
  ]
}
```

### parts 的字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 全局唯一，小写短横线 |
| `kind` | ✅ | `beam` / `plate` / `column` / `box` |
| `role` | ✅ | 中文角色名，UI 按它分组显示 |
| `profile` | beam 必填 | 引用 `catalog/profiles.json` 的 id |
| `material` | ✅ | 纯标注，只影响渲染颜色 |
| `size` | ✅ | `[x, y, z]` 包围盒，单位 mm |
| `position` | ✅ | `[x, y, z]` **中心点**，单位 mm |
| `rotation` | — | 欧拉角，单位**度**，默认 `[0,0,0]` |
| `massKg` | — | 实测重量，覆盖体积估算 |
| `note` | — | 加工备注，会显示在 UI 上 |

### kind 的含义

- **beam** —— 铝型材。沿最长边挤出真实 T 槽截面，截面宽高取自 `size` 的另外两条边，槽口参数取自 profile。最长边就是下料长度。
- **plate** —— 板材（台面等）。渲染为实心盒。
- **column** —— 竖直构件（升降柱）。即使截面接近也强制按 Y 轴处理。
- **box** —— 通用方块（脚杯等）。

## 坐标约定

右手坐标系，原点在**地面中心**：

- `+X` 向右（看正面时）
- `+Y` 向上，**地面是 y=0**
- `+Z` 朝向观察者（正面）

一条 1300mm 长、位于桌框前侧、顶面在 695mm 的横梁：

```json
{
  "id": "frame-rail-front",
  "kind": "beam",
  "size": [1300, 40, 40],
  "position": [0, 675, 290]
}
```

`position[1] = 675` 是因为中心点在梁的正中（695 − 40/2）。**不是** 695。

## 三条硬约定

1. **`position` 是中心点，不是端点。**
2. **`size` 的最长边就是下料长度，不做端头扣减。** 需要扣减时（比如框梁夹在两根立柱之间）你直接算出最终长度写进去，并在 `note` 里写清算式。
3. **全局 mm。** 不要写 `1.3` 意思是 1.3 米。写 `1300`。

## 长度扣减要自己算

引擎不做任何自动扣减。这是刻意的设计 —— 扣减规则因连接方式而异，藏在代码里会让人查不出来。

典型场景：1400 宽的桌，前后主梁用 4040，左右端梁夹在两梁之间。

```
端梁长度 = 总宽 − 2 × 主梁尺寸 − 2 × 角码占位
         = 1400 − 2 × 40 − 2 × 20
         = 1280
```

**在 `note` 里写下这个算式**，下一个人（或 Agent）才看得懂。这是本项目最重要的规范。

## 校验会检查什么

`pnpm validate` 报这四类问题：

1. **schema** —— 字段缺失、类型错误、尺寸非正数
2. **引用完整性** —— `profile` 是否在 catalog 里、`accessories.ref` 是否存在、零件 id 是否重复
3. **几何一致性** —— 是否有零件低于地面（y < 0）、台面上表面是否与 `meta.frameHeight` 一致（误差 > 5mm 报错）
4. **整体尺寸** —— 打印包围盒，你用来自查是否符合设计意图

## 改现有设计时

先看 `note`。里面的算式是你理解原始意图的唯一线索。

改尺寸时同步更新 `note` 里的算式，否则下次改动的人会算错。

`meta.frameHeight` 改了，台面的 `position[1]` 也要跟着改，否则校验会报台面高度不一致。

## 常见错误

| 错误 | 后果 |
|---|---|
| `position` 写成端点坐标 | 零件整体偏移半个尺寸 |
| 漏掉 `profile` | 校验报错，beam 不知道用哪个截面 |
| beam 的 `size` 三条边写错顺序 | 挤出的截面方向错，梁看起来歪了 |
| 空心件没写 `massKg` | 重量按实心算，严重偏重（升降柱能差 3 倍） |
| 忘跑 `pnpm validate` | 提交了坏数据，UI 直接崩 |

## 不要做的事

- 不要改 `src/lib/` 里的引擎逻辑来"适配"某个设计。数据适配数据。
- 不要给 `design.json` 加 schema 里没有的字段。要加字段先改 `src/lib/schema.ts`。
- 不要在 `design.json` 里写推导逻辑。它是数据，不是程序。
- 不要把 `material` 当几何参数用。它只是标注。

## 前端代码注意事项

- **相机 `near`/`far` 必须按模型尺度算。** three 默认 `far=1000`，而本项目单位是 mm，桌子在 2600mm 外 —— 留默认值会导致整个场景不可见且**无任何报错**。
- **不要用 `drei` 的 `<Grid>`。** 它会把 canvas 缓冲区锁在 300×150。用 three 原生 `gridHelper`。
- **不要用 `<Environment preset>`。** 它会拉远端 HDRI，失败时整个场景静默挂起。用 `<Lightformer>` 程序化生成。
- **`axisRotation` 返回弧度，不是度。** R3F 的 `rotation` 是弧度。
