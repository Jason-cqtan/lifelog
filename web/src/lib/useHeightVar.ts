import { useCallback, useRef } from 'react'

/**
 * Callback ref that keeps a CSS variable on <html> equal to the element's
 * height, so the next pinned bar can stick right under it. Resets to 0px when
 * the element unmounts (e.g. on another tab).
 */
export function useHeightVar(name: string) {
  const ro = useRef<ResizeObserver | null>(null)
  return useCallback(
    (el: HTMLElement | null) => {
      ro.current?.disconnect()
      ro.current = null
      const root = document.documentElement.style
      if (!el) {
        root.setProperty(name, '0px')
        return
      }
      ro.current = new ResizeObserver(() => root.setProperty(name, `${el.offsetHeight}px`))
      ro.current.observe(el)
    },
    [name],
  )
}
