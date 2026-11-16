# 第三方声明

本文件记录从本地 `package.json`、`pnpm-lock.yaml`、已安装依赖的包元数据及许可文件可核对的信息，并注明已核实的字体上游许可；它不是完整的软件物料清单或法律意见。下列版本是本次核对时本地实际安装的版本；范围和实际构建产物可能随锁文件、安装平台或构建方式变化。项目自身许可见 [LICENSE](./LICENSE)，不改变第三方许可。

## 直接运行依赖

| 包及本地版本 | 本地包声明的许可 | 本地许可文件或说明 |
|---|---|---|
| `@base-ui/react` 1.9.0 | MIT | `node_modules/@base-ui/react/LICENSE` |
| `@react-three/drei` 10.7.9 | MIT | `node_modules/@react-three/drei/LICENSE` |
| `@react-three/fiber` 9.8.2 | MIT | 包元数据声明 MIT；已安装包根目录未发现单独的许可文件，完整文本及版权声明待核实 |
| `class-variance-authority` 0.7.1 | Apache-2.0 | `node_modules/class-variance-authority/LICENSE` |
| `cn` 0.5.2 | MIT | `node_modules/cn/LICENSE` |
| `lucide-react` 1.68.0 | ISC | `node_modules/lucide-react/LICENSE`；其中列出的 Feather 派生图标另附 MIT 条款和版权声明 |
| `next` 16.4.5 | MIT | `node_modules/next/license.md` |
| `next-themes` 0.4.6 | MIT | `node_modules/next-themes/license.md` |
| `react` 19.3.0、`react-dom` 19.3.0 | MIT | 各包的 `LICENSE` |
| `shadcn` 4.23.0 | MIT | `node_modules/shadcn/LICENSE.md`；项目 `components.json` 配置了相关组件体系，已复制组件的具体来源和版本仍需逐项核实 |
| `sonner` 2.0.8 | MIT | `node_modules/sonner/LICENSE.md` |
| `three` 0.187.0 | MIT | `node_modules/three/LICENSE` |
| `tw-animate-css` 1.4.0 | MIT | `node_modules/tw-animate-css/LICENSE` |
| `zod` 4.6.7 | MIT | `node_modules/zod/LICENSE` |

`class-variance-authority` 许可文件标明 `Copyright 2022 Joe Bell`。`lucide-react/LICENSE` 标明 `Copyright (c) 2026 Lucide Icons and Contributors`，并对其中列出的 Feather 派生图标标明 `Copyright (c) 2013-present Cole Bemis`；完整文本和图标列表以该文件为准。上述信息来自本地依赖包，不根据包名或作者字段推断其他版权归属。

## 直接开发依赖

| 包及本地版本 | 本地包声明的许可 | 本地许可文件或说明 |
|---|---|---|
| `@tailwindcss/turbopack` 4.3.4、`tailwindcss` 4.3.4 | MIT | 各包的 `LICENSE` |
| `@types/node` 20.19.43、`@types/react` 19.3.0、`@types/react-dom` 19.3.0、`@types/three` 0.187.0 | MIT | 各包的 `LICENSE` |
| `babel-plugin-react-compiler` 1.0.0 | MIT | 包元数据声明 MIT；已安装包根目录未发现单独的许可文件，完整文本及版权声明待核实 |
| `eslint` 9.39.5 | MIT | `node_modules/eslint/LICENSE` |
| `eslint-config-next` 16.4.5 | MIT | 包元数据声明 MIT；已安装包根目录未发现单独的许可文件，完整文本及版权声明待核实 |
| `tsx` 4.23.15 | MIT | `node_modules/tsx/LICENSE` |
| `typescript` 5.9.3 | Apache-2.0 | `node_modules/typescript/LICENSE.txt` |

## 字体、图标和资料

- `src/app/layout.tsx` 通过 `next/font/google` 使用 Geist 与 Geist Mono。Google Fonts 当前提供的 [Geist 许可](https://github.com/google/fonts/blob/main/ofl/geist/OFL.txt)和 [Geist Mono 许可](https://github.com/google/fonts/blob/main/ofl/geistmono/OFL.txt)均为 SIL Open Font License 1.1，版权归 `Copyright 2024 The Geist Project Authors`。Next.js 在构建时下载并自托管字体；发布构建产物前仍须核对实际下载的字体版本和许可，并随字体副本提供相应的完整版权与许可证文本。不要把 Next.js 软件的 MIT 声明直接当作字体许可。
- `components.json` 配置 `lucide` 图标，代码使用 `lucide-react`。其本地许可同时包含上述 ISC 与特定 Feather 派生图标的 MIT 声明；分发时保留适用的原文与版权信息。
- `data/catalog/profiles.json`、`data/catalog/accessories.json` 及 `docs/` 中记录了部分供应商资料链接和估算边界。这些本地引用是选型线索，不表示供应商为其材料或本项目授予再分发许可；使用其文字、图纸或图片前须核实权利及授权。

## 分发前核对

本清单不覆盖传递依赖、Next.js 打包内的第三方组件、平台相关包、实际产物中使用的字体，以及复制进仓库的 UI 组件的完整来源；也没有逐项核实其版权和 NOTICE 文件。分发源码、依赖或构建产物前，应针对实际版本和产物检查各组件的原始许可证、版权与 NOTICE，保留适用文本并履行 MIT、ISC、Apache-2.0 等各自的要求。不要将本文件视为已完成全部许可审计或授权证明。
