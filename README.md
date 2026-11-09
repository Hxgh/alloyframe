# 铝构 · AlloyFrame

铝型材结构参数化 3D 预演与算料工作台。

以 `data/designs/<id>.json` 为单一数据源，实时驱动 T 槽三维截面渲染、拆解预演、物料清单（BOM / 切割单 CSV）与几何规范校验。计算引擎纯确定性，无内置大语言模型。

## 快速开始

```bash
pnpm install
pnpm dev --hostname 127.0.0.1   # http://127.0.0.1:3000
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
  - **算料与导出**：实时汇总型材长度、估算重量与成本，支持导出设计 JSON、切割清单与完整 BOM（CSV）。

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
- **注意**：当前 `profiles.json` 型材参数均为公开资料估算值（`source: estimate`），采购前请以供应商手册核对。

## License

[MIT](./LICENSE)
