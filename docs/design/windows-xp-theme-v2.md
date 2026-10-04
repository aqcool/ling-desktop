# LING Windows XP 主题设计稿 v2

状态：第二张精修稿已被采用，材质与配色在 Windows XP 内置主题包 1.1.0 中落实。设计图使用内置 imagegen 生成；实现使用主题 CSS 和配色描述，不使用整页位图。

后续修正（1.1.1）：以整体导航层级为准，左侧顶部与侧栏保持连续背景，取消设计图左上角的独立蓝色块；蓝色标题栏只保留在右侧工作区。

## 设计范围

沿用现有应用布局，只调整内置 Windows XP 主题包的配色、控件材质、图标和壁纸呈现。实现时不改变组件结构、栏宽、按钮尺寸、工作区或连接状态。

- 标题栏：Luna 钴蓝渐变，细高光，白色文字。
- 侧栏：资源管理器式浅蓝层次，避免整面米色背景的沉重感。
- 新会话背景：沿用主题包内经典 Bliss 壁纸，通过主题 CSS 轻微降低对比与饱和度。
- 输入区：白色输入面、暖灰工具栏、细边框、小圆角；上下文栏材质协调。
- 信息面板：柔和象牙白，弱化分割边缘，维持文字可读性。
- 控件：细描边与轻微内高光，绿色主动作、蓝色选中态、琥珀色焦点反馈。

生成图用于材质、配色和整体关系参考；原有组件位置、尺寸、文字和行为以实际应用代码为准。图中的截图标注及 macOS 分享胶囊均不属于主题设计。

## 输入参考

1. 用户提供的 LING 新任务界面截图（布局与功能位置）。
2. `src/theme/packs/windows-xp/assets/windows-xp-sky.webp`（实际壁纸资产）。

## 最终提示词

```text
Use case: ui-mockup
Asset type: high-fidelity LING Desktop Windows XP theme design, one complete application screenshot, landscape approximately 1.52:1.
Input images: Image 1 is the LING application layout and content reference ONLY. Image 2 is the exact classic Bliss wallpaper asset to use on the new-session canvas.
Primary request: Design an attractive, coherent, unmistakably Windows XP Luna inspired skin for this real productivity application. Theme changes only: faithfully preserve Image 1's existing three-column geometry, widths, toolbar dimensions, content positions, navigation items, central greeting and input composer, right information panel, all controls and functionality. This is a carefully art-directed application skin, not a Windows desktop recreation.
Composition: edge-to-edge app UI only, straight-on screenshot, no outer desktop, no perspective, no presentation board, no captions outside the app. Preserve left sidebar 20% width, right information pane 23% of the main area, existing central input position and size. No thick divider between panels. NO Windows taskbar, Start menu, fake minimize/close controls, new menu bars or extra product sections.
Art direction: authentic XP Explorer materials with restrained polish. Rich cobalt Luna blue reserved for the existing main titlebar and sidebar's existing small top toolbar. Gentle curved gloss gradient, crisp 1px highlight, never a thick border. Both toolbar regions feel like one unified family, same visual height as the original; no giant blue rectangle. Sidebar content is a soft pale periwinkle Explorer gradient (#d6e3fa to #edf3ff), fine subtle blue-gray text, discreet existing section headings. Existing right information panel is warm light ivory (#f4f2e8), quiet and readable with almost invisible 1px separator. Existing composer white field plus light warm porcelain toolbar (#ece9d8), a precise blue-gray 1px outline, subtle inset highlight, 3px small corners, very light shadow; its workspace context row below uses coordinated soft ivory, compact and visually integrated, no bulky new container. Tahoma-like Latin UI typography and clear compatible Chinese UI sans-serif, all labels legible. Consistent small shaded XP-style colored icons, yellow folders, blue CRT monitor, green navigation arrows, blue book and gear, avoid oversized retro clipart. White caption text with minimal shadow. Small lime-green send/voice action button with restrained bevel; warm amber hover/focus accents. Existing selected items use classic blue and white text.
Wallpaper: Replace only central new-session canvas white background with Image 2's classic Bliss photo. Preserve its characteristic hill and cloud forms; subtly soften contrast and lower saturation by about 15%, with a faint cool blue atmospheric overlay, keeping the landscape recognizable and lovely, not blurred. Wallpaper visible behind center greeting and composer, ends cleanly at the right information pane and left sidebar. Main greeting is white with a fine dark-blue text shadow, readable over sky, same position as Image 1. Do not wrap it in a new card.
Text verbatim: "新任务", "搜索", "工作区", "atlas", "连通性验证仅回复 OK", "查看服务器状态", "cool-platform", "暂无任务", "知识中心", "自动化", "扩展", "想用灵创完成什么？", "描述你要完成的任务…", "只读", "DeepSeek-V4.1-Flash", "高", "本地", "运维服务器", "main", "标准模式", "环境信息", "+0 −0", "提交或推送", "技能与 MCP", "暂无技能与 MCP", "产出", "来源", "暂无来源", "记忆更新", "演示画面".
Constraints: retain the exact layout and all existing controls from Image 1. Remove Image 1's red annotation rectangle and purple macOS screen-sharing capsule (these are not application UI); leave the app navigation controls in their original locations. No thick borders or dividers anywhere, no neon palette, no frosted-glass cards, no large drop shadows, no excessive rounded corners, no browser frame. Text and icon clarity is essential. Realistic implementable CSS theme, beautiful nostalgia with working-app practicality.
```

