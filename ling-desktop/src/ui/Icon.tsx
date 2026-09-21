const paths = {
  back: ['M15 18l-6-6 6-6'],
  bell: ['M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4'],
  branch: ['M6 3v12', 'M18 9a3 3 0 100-6 3 3 0 000 6z', 'M6 21a3 3 0 100-6 3 3 0 000 6z', 'M18 9a6 6 0 01-6 6H6'],
  change: ['M4 7h16', 'M4 17h16', 'M8 3v8', 'M16 13v8'],
  chevronDown: ['M6 9l6 6 6-6'],
  compose: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z'],
  external: ['M14 3h7v7', 'M10 14L21 3', 'M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5'],
  file: ['M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z', 'M14 2v6h6'],
  folder: ['M3 6h5l2 2h11v10a2 2 0 01-2 2H5a2 2 0 01-2-2z'],
  forward: ['M9 18l6-6-6-6'],
  help: ['M9.1 9a3 3 0 115.8 1c0 2-3 2-3 4', 'M12 18h.01', 'M21 12a9 9 0 11-18 0 9 9 0 0118 0z'],
  link: ['M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71'],
  mic: ['M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z', 'M19 10v2a7 7 0 01-14 0v-2', 'M12 19v3'],
  panel: ['M3 3h18v18H3z', 'M9 3v18'],
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M11 19a8 8 0 100-16 8 8 0 000 16z', 'M21 21l-4.35-4.35'],
  send: ['M12 19V5', 'M5 12l7-7 7 7'],
  settings: ['M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z', 'M19.4 15a1.7 1.7 0 00.34 1.88l.06.06-2 3.46-.08-.02a1.7 1.7 0 00-1.8.42l-.15.09a1.7 1.7 0 00-.77 1.7V22h-4v-.09a1.7 1.7 0 00-.77-1.7l-.15-.09a1.7 1.7 0 00-1.8-.42l-.08.02-2-3.46.06-.06A1.7 1.7 0 006.6 15v-.18a1.7 1.7 0 00-1-1.55L5.5 13v-4l.1-.04a1.7 1.7 0 001-1.55v-.18a1.7 1.7 0 00-.34-1.88l-.06-.06 2-3.46.08.02a1.7 1.7 0 001.8-.42l.15-.09A1.7 1.7 0 0011 0h2a1.7 1.7 0 00.77 1.7l.15.09a1.7 1.7 0 001.8.42l.08-.02 2 3.46-.06.06a1.7 1.7 0 00-.34 1.88v.18a1.7 1.7 0 001 1.55l.1.04v4l-.1.04a1.7 1.7 0 00-1 1.55z'],
  terminal: ['M4 17l6-5-6-5', 'M12 19h8'],
} as const

export type IconName = keyof typeof paths

export function Icon({ name, size = 18 }: { readonly name: IconName; readonly size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name].map(path => (
        <path d={path} key={path} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      ))}
    </svg>
  )
}
