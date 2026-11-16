<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# AlloyFrame · 开发与数据维护规范

本项目的数据由人工与智能体共同维护，计算引擎为纯确定性逻辑。

## 工作流与校验命令

- **数据维护**：公开示例位于 `data/designs/<id>.json`（查阅 `data/catalog/*.json` 与 `docs/*.md`），修改后在项目根目录运行 `ALLOYFRAME_DATA_DIR="$PWD/data" pnpm validate` 或追加 `<id>`，以校验仓库中的公开数据。实际运行项目位于运行数据根目录的 `designs/`，修改后须在对应数据根目录运行 `pnpm validate` 或 `pnpm validate <id>`。
- **代码修改**：修改源码后须依次通过 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm validate` 与 `pnpm build`。
- **路径与环境**：未配置时，数据根目录为当前工作目录下被 Git 忽略的 `.alloyframe-data/`，首次访问时从公开的 `data/` 初始化；配置 `ALLOYFRAME_DATA_DIR`（兼容旧版 `SUNMAO_DATA_DIR`）时切换至该绝对路径，不自动初始化。CLI 仅扫描所选根目录的 `designs/`，忽略 `archive/`；空构件项目仅警告并退出 `0`，存在错误退出 `1`。

## 设计文件规范（`data/designs/<id>.json`）

- **ID 规则**：小写字母、数字与单短横线分段（最长 120 字符），JSON 内 `id` 必须与文件名一致。
- **严格 Schema**：顶层、`meta`、`parts[]`、`accessories[]` 均拒绝未知字段（允许顶层 `$schema`）。
- **右手坐标系**：原点位于**地面中心**（`y = 0`），`+X` 向右，`+Y` 向上，`+Z` 朝向观察者（正面）。

### 三条硬约束

1. **`position` 是构件中心点**，不是端点（例如顶面在 `695`、高 `40` 的横梁，`position[1]` 为 `675`）。
2. **`size` 最长边即下料长度**，引擎不做端头扣减；夹在立柱或主梁之间的构件须直接写入扣减后尺寸，并在 `note` 中写明算式（如 `540 = 620 - 2×40`）。
3. **全局单位固定为 `mm`**，渲染旋转传参须将角度（度）转换为弧度。

### 构件（`parts`）字段

| 字段 | 必填 | 约束说明 |
|---|---|---|
| `id` | 是 | 项目内唯一标识 |
| `kind` | 是 | `beam`（铝型材，沿最长边挤出） / `plate`（板材） / `column`（竖直柱） / `box`（通用块） |
| `role` | 是 | 中文角色名，用于界面分组 |
| `profile` | 仅 `beam` | 必填且引用 `catalog/profiles.json`；非 `beam` 禁止填写 |
| `material` | 是 | 材料标注（含 `铝`/`钢`/`木`/`黑`/`深灰` 等关键词映射渲染材质，不控制几何） |
| `size` | 是 | `[x, y, z]` 包围盒尺寸（mm，正数） |
| `position` | 是 | `[x, y, z]` 中心坐标（mm），旋转后包围盒最低点不得穿透地面（`y < -0.5`） |
| `rotation` | 否 | `[rx, ry, rz]` 欧拉角（度），默认 `[0, 0, 0]` |
| `massKg` | 否 | 单件重量（kg），覆盖体积密度估算（升降柱等空心外购件必填，避免按实心算偏重） |
| `note` | 否 | 加工与扣减算式备注；修改尺寸时须同步更新算式 |

> 若填写 `meta.frameHeight`，校验器会核对非空模型整体最高点（偏差 > 5mm 报错）。

## 协同与代码边界

- **文件并发**：Web 保存与 CLI 共用底层文件，通过 SHA-256 指纹拦截并发冲突（HTTP 409）。智能体直接写文件前应错开页面编辑窗口。
- **不要改动引擎适配单份数据**：不要修改 `src/lib/` 迁就特定设计，也不要在 JSON 中写入动态脚本。
- **3D 视图与显示约束**：
  - 主题、视角、全屏和拆解比例仅作用于视图，不写入设计文件。
  - 相机 `near` / `far` 须按模型包围盒尺度动态计算，避免毫米级场景被裁剪。
  - 保持使用原生 `gridHelper` 与本地 `<Lightformer>` 环境光，禁止引入锁定画布尺寸的 `<Grid>` 或远程 HDR 贴图。
