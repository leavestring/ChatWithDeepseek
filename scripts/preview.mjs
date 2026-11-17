/**
 * 手机/桌面预览与布局检查工具（基于 Chrome DevTools Protocol）。
 *
 * 为什么不用 `msedge --headless --screenshot --window-size`：
 * 那是"窗口尺寸"，不是"视口尺寸"，窗口边框/缩放会让结果偏几十像素，
 * 也无法模拟触摸、DPR 与移动端 UA，用来判断移动端布局会得出错误结论。
 *
 * 这里直接走 CDP：可以精确设置视口、设备像素比、是否移动端，
 * 还能在截图前执行点击等交互，并对任意选择器测量几何尺寸。
 *
 * 用法：
 *   node scripts/preview.mjs --out shot.png
 *   node scripts/preview.mjs --device pixel --out mobile.png
 *   node scripts/preview.mjs --width 1280 --height 900 --out desktop.png --theme dark
 *   node scripts/preview.mjs --device iphone --click '[aria-haspopup="dialog"]'
 *   node scripts/preview.mjs --measure 'body' '.dialog' '.navigation'
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 常用设备视口；数值取自各机型逻辑分辨率 */
const DEVICES = {
  pixel: { width: 412, height: 915, dpr: 2.625, mobile: true },
  iphone: { width: 393, height: 852, dpr: 3, mobile: true },
  iphoneSe: { width: 375, height: 667, dpr: 2, mobile: true },
  smallAndroid: { width: 360, height: 740, dpr: 3, mobile: true },
  tablet: { width: 768, height: 1024, dpr: 2, mobile: true },
  desktop: { width: 1280, height: 900, dpr: 1, mobile: false },
}

const parseArgs = (argv) => {
  const args = {
    url: 'http://localhost:8090/',
    out: '.preview/shot.png',
    device: null,
    width: null,
    height: null,
    dpr: null,
    mobile: null,
    theme: null,
    click: [],
    measure: [],
    eval: [],
    wait: 1200,
    settle: 350,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    const next = () => argv[++i]
    switch (key) {
      case '--url': args.url = next(); break
      case '--out': args.out = next(); break
      case '--device': args.device = next(); break
      case '--width': args.width = Number(next()); break
      case '--height': args.height = Number(next()); break
      case '--dpr': args.dpr = Number(next()); break
      case '--wait': args.wait = Number(next()); break
      case '--settle': args.settle = Number(next()); break
      case '--click': args.click.push(next()); break
      case '--measure': args.measure.push(next()); break
      case '--eval': args.eval.push(next()); break
      case '--theme': args.theme = next(); break
      case '--mobile': args.mobile = true; break
      case '--desktop': args.mobile = false; break
      default:
        throw new Error(`未知参数：${key}`)
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

const preset = args.device ? DEVICES[args.device] : null
if (args.device && !preset) {
  throw new Error(`未知设备 ${args.device}，可选：${Object.keys(DEVICES).join(', ')}`)
}

const base = preset ?? DEVICES.desktop
const viewport = {
  width: args.width ?? base.width,
  height: args.height ?? base.height,
  dpr: args.dpr ?? base.dpr,
  mobile: args.mobile ?? base.mobile,
}

const edgeCandidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]
const browserPath = edgeCandidates.find((candidate) => existsSync(candidate))
if (!browserPath) {
  throw new Error('未找到 Edge 或 Chrome')
}

const port = 9333 + Math.floor(Math.random() * 200)
const profile = path.join(
  process.env.TEMP ?? '/tmp',
  `cdp-preview-${Math.random().toString(16).slice(2, 8)}`
)

const browser = spawn(
  browserPath,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 轮询等待 DevTools HTTP 端点就绪 */
const waitForEndpoint = async () => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) {
        return (await response.json()).webSocketDebuggerUrl
      }
    } catch {
      // 还没起来
    }
    await sleep(100)
  }
  throw new Error('DevTools 端点未就绪')
}

/** 极简 CDP 客户端：按 id 匹配响应，事件单独分发 */
class Cdp {
  constructor(socket) {
    this.socket = socket
    this.id = 0
    this.pending = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) {
          reject(new Error(JSON.stringify(message.error)))
        } else {
          resolve(message.result)
        }
      }
    })
  }

  send(method, params = {}, sessionId) {
    this.id += 1
    const id = this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
  }
}

const connect = (url) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.addEventListener('open', () => resolve(new Cdp(socket)))
    socket.addEventListener('error', () => reject(new Error('WebSocket 连接失败')))
  })

let exitCode = 0
try {
  const browserWs = await waitForEndpoint()
  const browserCdp = await connect(browserWs)

  // 新建一个标签页，拿到独立的 session
  const { targetId } = await browserCdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browserCdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  })
  const page = {
    send: (method, params) => browserCdp.send(method, params, sessionId),
  }

  await page.send('Page.enable')
  await page.send('Runtime.enable')

  // 关键：这里设置的是真正的"视口"，并且可以声明为移动端
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.dpr,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  })
  if (viewport.mobile) {
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await page.send('Network.setUserAgentOverride', {
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/131.0.0.0 Mobile Safari/537.36',
    })
  }

  // 主题偏好：网页端靠 localStorage + data 属性，这里直接预置
  if (args.theme) {
    const scheme = args.theme === 'dark' ? 'dark' : 'light'
    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: scheme }],
    })
  }

  await page.send('Page.navigate', { url: args.url })
  await sleep(args.wait)

  const evaluate = async (expression) => {
    const result = await page.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? '脚本执行失败')
    }
    return result.result.value
  }

  // 依次点击（用于预览弹窗等交互后的状态）
  for (const selector of args.click) {
    const clicked = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return false
      el.click()
      return true
    })()`)
    if (!clicked) {
      console.warn(`[warn] 未找到元素：${selector}`)
    }
    await sleep(args.settle)
  }

  // 任意表达式求值，用于排查
  for (const expression of args.eval) {
    const value = await evaluate(expression)
    console.log(`[eval] ${expression}\n${JSON.stringify(value, null, 2)}`)
  }

  // 布局检查：给出每个元素的实际盒模型与是否溢出视口
  if (args.measure.length > 0) {
    const report = await evaluate(`(() => {
      const selectors = ${JSON.stringify(args.measure)}
      const vw = window.innerWidth
      return {
        viewport: { width: vw, height: window.innerHeight, dpr: window.devicePixelRatio },
        elements: selectors.map((selector) => {
          const el = document.querySelector(selector)
          if (!el) return { selector, found: false }
          const r = el.getBoundingClientRect()
          return {
            selector,
            found: true,
            left: Math.round(r.left * 100) / 100,
            right: Math.round(r.right * 100) / 100,
            width: Math.round(r.width * 100) / 100,
            height: Math.round(r.height * 100) / 100,
            overflowsRight: r.right > vw + 0.5,
            overflowsLeft: r.left < -0.5,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
          }
        }),
      }
    })()`)
    console.log(JSON.stringify(report, null, 2))
  }

  const { data } = await page.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  })

  const outPath = path.isAbsolute(args.out) ? args.out : path.join(root, args.out)
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, Buffer.from(data, 'base64'))
  console.log(`已保存 ${path.relative(root, outPath)} (${viewport.width}x${viewport.height} @${viewport.dpr}x)`)
} catch (error) {
  console.error(`预览失败：${error.message}`)
  exitCode = 1
} finally {
  try {
    browser.kill()
  } catch {
    // 忽略
  }
}

process.exit(exitCode)
