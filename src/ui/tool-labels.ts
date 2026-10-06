const labels: Readonly<Record<string, string>> = {
  bash: '终端命令', pwsh: 'PowerShell 命令', terminal: '终端命令',
  read: '读取文件', read_image: '查看图片', write: '写入文件', edit: '编辑文件',
  grep: '搜索内容', glob: '查找文件', web_fetch: '读取网页', web_search: '搜索网页',
  run_code: '执行脚本', subagent: '子智能体',
}
/** Shipped DSH delegation names; control tools remain ordinary activities. */
export function isSubagentTool(name: string | undefined): boolean {
  return name === 'subagent' || name?.startsWith('subagent_') === true
}
const computerLabels: Readonly<Record<string, string>> = {
  list_apps: '查看应用', list_windows: '查看窗口', get_window_state: '查看窗口',
  get_accessibility_tree: '查看桌面', get_desktop_state: '截取桌面',
  get_screen_size: '查看屏幕', get_cursor_position: '查看光标',
  click: '点击', double_click: '双击', right_click: '右键点击',
  type_text: '输入文字', press_key: '按键', set_value: '填写输入框',
  scroll: '滚动', drag: '拖动', move_mouse: '移动光标',
  launch_app: '打开应用', activate_app: '切换应用', check_permissions: '检查权限',
  browser_get_state: '查看网页', browser_navigate: '打开网页', browser_click: '点击网页', browser_type: '填写网页',
}
export function toolLabel(name: string): string {
  if (name.startsWith('cua_driver_native__')) return `电脑操作 · ${computerLabels[name.slice('cua_driver_native__'.length)] ?? '执行操作'}`
  return labels[name] ?? name
}
