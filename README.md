# 铝构 · AlloyFrame

铝型材结构参数化 3D 预演与算料工作台。

以 `data/designs/<id>.json` 为单一数据源，实时驱动 T 槽三维截面渲染、拆解预演、物料清单（BOM / 切割单 CSV）与几何规范校验。计算引擎纯确定性，无内置大语言模型。

## 快速开始

```bash
pnpm install
pnpm dev                        # http://localhost:3210
pnpm validate                   # 校验全部设计（或 pnpm validate <id>）
pnpm test                       # 单元测试
pnpm typecheck                  # 类型检查
pnpm lint                       # 代码检查
pnpm build                      # 生产构建
```

## 核心流程

- **项目库（`/`）**：支持新建、复制、导入（文件 / JSON 文本，上限 2MB）、重命名与归档恢复（`data/archive/`）。
- **工作台（`/projects/<id>`）**：
  - **表单 → 应用 → 保存**：构件与项目表单修改须先点击“应用”进入草稿；合法草稿默认停止编辑 1.5 秒后自动落盘（可切换手动保存），并按会话在 `localStorage` 备份。
  - **并发防护**：基于文件 SHA-256 指纹检测外部修改（HTTP 409），冲突时支持重新载入或另存副本。
  - **视图操作**：适应视图按当前装配或拆解范围居中并保持观察方向；重置视角恢复默认斜视。初次加载和窗口尺寸变化仍保留最大拆解范围，不会重置选中项与拆解比例。
  - **算料与导出**：实时汇总型材长度、估算重量与成本，支持导出设计 JSON、切割清单与完整 BOM（CSV）。
  - **可见连接件**：有安装实例的配件显示角码示意，并在“项目 → 项目配件 → 连接说明”中只读列出双方零件、备注和完整套件。实例采用世界坐标，通过高级 JSON 编辑；没有自动装配求解，修改几何不会自动重新布置连接。

## 三个典型 DIY 示例

项目库与新建项目模板提供同一套 **40 系 I 型槽 8** 示例，均有明确的梁柱连接实例与套件清单：

| 示例 | 工作台入口 | 设计文件 | 连接套件 |
|---|---|---|---|
| 固定工作台 · 800×600×750mm | `/projects/workbench-i8` | [workbench-i8.json](./data/designs/workbench-i8.json) | 16 套结构件 + 4 套独立台面件 |
| 双层置物架 · 600×400×900mm | `/projects/shelf-i8` | [shelf-i8.json](./data/designs/shelf-i8.json) | 16 套结构件 + 8 套独立层板件 |
| 开放设备围框 · 600×500×600mm | `/projects/enclosure-i8` | [enclosure-i8.json](./data/designs/enclosure-i8.json) | 16 套结构件，无封板/门/联锁 |

一套结构件含 1 只二孔角码、2 颗 DIN 912 M8×16 和 2 只 I8 M8 T 螺母；板材件另含板侧木螺钉与垫片，不与结构件混计。有 `instances` 时数量须与实例数一致，套内零件不重复计料。接口、下料与连接审查见 [07 典型 DIY 示例与连接审查](./docs/07-典型DIY示例与连接审查.md)。

**兼容旧文件**：无 `instances` 的旧配件格式仍可读取、编辑与计料，不自动生成连接、不改槽型，也不迁移 `standing-desk.json`。旧升降桌仍有中横撑两端各 6mm 间隙、缺顶板/转接接口、钢柱无 T 槽、板固定缺件和端盖备注错误，详见 [05 升降桌专项](./docs/05-升降桌专项.md)。

> 示例的截面内部、角码与孔位、木板固定规格为简化示意，未取得完整供应商 CAD 或承载/抗拔验证；没有额定载荷承诺。开放围框不是安全防护罩，通过数据校验不等于可以直接制造或安全使用。

## 目录结构

```text
data/
  catalog/             共享型材库 (profiles.json) 与配件库 (accessories.json)
  designs/             进行中的设计文件 (<id>.json)
  archive/             已归档设计文件
docs/                  铝型材选型、槽型、连接与升降桌领域参考
src/
  app/                 Next.js 路由、页面与项目读写 API
  components/          3D 场景 (scene/)、算料面板 (panel/) 与项目编辑器 (project/)
  lib/                 Schema、几何校验、T 槽挤出、BOM 计算、文件存储与测试 (__tests__/)
  scripts/validate.ts  命令行校验入口
```

## 环境与部署

| 环境变量 | 说明 |
|---|---|
| `ALLOYFRAME_DATA_DIR` | 数据根目录绝对路径（默认 `./data`），须包含 `catalog/` 与 `designs/` |
| `ALLOYFRAME_READ_ONLY` | 设为 `1` 时启用应用层只读模式 |
| `ALLOYFRAME_TRUSTED_ORIGINS` | 允许写入的非本机来源白名单（逗号或空格分隔完整 Origin） |

> 兼容旧版 `SUNMAO_*` 环境变量与 `sunmao:*` 本地存储键（仅在新键未定义时回退）。服务采用单实例本地文件存储，生产部署请挂载持久化数据目录并在接入层配置鉴权。

## 文档与规范

- **数据维护与智能体规范**：[AGENTS.md](./AGENTS.md)
- **铝型材领域知识库**：[docs/00-索引.md](./docs/00-索引.md)
- **三例系统分析与连接审查**：[docs/07-典型DIY示例与连接审查.md](./docs/07-典型DIY示例与连接审查.md)
- **注意**：当前 `profiles.json` 条目仍标为 `source: estimate`。I8 条目的 40×40mm 外形、8mm 槽口、12mm 槽深和芯孔可加工 M8 有官方产品依据，其余内部截面、力学和成本参数仍需复核；不能以简化渲染替代采购图纸。

## License

[MIT](./LICENSE)
