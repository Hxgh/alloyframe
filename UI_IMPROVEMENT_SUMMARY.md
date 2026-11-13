# AlloyFrame UI/UX 改进总结

## 📅 改进日期
2026-11-13

## ✅ 已完成改进

### 方案 A1：桌面折叠面板改为图标栏

**问题：** 右侧面板收起后只剩一条 3.25rem 的空竖条，视觉不协调，空间利用率低。

**解决方案：**
- ✅ 标签页添加图标：
  - 零件 (parts) → `Package` 📦
  - 算料 (bom) → `ClipboardList` 📋
  - 项目 (project) → `Settings` ⚙️
- ✅ 折叠时标签垂直排列，只显示图标（隐藏文字）
- ✅ 折叠按钮图标根据设备自适应：
  - **桌面端**：`ChevronRight`/`ChevronLeft`（左右箭头）
  - **移动端**：`ChevronDown`/`ChevronUp`（上下箭头）
- ✅ 标签按钮自适应为正方形 (var(--control-icon-size))

**文件修改：**
- `src/components/Workspace.tsx`: 添加图标导入，修改 TabsTrigger 结构
- `src/app/globals.css`: 新增折叠状态样式规则

---

### 方案 A3：折叠状态快捷操作

**问题：** 折叠后需要先展开面板才能添加零件，操作路径长。

**解决方案：**
- ✅ 在折叠图标栏底部添加"添加零件"快捷按钮
- ✅ 仅桌面端显示（移动端保持原有抽屉逻辑）
- ✅ 点击后自动切换到零件标签并展开面板

**文件修改：**
- `src/components/Workspace.tsx`: 添加 `.panel-quick-actions` 区域
- 导入 `IconButton` 组件统一样式

---

### 附加优化 5：拆解滚轮微调

**问题：** 滚轮 5% 步长对精细调整过大。

**解决方案：**
- ✅ 按住 `Shift` 键时滚轮步长降为 1%
- ✅ 更新 title 提示文本说明微调功能

**文件修改：**
- `src/components/scene/SceneToolbar.tsx`: 
  - `handleWheel()` 检测 `event.shiftKey`
  - 更新按钮 title 提示

---

### 附加优化 6：面板展开/折叠过渡

**问题：** 折叠/展开面板时切换生硬，无视觉反馈。

**解决方案：**
- ✅ 添加 CSS `transition: grid-template-columns 0.2s ease-out`
- ✅ 折叠按钮图标添加旋转过渡 `transform 0.2s ease-out`
- ✅ 不触发画布 resize（通过 CSS 而非 JS 动态调整宽度）

**文件修改：**
- `src/app/globals.css`: 在 `@media (min-width: 1024px)` 块添加过渡

---

### 附加优化 7：双击标签栏折叠

**问题：** 只能点右上角按钮折叠，操作不够直观。

**解决方案：**
- ✅ 支持双击标签栏空白处折叠/展开
- ✅ 仅桌面端启用（移动端保持滑动手势）
- ✅ 通过 `closest('.panel-toolbar')` 判断点击区域

**文件修改：**
- `src/components/Workspace.tsx`: 添加 `onDoubleClick` 处理器

---

## 🧪 测试更新

### 修改的测试文件
1. **src/lib/__tests__/scene-rig.test.ts**
   - 更新图标绑定列表（移除 ChevronDown/Up，添加 ChevronLeft/Right、Package、ClipboardList、Settings）
   
2. **src/lib/__tests__/mobile-workspace.test.ts**
   - 添加新图标绑定
   - 添加 `IconButton: Button` 映射

3. **src/lib/__tests__/theme-toolbar.test.ts**
   - 保留 ChevronDown（ProjectToolbar 详情折叠仍使用）
   - 添加新图标绑定

### 测试结果
- ✅ 全部 245 个测试通过
- ✅ 类型检查通过
- ✅ Lint 无警告
- ✅ 数据校验通过
- ✅ 构建成功

---

## 📐 UI 统一性保证

### 控件尺寸
- 统一使用 `--control-icon-size` CSS 变量
- 桌面：36px，触控：44px
- 所有图标按钮通过 `IconButton` 组件封装

