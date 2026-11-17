type ExternalLinkBridge = {
  open: (url: string) => boolean
}

declare global {
  interface Window {
    AndroidExternal?: ExternalLinkBridge
  }
}

const externalProtocols = new Set(['http:', 'https:'])

/**
 * Android WebView 里 target="_blank" 可能直接无响应。
 * 原生壳提供桥接时，把网页外链交给系统浏览器打开；浏览器环境保持原行为。
 */
export const installExternalLinkBridge = () => {
  if (!window.AndroidExternal) {
    return
  }

  document.addEventListener(
    'click',
    (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      const anchor = event
        .composedPath()
        .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement)
      if (!anchor) {
        return
      }

      let url: URL
      try {
        url = new URL(anchor.href, window.location.href)
      } catch {
        return
      }
      if (!externalProtocols.has(url.protocol)) {
        return
      }
      if (anchor.target !== '_blank' && url.origin === window.location.origin) {
        return
      }
      if (window.AndroidExternal?.open(url.href)) {
        event.preventDefault()
      }
    },
    true
  )
}
