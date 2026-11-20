# 贡献指南

感谢参与 AlloyFrame。请先阅读 [README](./README.md)、[项目维护规范](./AGENTS.md) 和与修改有关的领域文档；设计数据和渲染仅用于预演与估算，不能替代结构、承载、加工或安全认证。

## 开发环境

使用 Node.js 22 和 `pnpm@11.24.0`。在项目根目录执行 `pnpm install --frozen-lockfile` 和 `pnpm dev`；开发服务默认仅监听 `127.0.0.1:3210`。完整命令、构建字体联网、Next.js 遥测和部署安全边界见 README。

Next.js 版本可能有不兼容变更。修改相关代码前，先查阅本地安装的 `node_modules/next/dist/docs/`。保持改动聚焦，修改行为时增加或更新相应测试；界面变化应说明已检查的桌面或移动端场景。

## 数据与隐私

- 仓库 `data/catalog/`、`data/designs/` 和 Schema 是公开初始化内容，不是默认运行数据。默认 `.alloyframe-data/` 会在首次获取时初始化，即使应用只读；已有文件不覆盖，完成初始化后不会补回删除或归档的示例。显式 `ALLOYFRAME_DATA_DIR` 或 `SUNMAO_DATA_DIR` 不自动初始化。
- 修改公开示例或型材/配件库时，应在不含私有项目的工作副本中操作；必要时设置 `ALLOYFRAME_DATA_DIR` 为独立数据目录的绝对路径。`pnpm validate` 校验的是当前运行数据目录，不一定是仓库 `data/`。要校验仓库里的公开数据，可在项目根目录运行 `ALLOYFRAME_DATA_DIR="$PWD/data" pnpm validate`；校验器只扫描 `designs/`，不会处理 `archive/`。
- 项目运行数据、归档、浏览器 `localStorage` 草稿、截图、日志、导出文件和配置都可能含有个人或项目敏感信息。提交前检查差异和未跟踪文件，不要提交私有数据、凭据或个人网络地址；Git 忽略规则不会删除已跟踪内容或历史。
- 设计文件应满足 `AGENTS.md` 中的坐标、中心点、下料尺寸、材料及 Schema 约束。修改尺寸时同步更新扣减算式；注明参数、型号及资料来源与估算边界。示例连接必须区分示意和已验证内容，不应暗示校验通过即可安全制造。
- 本地编辑器或智能体直接改运行文件时应错开 Web 保存；SHA-256 冲突检测不是跨进程锁。不要为了个别设计修改引擎，也不要在 JSON 中添加动态脚本。

## 校验

修改设计数据后运行相应数据目录的 `pnpm validate` 或 `pnpm validate <id>`。修改源码后按顺序运行：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm validate
pnpm build
```

CI 使用同样的顺序，并额外运行一次 `ALLOYFRAME_DATA_DIR="$PWD/data" pnpm validate` 校验仓库内的公开数据（测试会断言 `initialFiles` 与 `data/` 树同步，新增公开文件时须同步更新 `src/lib/data-root.ts` 的清单）；`pnpm build` 需要能获取 `next/font/google` 的字体资源。无法运行某项检查时，请说明原因和未覆盖的风险，不要将其描述为通过。

## 提交内容

仅提供有权按项目 [MIT 许可](./LICENSE) 分发的贡献；引入第三方代码、字体、图标或数据时保留原有许可与署名，并提供可核实的来源和必要的再分发说明。当前已知信息和待核实事项见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

说明变更目的、验证命令与结果；涉及界面、数据格式或迁移时补充必要的复现步骤和兼容性说明。安全问题请先阅读 [SECURITY.md](./SECURITY.md)，不要公开敏感利用细节。
