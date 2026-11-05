# 榫卯 sunmao

铝型材结构的参数化 3D 预演与算料。

> 铝型材是金属的榫卯 —— 螺母是榫头，型材槽是卯眼，咬合传力、可拆可调。
> 这个项目给它做参数化算料和 3D 预演。

## 这是什么

一个**标准化的铝型材构建工具**。核心是一条闭环：

```
design.json（唯一真相源）
    ├──► 3D 场景（T 槽真实截面 + 拆解视图 + 点选高亮）
    ├──► 算料单（型材下料长度 / 重量 / 估价 / CSV 导出）
    └──► 校验（尺寸一致性 / 引用完整性 / 穿透地面）
```

升降桌只是其中**一个 design**。加一件新家具 = 新增一个 `data/designs/*.json`，不改任何代码。

## 为什么不用通用约束求解器

不做"描述意图 → 求解零件"那一套。那是真正的 CAD 难题，没有尽头。

这里的设计是：**`parts[]` 是完整的手写零件清单**，3D 和算料都只读它。改尺寸时人（或 Agent）直接改数字，`pnpm validate` 会立刻告诉你哪里对不上（台面高度、整体尺寸、是否穿透地面）。

引擎是笨的、确定的、无 LLM 的。"智能"全在外面：你在编辑器里跟 Agent 对话，Agent 读 `docs/` 了解领域知识，直接改 `design.json`。

## 快速开始

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm validate     # 校验所有 design
pnpm build        # 生产构建
```

## 项目结构

```
data/
  catalog/
    profiles.json      型材库：截面尺寸、槽口参数、米重、惯性矩、单价
    accessories.json   配件库：角码、T 螺母、脚杯、端盖…
  designs/
    standing-desk.json 升降桌设计
docs/                  铝型材知识库（人读，也是 Agent 的参考资料）
src/
  app/                 Next.js App Router
  components/
    scene/             3D：Scene / PartMesh
    panel/             面板：PartsList / BomPanel
  lib/
    schema.ts          zod 校验 + 跨文件引用检查
    tslot.ts           T 槽截面 → ExtrudeGeometry
    explode.ts         拆解位移（纯几何推导）
    bom.ts             算料聚合 + CSV
    materials.ts       材料 → 渲染属性
    data.ts            服务端数据加载
  scripts/
    validate.ts        CLI 校验（Agent 的入口）
```

`src/lib/` 是纯函数，不依赖 React 和 three —— 所以 Agent 可以在 Node 里直接跑校验，不需要浏览器。

## 设计文件格式

```jsonc
{
  "id": "standing-desk",
  "name": "升降桌 · 单柱双列",
  "units": "mm",              // 全局唯一单位，不做任何换算
  "meta": {
    "heightRange": [720, 1180],
    "frameHeight": 720,       // 建模时的落位高度
    "loadRating": 120
  },
  "parts": [
    {
      "id": "frame-rail-front",
      "kind": "beam",         // beam | plate | column | box
      "role": "长边框",
      "profile": "4040",      // 仅 kind=beam 生效，引用 profiles.json
      "material": "6063-T5 银白阳极氧化",   // 纯标注，不影响几何
      "size": [1300, 40, 40], // 包围盒 [x,y,z]，beam 的最长边即下料长度
      "position": [0, 675, 290],           // 中心点，不是端点
      "massKg": 3.8,          // 可选：实测重量，覆盖体积估算
      "note": "框体前后主梁"
    }
  ],
  "accessories": [
    { "ref": "bracket-outer-4040", "qty": 12 }
  ]
}
```

### 三条硬约定

1. **`position` 是中心点，不是端点。** 端点语义在斜撑、非正交时会变成噩梦。
2. **`size` 就是下料长度，不做端头扣减。** 扣减在写文件时完成 —— 这样算料单是纯聚合，没有隐藏逻辑。
3. **全局 mm，3D 场景里也是 mm。** 不做 mm↔m 转换。代价是相机 `near`/`far` 必须显式放大（见 `Scene.tsx`），three 默认 `far=1000` 会把整个模型裁掉。

## 已知技术坑（都踩过了）

| 坑 | 现象 | 解决 |
|---|---|---|
| 相机裁剪面 | 页面纯白/纯背景色，模型完全不可见，且无报错 | `near`/`far` 按模型尺度算，不能留默认值 |
| `drei` 的 `<Grid>` | canvas 缓冲区锁死在 300×150 | 改用 three 原生 `gridHelper` |
| `<Environment preset>` | 拉远端 HDRI，失败时整个场景静默挂起 | 用 `<Lightformer>` 程序化生成环境贴图 |
| 金属材质发黑 | `metalness` 高但没有环境反射 | 必须有 `Environment`，否则只能靠 roughness 假扮 |
| 旋转单位 | 型材沿错误方向歪出 | `axisRotation` 返回**弧度**，不是度 |

## 数据可信度

`profiles.json` 里每条型材都有 `source` 字段：

- `supplier` — 来自供应商实测手册
- `estimate` — 来自公开资料估算

**当前所有型材数据均为 `estimate`。** 采购前必须以供应商实测手册核对米重与单价。升降柱等空心件按实心包围盒估算会严重偏重，所以 `parts[]` 支持用 `massKg` 字段写实测值。

算料单里的价格仅供估算，不是报价。

## 许可

私有项目。
