import { useId } from 'react'
import { tw } from './tailwind.js'

type Key = readonly [label: string, width: number]
const keys = (labels: string[]): Key[] => labels.map(label => [label, 1])
const rows: readonly (readonly Key[])[] = [
  [['esc', 1.5], ...keys(Array.from({ length: 12 }, (_, index) => `F${index + 1}`)), ['◯', 1]],
  [...keys(['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '−', '=']), ['delete', 1.5]],
  [['tab', 1.5], ...keys(['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'])],
  [['caps lock', 1.75], ...keys(['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'"]), ['return', 1.75]],
  [['shift', 2.25], ...keys(['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/']), ['shift', 2.25]],
  [['fn', 1], ['control', 1], ['option', 1], ['command', 1.25], ['', 5], ['command', 1.25], ['option', 1], ['◀', 1], ['▲ ▼', 1], ['▶', 1]],
]

/** A local illustration; highlighted keys reflect the configured shortcut. */
export function ComputerSnapshotPreview({ shortcut }: { shortcut: string }) {
  const id = useId().replaceAll(':', '')
  const mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
  const selected = new Set(shortcut ? ['shift', mac ? 'command' : 'control', shortcut.split('+').at(-1)] : [])
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 900 312" className={tw('block w-full overflow-hidden rounded-2xl')}>
    <defs>
      <linearGradient id={`${id}-green`} x2=".8" y2="1">
        <stop stopColor="#213f31" /><stop offset=".5" stopColor="#69805a" /><stop offset="1" stopColor="#2e4e35" />
      </linearGradient>
      <linearGradient id={`${id}-light`} x2="1" y2=".8"><stop stopColor="#bdca8a" stopOpacity=".5" /><stop offset="1" stopColor="#547a48" stopOpacity="0" /></linearGradient>
      <filter id={`${id}-terrain`} x="-10%" y="-20%" width="120%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency=".008 .045" numOctaves="4" seed="8" />
        <feColorMatrix values="0 0 0 0 .32 0 0 0 0 .44 0 0 0 0 .23 1.2 0 0 0 -.2" />
        <feBlend in2="SourceGraphic" mode="soft-light" />
      </filter>
      <filter id={`${id}-shadow`} x="-15%" y="-20%" width="130%" height="150%"><feDropShadow dx="0" dy="8" stdDeviation="10" floodColor="#14271b" floodOpacity=".35" /></filter>
    </defs>
    <rect width="900" height="312" fill={`url(#${id}-green)`} />
    <g filter={`url(#${id}-terrain)`}>
      <path d="M-30 130C100 10 230 100 330 62S570-40 720 12 900 65 940-10V330H-30Z" fill="#48684b" />
      <path d="M-20 230C150 145 175 195 330 150S510 50 675 130 780 145 940 30V330H-20Z" fill="#718451" opacity=".65" />
      <path d="M-20 275C130 190 235 225 410 188S635 230 940 110V330H-20Z" fill="#35543c" opacity=".8" />
    </g>
    <rect width="900" height="312" fill={`url(#${id}-light)`} />
    <g filter={`url(#${id}-shadow)`}>
      <rect x="162" y="34" width="576" height="244" rx="20" fill="#dce2dc" />
      <rect x="163" y="35" width="574" height="241" rx="19" fill="#f0f1ef" stroke="#f9faf8" strokeWidth="2" />
      {rows.map((row, rowIndex) => {
        const unit = (556 - (row.length - 1) * 4) / row.reduce((sum, key) => sum + key[1], 0)
        let x = 172
        return <g key={rowIndex}>{row.map(([label, units], index) => {
          const width = units * unit; const left = x; x += width + 4
          const active = selected.has(label)
          return <g key={index}>
            <rect x={left} y={43 + rowIndex * 38} width={width} height="34" rx="5" fill={active ? '#e3ede1' : '#fcfdfb'} stroke={active ? '#769477' : '#e3e6e0'} strokeWidth={active ? 1.5 : .7} />
            <text x={left + width / 2} y={64 + rowIndex * 38} textAnchor="middle" fill={active ? '#3c6242' : '#7c827d'} fontSize={label.length > 5 ? 7.5 : 8.5} fontFamily="system-ui, sans-serif" fontWeight={active ? 600 : 400}>{label === 'command' && !mac ? 'win' : label === 'option' && !mac ? 'alt' : label}</text>
          </g>
        })}</g>
      })}
    </g>
  </svg>
}
