/** Built-in, declarative LING theme pack. No runtime or component dependencies. */
export const windowsXpTheme = {
  id: 'windows-xp',
  label: 'Windows XP',
  version: '1.1.1',
  stylesheet: './styles.css',
  colors: {
    light: {
      'font-ui': 'Tahoma, "Microsoft YaHei", "PingFang SC", Arial, sans-serif',
      radius: '0.1875rem',
      background: '#edf3ff', surface: '#ffffff', 'surface-secondary': '#ece9d8',
      'surface-tertiary': '#e1dfce', 'surface-selected': '#d7e6fb',
      foreground: '#15336c', 'text-secondary': '#375989', 'text-tertiary': '#58719a',
      'panel-border': '#b8c8df', focus: '#2356a6',
      success: '#28713d', warning: '#875a10', danger: '#ad3737', info: '#285ba5', link: '#2456a1',
      'chrome-start': '#245edb', 'chrome-end': '#164ab4', 'chrome-foreground': '#ffffff',
      'chrome-hover': '#2864cf',
    },
    dark: {
      'font-ui': 'Tahoma, "Microsoft YaHei", "PingFang SC", Arial, sans-serif',
      radius: '0.1875rem',
      background: '#13213b', surface: '#1a2c4b', 'surface-secondary': '#243b5f',
      'surface-tertiary': '#2c4974', 'surface-selected': '#365f96',
      foreground: '#f3f7ff', 'text-secondary': '#c5d7f1', 'text-tertiary': '#a8bddb',
      'panel-border': '#5073a5', focus: '#afd2ff',
      success: '#a9e1aa', warning: '#ffd085', danger: '#ffaba8', info: '#a9caff', link: '#a9caff',
      'chrome-start': '#386bb2', 'chrome-end': '#1c3d7c', 'chrome-foreground': '#ffffff',
      'chrome-hover': '#3f73b5',
    },
  },
  overrides: {
    light: {
      'sidebar-background': '#d6e3fa', 'surface-hover': '#e3edfc',
      action: '#397d2d', 'action-foreground': '#ffffff',
      'surface-shadow': '0 1px 2px var(--shadow-color)',
      'overlay-shadow': '0 4px 12px var(--shadow-color)',
    },
    dark: {
      action: '#a5df86', 'action-foreground': '#13213b',
      'surface-shadow': '0 1px 2px var(--shadow-color)',
      'overlay-shadow': '0 4px 12px var(--shadow-color)',
    },
  },
} as const
