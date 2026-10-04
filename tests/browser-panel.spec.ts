import { describe, expect, it } from 'vitest'
import { browserErrorCopy, browserTitle, parseBrowserElementSelection, parseBrowserTarget } from '../src/ui/BrowserPanel.js'

const origin = 'https://ling.example/app'

describe('browser address parsing', () => {
  it('refuses empty, over-long, and unparseable input', () => {
    expect(parseBrowserTarget('   ', origin)).toEqual({ ok: false, reason: 'empty' })
    expect(parseBrowserTarget('x'.repeat(16385), origin)).toEqual({ ok: false, reason: 'invalid' })
    expect(parseBrowserTarget('http://', origin)).toEqual({ ok: false, reason: 'invalid' })
    expect(parseBrowserTarget('http://[::1', origin)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('accepts http and https and canonicalizes bare hosts to https', () => {
    expect(parseBrowserTarget('https://example.com/docs', origin)).toEqual({
      ok: true,
      url: 'https://example.com/docs',
      title: 'example.com',
    })
    expect(parseBrowserTarget('example.com:8080/path', origin)).toEqual({
      ok: true,
      url: 'https://example.com:8080/path',
      title: 'example.com',
    })
    expect(parseBrowserTarget('http://example.com', origin)).toEqual({
      ok: true,
      url: 'http://example.com/',
      title: 'example.com',
    })
    expect(parseBrowserTarget('localhost:3000', origin)).toEqual({
      ok: true,
      url: 'http://localhost:3000/',
      title: 'localhost',
    })
  })

  it('refuses other protocols, embedded credentials, and the application itself', () => {
    expect(parseBrowserTarget('javascript:alert(1)', origin)).toEqual({ ok: false, reason: 'protocol' })
    expect(parseBrowserTarget('ftp://example.com', origin)).toEqual({ ok: false, reason: 'protocol' })
    expect(parseBrowserTarget('file:///etc/passwd', origin)).toEqual({ ok: false, reason: 'protocol' })
    expect(parseBrowserTarget('https://user:pass@example.com', origin)).toEqual({ ok: false, reason: 'credentials' })
    expect(parseBrowserTarget('https://ling.example/other', origin)).toEqual({ ok: false, reason: 'application-origin' })
    expect(parseBrowserTarget('https://ling.example/app', '')).toEqual({
      ok: true,
      url: 'https://ling.example/app',
      title: 'ling.example',
    })
  })

  it('names each refusal in product copy', () => {
    expect(browserErrorCopy('empty')).toBe('请输入地址。')
    expect(browserErrorCopy('invalid')).toBe('这个地址无效或过长。')
    expect(browserErrorCopy('protocol')).toBe('只支持 HTTP 和 HTTPS 地址；本地文件请使用文档预览。')
    expect(browserErrorCopy('credentials')).toBe('地址不能包含用户名或密码。')
    expect(browserErrorCopy('application-origin')).toBe('不能在嵌入浏览器中打开灵创应用自身。')
  })

  it('titles frames by host name', () => {
    expect(browserTitle('https://example.com/docs')).toBe('example.com')
    expect(browserTitle('not a url')).toBe('not a url')
  })
})

describe('browser element selection boundary', () => {
  it('accepts and clips a valid page element description', () => {
    expect(parseBrowserElementSelection({
      selector: '#submit', tagName: 'button', text: 'Send', id: 'submit', className: 'primary',
      role: 'button', ariaLabel: 'Send message', href: '', rect: { x: 1, y: 2, width: 80, height: 32 },
    })).toEqual({
      selector: '#submit', tagName: 'button', text: 'Send', id: 'submit', className: 'primary',
      role: 'button', ariaLabel: 'Send message', href: '', rect: { x: 1, y: 2, width: 80, height: 32 },
    })
    expect(parseBrowserElementSelection({
      selector: `#${'x'.repeat(1200)}`, tagName: 'div', rect: { x: 0, y: 0, width: 1, height: 1 },
    })?.selector).toHaveLength(1024)
  })

  it('rejects malformed messages from embedded pages', () => {
    expect(parseBrowserElementSelection(null)).toBeUndefined()
    expect(parseBrowserElementSelection({ selector: '#x', tagName: 'div' })).toBeUndefined()
    expect(parseBrowserElementSelection({ selector: '#x', tagName: 'div', rect: { x: 0, y: 0, width: Infinity, height: 1 } })).toBeUndefined()
  })
})
