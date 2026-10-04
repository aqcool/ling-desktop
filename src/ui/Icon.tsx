import { tw } from './tailwind.js'

// LING outline family: 24-unit grid, 1.75-unit round strokes, shared frames.
// State changes retain their frame and optical center; only the indicator changes.
const panelFrame = 'M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z'
const shieldFrame = 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'
const squareFrame = 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z'
const folderFrame = 'M3 7V6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7z'
const panelIndicators = {
  panelLeft: { x: 5, y: 7, width: 4, height: 10 },
  panelRight: { x: 15, y: 7, width: 4, height: 10 },
  terminalPanel: { x: 5, y: 14, width: 14, height: 3 },
} as const

const paths = {
  plugin: ['M12 3c-3 0-4 4-4 6-3-1-6 0-6 3s4 4 6 4c-1 3 0 6 3 6s4-4 4-6c3 1 6 0 6-3s-4-4-6-4c1-3 0-6-3-6z'],
  plan: ['M12 21H5a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2v5', 'M7 7h8', 'M7 11h5', 'M18 13l3 3-6 6h-3v-3z'],
  paperPlane: ['M21 3L3 10l7 3 3 8 8-18z', 'M10 13L21 3'],
  modelCatalog: ['M19 6c0 2-3.6 3-8 3S3 8 3 6s3.6-3 8-3 8 1 8 3z', 'M3 6v6c0 2 3.6 3 8 3', 'M3 12v6c0 2 3.6 3 8 3', 'M19 6v4', 'M18 14a3 3 0 110 6 3 3 0 010-6z', 'M18 12v2', 'M18 20v2', 'M13 17h2', 'M21 17h2'],
  agentPreset: ['M12 3a3 3 0 110 6 3 3 0 010-6z', 'M5 15a3 3 0 110 6 3 3 0 010-6z', 'M19 15a3 3 0 110 6 3 3 0 010-6z', 'M10 8l-4 7', 'M14 8l4 7', 'M8 18h8'],
  sliders: ['M3 7h5', 'M14 7h7', 'M11 4a3 3 0 110 6 3 3 0 010-6z', 'M3 17h9', 'M18 17h3', 'M15 14a3 3 0 110 6 3 3 0 010-6z'],
  minus: ['M5 12h14'],
  annotation: ['M4 8V5a1 1 0 011-1h3', 'M16 4h3a1 1 0 011 1v3', 'M20 16v3a1 1 0 01-1 1h-3', 'M8 20H5a1 1 0 01-1-1v-3'],
  archive: ['M4 8v11a1 1 0 001 1h14a1 1 0 001-1V8', 'M3 4h18v4H3z', 'M10 12h4'],
  book: ['M12 6c-2-2-5-2.5-9-2v15c4-.5 7 0 9 2', 'M12 6c2-2 5-2.5 9-2v15c-4-.5-7 0-9 2', 'M12 6v15'],
  clipboard: ['M9 4H5a1 1 0 00-1 1v15h16V5a1 1 0 00-1-1h-4', 'M9 2h6v4H9z'],
  feather: ['M20 4c-6-1-12 3-13 10l-3 6', 'M7 14c6 1 11-4 13-10', 'M7 14l8-6', 'M13 5l1 4'],
  arrowLeft: ['M19 12H5', 'M12 19l-7-7 7-7'],
  arrowRight: ['M5 12h14', 'M12 5l7 7-7 7'],
  back: ['M15 18l-6-6 6-6'],
  bell: ['M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4'],
  bolt: ['M13 2L5 13h6l-1 9 9-12h-6z'],
  branch: ['M6 7v10', 'M6 3a2 2 0 110 4 2 2 0 010-4z', 'M6 17a2 2 0 110 4 2 2 0 010-4z', 'M18 3a2 2 0 110 4 2 2 0 010-4z', 'M18 7a8 8 0 01-8 8H6'],
  change: ['M4 7h16', 'M4 17h16', 'M8 3v8', 'M16 13v8'],
  review: ['M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z', 'M9 9h6', 'M12 6v6', 'M9 16h6'],
  sideChat: ['M21 11.5a9 8.5 0 01-13.5 7.4L3 21l1.7-4.5A9 8.5 0 1121 11.5z', 'M10 7l-1 9', 'M15 7l-1 9', 'M7 10h10', 'M7 13h10'],
  calendarClock: ['M13 20H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4', 'M7 2v4', 'M17 2v4', 'M3 9h18', 'M17 12a5 5 0 110 10 5 5 0 010-10z', 'M17 15v2l2 1'],
  camera: ['M4 7h3l1.5-2h7L17 7h3a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2z', 'M12 10a4 4 0 100 8 4 4 0 000-8z'],
  check: ['M20 6L9 17l-5-5'],
  coffee: ['M4 5h13v9a5 5 0 01-5 5H9a5 5 0 01-5-5z', 'M17 7h2a3 3 0 010 6h-2', 'M3 22h17'],
  chevronDown: ['M6 9l6 6 6-6'],
  chevronRight: ['M9 6l6 6-6 6'],
  clock: ['M12 22a10 10 0 100-20 10 10 0 000 20z', 'M12 6v6l4 2'],
  compose: ['M20.5 11.5V12a8.5 8.5 0 11-8-8.5', 'M18.5 2.5l3 3L13 14l-4 1 1-4z'],
  copy: ['M10 8h9a1 1 0 011 1v11a1 1 0 01-1 1h-9a1 1 0 01-1-1V9a1 1 0 011-1z', 'M15 8V4a1 1 0 00-1-1H5a1 1 0 00-1 1v11a1 1 0 001 1h4'],
  desktop: ['M4 4h16a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z', 'M8 21h8', 'M12 17v4'],
  collapse: ['M4 14h6v6', 'M3 21l7-7', 'M20 10h-6V4', 'M21 3l-7 7'],
  compressContext: ['M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z', 'M12 6v2', 'M12 11v2', 'M12 16v2'],
  code: ['M8 9l-3 3 3 3', 'M16 9l3 3-3 3', 'M14 5l-4 14'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z'],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 18v3h16v-3'],
  expand: ['M15 3h6v6', 'M14 10l7-7', 'M9 21H3v-6', 'M10 14l-7 7'],
  external: ['M14 3h7v7', 'M10 14L21 3', 'M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5'],
  file: ['M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8z', 'M14 3v5h5'],
  flask: ['M9 3h6', 'M10 3v7L4.5 19a1.3 1.3 0 001.1 2h12.8a1.3 1.3 0 001.1-2L14 10V3', 'M7 16h10'],
  folder: [folderFrame],
  folderOpen: ['M3 19V6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v2', 'M3 19l3-7h16l-3 7H3z'],
  folderPlus: [folderFrame, 'M15 10v6', 'M12 13h6'],
  folderMove: [folderFrame, 'M11 13h7', 'M15 10l3 3-3 3'],
  fork: ['M6 7v10', 'M6 3a2 2 0 110 4 2 2 0 010-4z', 'M6 17a2 2 0 110 4 2 2 0 010-4z', 'M18 3a2 2 0 110 4 2 2 0 010-4z', 'M6 9h6a6 6 0 006-2'],
  replyBranch: ['M5 20v-5a7 7 0 017-7h7', 'M15 4l4 4-4 4', 'M5 15v-4a7 7 0 00-2-5'],
  markdown: ['M3 5h18v14H3z', 'M6 15V9l3 3 3-3v6', 'M17 9v6', 'M15 13l2 2 2-2'],
  quote: ['M4 5h6v7H5c0 3 1 5 4 6', 'M14 5h6v7h-5c0 3 1 5 4 6'],
  textSelection: ['M3 18l4-12 4 12', 'M4.5 14h5', 'M16 4h5', 'M18.5 4v16', 'M16 20h5'],
  forward: ['M9 18l6-6-6-6'],
  globe: ['M12 22a10 10 0 100-20 10 10 0 000 20z', 'M2 12h20', 'M12 2a15 15 0 010 20 15 15 0 010-20z'],
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  hammer: ['M10 9H5V5l3-2h11v6h-5', 'M10 7v13a1 1 0 001 1h2a1 1 0 001-1V7', 'M17 3v6'],
  gitCommit: ['M9 12a3 3 0 106 0 3 3 0 00-6 0z', 'M3 12h6', 'M15 12h6'],
  gauge: ['M4 17a9 9 0 1116 0', 'M12 14l4-5', 'M4 20h16', 'M12 14a1 1 0 100 2 1 1 0 000-2z'],
  ghost: ['M5 20V10a7 7 0 0114 0v10l-3-2-4 2-4-2z', 'M9 11h.01', 'M15 11h.01'],
  help: ['M9.1 9a3 3 0 115.8 1c0 2-3 2-3 4', 'M12 18h.01', 'M21 12a9 9 0 11-18 0 9 9 0 0118 0z'],
  image: [squareFrame, 'M8 10a1 1 0 100-2 1 1 0 000 2z', 'M21 15l-5-5L5 21'],
  insect: ['M9 7h6l2 4v5a5 5 0 01-10 0v-5z', 'M12 7V3', 'M8 5L5 3', 'M16 5l3-2', 'M7 12H3', 'M7 16H3', 'M17 12h4', 'M17 16h4', 'M12 8v13'],
  info: ['M12 22a10 10 0 100-20 10 10 0 000 20z', 'M12 16v-4', 'M12 8h.01'],
  keyboard: ['M4 6h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1z', 'M7 10h.01', 'M12 10h.01', 'M17 10h.01', 'M7 14h.01', 'M10 14h7'],
  link: ['M10 13a5 5 0 007 .1l3-3a4.5 4.5 0 00-6.4-6.3L12 5.5', 'M14 11a5 5 0 00-7-.1l-3 3a4.5 4.5 0 006.4 6.3l1.6-1.7'],
  listCheck: ['M3 4h5v5H3z', 'M3 17l2 2 4-4', 'M13 5h8', 'M13 12h8', 'M13 19h8'],
  mic: ['M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3z', 'M19 10v2a7 7 0 01-14 0v-2', 'M12 19v2', 'M9 21h6'],
  moon: ['M20.5 15.2A8.5 8.5 0 018.8 3.5a8.5 8.5 0 1011.7 11.7z'],
  sun: ['M16 12a4 4 0 11-8 0 4 4 0 018 0z', 'M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2', 'M4.93 4.93l1.42 1.42', 'M17.65 17.65l1.42 1.42', 'M4.93 19.07l1.42-1.42', 'M17.65 6.35l1.42-1.42'],
  mailUnread: ['M15 5H4a1 1 0 00-1 1v13a1 1 0 001 1h16a1 1 0 001-1V10', 'M3 7l9 7 5-4', 'M20 3a2 2 0 110 4 2 2 0 010-4z'],
  martini: ['M3 4h18l-9 10z', 'M12 14v6', 'M7 20h10'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  save: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z', 'M7 3v6h9V3', 'M7 21v-8h10v8'],
  palette: ['M12 3a9 9 0 100 18h1a2 2 0 001.4-3.4 1.5 1.5 0 011.1-2.6H18a3 3 0 003-3 9 9 0 00-9-9z', 'M7.5 10h.01', 'M10.5 6.5h.01', 'M15 7h.01', 'M17.5 10.5h.01'],
  pacman: ['M12 12l8-7a10 10 0 101 12l-9-5z', 'M11 6h.01'],
  playCircle: ['M12 21a9 9 0 110-18 9 9 0 010 18z', 'M10 8l6 4-6 4z'],
  panelLeft: [panelFrame],
  panelRight: [panelFrame],
  paperclip: ['M21 11.5l-8.5 8.5a5 5 0 01-7-7l9-9a3.5 3.5 0 015 5l-9 9a2 2 0 01-3-3l8-8'],
  hook: ['M12 3a2 2 0 110 4 2 2 0 010-4z', 'M12 7v14', 'M8 10h8', 'M3 14v2a9 5 0 0018 0v-2', 'M3 14l3 2', 'M21 14l-3 2'],
  memory: ['M12 5a3 3 0 00-5-2 3 3 0 00-3 4 4 4 0 00-1 7 4 4 0 005 6 3 3 0 004-1V5z', 'M12 5a3 3 0 015-2 3 3 0 013 4 4 4 0 011 7 4 4 0 01-5 6 3 3 0 01-4-1', 'M8 7a3 3 0 01-4 0', 'M16 7a3 3 0 004 0', 'M8 13a3 3 0 00-4 2', 'M16 13a3 3 0 014 2'],
  pin: ['M16 3l5 5-4 1-4 5v3l-6-6h3l5-4z', 'M10 14l-7 7'],
  plus: ['M12 3v18', 'M3 12h18'],
  robot: ['M6 7h12a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2z', 'M12 7V3', 'M10 3h4', 'M8 12h.01', 'M16 12h.01', 'M9 16h6', 'M2 11v5', 'M22 11v5'],
  rocket: ['M7 16l-3 1-1 4 5-2', 'M8 17l-1-1c1-6 5-11 12-13 2 7-3 12-9 15z', 'M10 18l1 3 4-1 1-3', 'M15 8h.01'],
  refresh: ['M20 11a8 8 0 10-2.34 5.66', 'M20 4v7h-7'],
  search: ['M11 19a8 8 0 100-16 8 8 0 000 16z', 'M21 21l-4.35-4.35'],
  sort: ['M3 5h18', 'M6 12h12', 'M9 19h6'],
  send: ['M12 19V5', 'M5 12l7-7 7 7'],
  settings: ['M10 2h4l.5 2.25 1.65.7 1.95-1.2 2.8 2.8-1.2 1.95.7 1.65L22 10v4l-2.25.5-.7 1.65 1.2 1.95-2.8 2.8-1.95-1.2-1.65.7L14 22h-4l-.5-2.25-1.65-.7-1.95 1.2-2.8-2.8 1.2-1.95-.7-1.65L2 14v-4l2.25-.5.7-1.65-1.2-1.95 2.8-2.8 1.95 1.2 1.65-.7z', 'M12 15a3 3 0 100-6 3 3 0 000 6z'],
  chessKnight: ['M5 21h14', 'M7 18h11l-2-4 2-3-5-7-5 2-2 6 4 2z', 'M9 9h.01'],
  cupcake: ['M6 11h12l-1.5 9h-9z', 'M7 11a4 4 0 013-6 3 3 0 015 0 4 4 0 012 6', 'M12 3h.01'],
  cat: ['M5 8l3-4 4 3 4-3 3 4v8a7 7 0 01-14 0z', 'M9 13h.01', 'M15 13h.01', 'M10 17a3 3 0 004 0'],
  seal: ['M5 4h14v16H5z', 'M9 9l3-3 3 3-3 3z', 'M9 16h6'],
  alien: ['M12 3a8 8 0 018 8c0 5-4 10-8 10S4 16 4 11a8 8 0 018-8z', 'M8 12l2 1', 'M16 12l-2 1', 'M10 17h4'],
  shield: [shieldFrame],
  shieldCheck: [shieldFrame, 'M8 12l3 3 5-6'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M15 12a3 3 0 11-6 0 3 3 0 016 0z'],
  warning: ['M10.3 4a2 2 0 013.4 0l8 14a2 2 0 01-1.7 3H4a2 2 0 01-1.7-3z', 'M12 9v4', 'M12 17h.01'],
  sparkle: ['M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z', 'M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z'],
  stop: ['M6 6h12v12H6z'],
  play: ['M8 5l11 7-11 7z'],
  package: ['M12 3l9 5v9l-9 5-9-5V8z', 'M3 8l9 5 9-5M12 13v9M7.5 5.5l9 5V15'],
  target: ['M12 22a10 10 0 100-20 10 10 0 000 20z', 'M12 18a6 6 0 100-12 6 6 0 000 12z', 'M12 14a2 2 0 100-4 2 2 0 000 4z'],
  calendar: ['M3 4h18v16H3z', 'M8 2v4M16 2v4M3 10h18'],
  closeCircleFill: ['M22 12a10 10 0 11-20 0 10 10 0 0120 0z M8.5 7.1L12 10.6l3.5-3.5 1.4 1.4-3.5 3.5 3.5 3.5-1.4 1.4-3.5-3.5-3.5 3.5-1.4-1.4 3.5-3.5-3.5-3.5z'],
  terminal: ['M4 17l6-5-6-5', 'M12 19h8'],
  terminalSquare: [panelFrame, 'M7 9l3 3-3 3', 'M13 15h4'],
  terminalPanel: [panelFrame],
  splitVertical: [panelFrame, 'M12 5v14'],
  splitHorizontal: [panelFrame, 'M3 12h18'],
  window: [panelFrame, 'M3 9h18'],
  waveform: ['M4 10v4', 'M8 6v12', 'M12 3v18', 'M16 7v10', 'M20 9v6'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13', 'M9 7V4h6v3'],
} as const

export type IconName = keyof typeof paths

export function Icon({ name, size = 18, className, active = false, themeArtwork = true }: { readonly name: IconName; readonly size?: number; readonly className?: string; readonly active?: boolean; readonly themeArtwork?: boolean }) {
  const indicator = name in panelIndicators ? panelIndicators[name as keyof typeof panelIndicators] : undefined
  return (
    <svg
      aria-hidden="true"
      data-icon={themeArtwork ? name : undefined}
      className={tw("icon block shrink-0 align-middle", className)}
      fill={name === 'closeCircleFill' ? 'currentColor' : 'none'}
      fillRule={name === 'closeCircleFill' ? 'evenodd' : undefined}
      focusable="false"
      stroke={name === 'closeCircleFill' ? 'none' : 'currentColor'}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name].map((path, index) => (
        <path d={path} fill={name === 'pin' && active && index === 0 ? 'currentColor' : undefined} key={path} />
      ))}
      {indicator ? <rect {...indicator} fill="currentColor" stroke="none" opacity={active ? 1 : 0.28} rx={0.4} /> : null}
    </svg>
  )
}