## 精修提示词

```text
Use case: style-transfer
Asset type: final LING Windows XP theme UI mockup refinement.
Input image: Image 1 is the generated mockup to refine, preserve its exact layout, all text, sidebar width, central composer size and position, wallpaper forms, right panel, icon set, colors and controls except the explicitly specified removals.
Change ONLY these fine details:
1. Remove the first rounded blue screen-sharing capsule at the far top-left (two white user silhouettes). This is NOT an app feature; fill its original area with the same blue titlebar gradient, do not move the three remaining toolbar navigation controls to its right and do not add anything else.
2. Make the input composer perimeter a SINGLE crisp 1px blue-gray outline. Remove the current multiple white/blue nested border rings and thick shadow. Keep a maximum 3px corner radius and only a very soft subtle shadow. Remove the dotted horizontal divider between input and its cream toolbar, replace with a barely perceptible hairline.
3. Make outer app frame, vertical panel seams and blue titlebar edges minimal 1px hairlines. No multi-ring framing or heavy bevels.
4. The center headline "想用灵创完成什么？" must be clean white type with only a subtle soft dark blue shadow, REMOVE its current heavy dark outlined letters. Preserve font size and position.
5. Slightly lower wallpaper saturation and contrast around 12%, maintaining exact classic landscape shape and clarity. Preserve deep Luna titlebar, soft cool blue sidebar, cream info pane, white input surface and pale cream toolbar.
6. Existing workspace context row below the composer stays in the exact same location; make its white labels readable with subtle shadow, no card background.
No added controls, sections, UI strips, Windows taskbar, desktop icons, watermark, commentary text or presentation board. A carefully restrained, implementable theme skin, retaining recognizable XP materials and little colored icons. Render one complete straight-on app screenshot.
```

## 最终文件

[查看设计稿](./windows-xp-theme-v2.png)

生成稿仍有细微的字体描边和角部高光；实现时以单像素边缘、仅保留轻文字阴影为准，保留实际应用的工作区自定义图标和布局尺寸。此图不作为整页背景或界面位图使用。

## 实现验证

- 主题包 1.1.0 只修改配色描述、主题 CSS 和文档；公共生成器同步输出配色样式，业务组件没有新增变更。
- Renderer 构建、类型检查、架构边界、HeroUI 和主题检查通过；16 个测试文件、264 项测试通过。
- Host 构建和类型检查通过；主题启动与凭据窗口相关 4 项测试通过。完整 `check:ling` 的 Host 代理联网测试超时，随后测试进程未结束，已停止该次完整检查，不能视为全量通过。
- 在用户真实 LING 实例中检查了浅色新会话、信息面板、工作区菜单、深色外观和深色新会话。完成后恢复跟随系统模式，保留 XP 主题；终端手动外观设置保持原值。
