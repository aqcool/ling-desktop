import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon.js'
import { tw } from './tailwind.js'

const listGap = 6
const viewportEdge = 8

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

interface ListPlacement {
  readonly left: number
  readonly maxHeight: number
  readonly top: number
}

export function placeList(
  trigger: { readonly bottom: number; readonly left: number; readonly right: number; readonly top: number },
  list: { readonly height: number; readonly width: number },
  viewport: { readonly height: number; readonly width: number },
  align: 'start' | 'end',
  side: 'top' | 'bottom' = 'bottom',
): ListPlacement {
  const left = clamp(
    align === 'end' ? trigger.right - list.width : trigger.left,
    viewportEdge,
    viewport.width - list.width - viewportEdge,
  )
  const spaceBelow = viewport.height - trigger.bottom - listGap
  const spaceAbove = trigger.top - listGap - viewportEdge
  const openUp = side === 'top' ? spaceAbove >= list.height || spaceAbove > spaceBelow : list.height > spaceBelow && spaceAbove > spaceBelow
  const bottomLimit = openUp ? trigger.top - listGap : viewport.height - viewportEdge
  const top = openUp ? Math.max(viewportEdge, bottomLimit - list.height) : trigger.bottom + listGap
  return { left, maxHeight: Math.min(list.height, Math.max(0, bottomLimit - top)), top }
}

interface MenuProps {
  readonly contextRequest?: { readonly x: number; readonly y: number; readonly nonce: number }
  readonly triggerLabel: ReactNode | ((open: boolean) => ReactNode)
  readonly triggerAriaLabel?: string
  readonly triggerClassName?: string
  readonly listClassName?: string
  readonly align?: 'start' | 'end'
  readonly side?: 'top' | 'bottom'
  readonly children: ReactNode
}

export function Menu({ contextRequest, triggerLabel, triggerAriaLabel, triggerClassName, listClassName, align = 'end', side = 'bottom', children }: MenuProps) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<ListPlacement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const autoFocused = useRef(false)
  const [contextPoint, setContextPoint] = useState<{ readonly x: number; readonly y: number }>()
  useEffect(() => {
    if (!contextRequest) return
    setContextPoint(contextRequest)
    setOpen(true)
  }, [contextRequest])

  useEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }
    const place = () => {
      const trigger = triggerRef.current
      const list = listRef.current
      if (!trigger || !list) return
      setPlacement(placeList(
        contextPoint ? { left: contextPoint.x, right: contextPoint.x, top: contextPoint.y, bottom: contextPoint.y } : trigger.getBoundingClientRect(),
        { height: list.scrollHeight + list.offsetHeight - list.clientHeight, width: list.offsetWidth },
        { height: window.innerHeight, width: window.innerWidth },
        contextPoint ? 'start' : align,
        side,
      ))
    }
    place()
    const observer = new ResizeObserver(place)
    if (listRef.current) observer.observe(listRef.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, align, side, contextPoint])

  useEffect(() => {
    if (!open) {
      autoFocused.current = false
      return
    }
    if (!placement || autoFocused.current) return
    autoFocused.current = true
    listRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])')?.focus()
  }, [open, placement])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [open])

  const menuItems = () => [...(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])') ?? [])]

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems()
    if (items.length === 0) return
    const active = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      items[(Math.max(active, 0) + step + items.length) % items.length]?.focus()
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      if (active < 0) return
      event.preventDefault()
      items[active]?.click()
      return
    }
    if (event.key === 'Tab') {
      if (event.shiftKey || active < 0 || active === items.length - 1) setOpen(false)
    }
  }

  const onWrapperBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!open) return
    const next = event.relatedTarget
    if (next instanceof Node && (event.currentTarget.contains(next) || listRef.current?.contains(next))) return
    setOpen(false)
  }

  return (
    <div className={tw("ling-menu relative inline-flex min-w-0")} onBlur={onWrapperBlur}>
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={triggerAriaLabel}
        className={tw("ling-menu__trigger inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 border-0 bg-transparent p-0 text-[var(--text-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]", triggerClassName, open && "ling-menu__trigger--open bg-[var(--surface-hover)] text-[var(--foreground)]")}
        onClick={() => { setContextPoint(undefined); setOpen(current => !current) }}
        type="button"
      >
        {typeof triggerLabel === 'function' ? triggerLabel(open) : triggerLabel}
      </button>
      {open ? createPortal(
        <>
          <div className={tw("ling-menu__backdrop fixed [inset:0] [z-index:40]")} role="presentation" onClick={() => { setOpen(false) }} />
          <div
            aria-label={triggerAriaLabel}
            className={tw("ling-menu__list fixed z-41 max-h-[min(24rem,70vh)] min-w-50 overflow-auto rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-1 shadow-lg", listClassName)}
            onKeyDown={onListKeyDown}
            ref={listRef}
            role="menu"
            style={placement
              ? { left: `${String(placement.left)}px`, maxHeight: `${String(placement.maxHeight)}px`, top: `${String(placement.top)}px` }
              : { visibility: 'hidden' }}
          >
            <div
              onClick={() => {
                setOpen(false)
                if (listRef.current?.contains(document.activeElement)) triggerRef.current?.focus()
              }}
            >{children}</div>
          </div>
        </>,
        document.body,
      ) : null}
    </div>
  )
}

interface MenuItemProps {
  readonly children: ReactNode
  readonly icon?: IconName
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly checked?: boolean
  readonly description?: string
  readonly suffix?: ReactNode
  readonly title?: string
  readonly onPress: () => void
}

export function MenuItem({ children, icon, danger, disabled, checked, description, suffix, title, onPress }: MenuItemProps) {
  return (
    <button
      className={tw("ling-menu__item flex min-h-control w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] aria-checked:bg-[var(--surface-selected)] enabled:hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus)] disabled:cursor-default disabled:opacity-50", danger && 'text-[var(--danger)] enabled:hover:bg-[color-mix(in_oklab,var(--danger)_8%,var(--surface))]')}
      disabled={disabled}
      onClick={onPress}
      aria-checked={checked}
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      title={title}
      type="button"
    >
      {icon ? <Icon name={icon} size={16} /> : <span className={tw("ling-menu__item-spacer [width:1rem] flex-none")} />}
      <span className={tw("ling-menu__item-copy grid min-w-0 flex-1 gap-0.5")}><span>{children}</span>{description ? <small className={tw("text-caption leading-[1.35] font-normal text-[var(--text-tertiary)]")}>{description}</small> : null}</span>
      {suffix ? <span className={tw("ling-menu__item-suffix inline-flex flex-none items-center text-[var(--text-tertiary)] text-caption")}>{suffix}</span> : null}
      {checked !== undefined ? <Icon className={tw(!checked && "invisible")} name="check" size={14} /> : null}
    </button>
  )
}

export function MenuLabel({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return <p className={tw("ling-menu__label max-w-80 overflow-hidden text-ellipsis whitespace-nowrap px-2 pt-1.5 pb-2 text-caption text-[var(--text-tertiary)]", className)}>{children}</p>
}

export function MenuSeparator() {
  return <div className={tw("ling-menu__separator [height:1px] my-1 mx-1.5 [background:var(--separator)]")} role="separator" />
}