### 图标规范
| 功能 | 图标 | 使用场景 | 来源 |
|------|------|----------|------|
| 零件标签 | Package | 标签页 | lucide-react |
| 算料标签 | ClipboardList | 标签页 | lucide-react |
| 项目标签 | Settings | 标签页 | lucide-react |
| 面板折叠/展开 | ChevronLeft/Right | 桌面端 | lucide-react |
| 抽屉折叠/展开 | ChevronDown/Up | 移动端 | lucide-react |
| 添加零件 | Plus | 快捷操作 | lucide-react |
| 拆解/装配 | Box/Boxes | 3D 视图 | lucide-react |

### 交互一致性
- 折叠按钮：单击展开/收起，双击标签栏空白处触发
- 拆解按钮：单击切换，双击保持，滚轮调整（Shift 微调）
- 移动端：保持原有滑动手势，不受桌面优化影响

---

## 🚀 部署信息

- **开发服务器：** http://localhost:3210
- **局域网访问：** http://192.168.254.101:3210
- **构建输出：** `.next/` 目录
- **兼容性：** 保持桌面和移动端布局独立，响应式断点 1024px

---

## 📸 待验证项

请在浏览器中访问 http://localhost:3210 验证以下体验：

### 桌面端 (>1024px)
- [ ] 点击右上角箭头，面板平滑折叠为图标栏
- [ ] 折叠后标签垂直排列，只显示图标
- [ ] 点击图标标签，面板展开并切换到对应标签页
- [ ] 双击标签栏空白处可折叠/展开
- [ ] 折叠时底部显示"添加零件"快捷按钮
- [ ] 拆解按钮：Shift+滚轮微调 1%，普通滚轮 5%

### 移动端 (<640px 或横屏短屏)
- [ ] 保持原有底部抽屉布局
- [ ] 上下滑动手势正常工作
- [ ] 标签栏显示图标+文字
- [ ] 折叠按钮显示上下箭头（ChevronDown/Up）
- [ ] 不显示快捷操作区域

---

## 🎨 CSS 关键样式

```css
/* 折叠时标签垂直排列 */
.workspace-main[data-panel-open="false"] .panel-tab-list {
  flex-direction: column;
  width: 100%;
  gap: 0.25rem;
}

/* 折叠时隐藏标签文字 */
.workspace-main[data-panel-open="false"] .panel-tab-label {
  display: none;
}

/* 折叠时标签按钮正方形 */
.workspace-main[data-panel-open="false"] [data-slot="tabs-trigger"] {
  width: var(--control-icon-size);
  min-width: var(--control-icon-size);
  padding: 0;
  justify-content: center;
}

/* 平滑过渡 */
.workspace-panel {
  transition: grid-template-columns 0.2s ease-out;
}
```

---

## 📝 后续可选改进

未实施的方案（可根据实际使用反馈考虑）：

1. **方案 B1**：将 SceneToolbar 移至右侧面板顶部（改动量中等）
2. **方案 C1**：浮动面板 + 智能隐藏（改动量大）
3. **附加优化 1**：增强激活标签对比度
4. **附加优化 3**：横屏手机改为侧边小抽屉
5. **附加优化 4**：超宽屏（>2560px）放宽面板至 24rem
6. **附加优化 8**：添加键盘快捷键 Ctrl+B 切换面板
7. **附加优化 10**：使用 ResizeObserver 优化性能

---

## 🐛 修复记录

### 2026-11-13 11:15 - 移动端箭头方向修复

**问题：** 移动端底部抽屉使用了左右箭头（ChevronLeft/Right），与交互方向不符。

**修复：**
- ✅ 添加 `isMobile` 判断，根据设备类型渲染不同箭头
- ✅ 桌面端：ChevronLeft/Right（与侧边栏折叠方向一致）
- ✅ 移动端：ChevronDown/Up（与底部抽屉拉起/收起方向一致）
- ✅ 更新所有测试以包含四个箭头图标

**文件修改：**
- `src/components/Workspace.tsx`: 添加条件渲染 `isMobile ? ... : ...`
- `src/lib/__tests/*.test.ts`: 添加 ChevronDown/Up 到图标绑定

---

**改进完成时间：** 约 30 分钟  
**文件修改数量：** 6 个源文件 + 3 个测试文件  
**新增代码行数：** ~60 行  
**移除代码行数：** ~10 行
