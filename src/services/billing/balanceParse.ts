/**
 * 余额响应的纯解析逻辑。
 *
 * 这里刻意不导入任何模块（尤其是构建期注入的 API_ORIGIN），
 * 以便 node --test 直接 import 真实的 .ts 源码做单测。
 *
 * 两条硬性约束：
 * 1. 金额一律以原始字符串保留，绝不转成 number —— 浮点会改写 "0.00"、"5.0000000000000000" 这类值。
 * 2. 解析失败必须返回 null，绝不允许变成 0 余额（"查不到余额" 与 "余额为零" 是两件事）。
 */

/** 单个币种钱包的余额，字段均为接口返回的原始字符串 */
export type BalanceWallet = {
  currency: string
  /** 总余额（含赠送） */
  total: string
  /** 赠送余额 */
  granted: string
  /** 充值余额 */
  toppedUp: string
}

/** 一次成功读取得到的余额快照 */
export type BalanceSnapshot = {
  /** 余额是否足以发起 API 调用；接口未给出时为 null（表示未知，而非不足） */
  isAvailable: boolean | null
  wallets: BalanceWallet[]
  /** 读取成功的时间戳，用于界面展示与轮询判断 */
  fetchedAt: number
}

/**
 * 十进制数字文法，与前端 big.js 接受的写法一致：
 * 允许省略整数部分（.5）或小数部分（5.），允许十进制指数（0E-16）。
 * 拒绝 NaN、Infinity、空串与任何非数字文本。
 */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

/** 判断一个值是否是可直接展示的十进制金额字符串 */
export const isDecimalString = (value: unknown): value is string =>
  typeof value === 'string' && DECIMAL.test(value)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 各字段都可能缺失；缺失时补空串，表示"该金额未提供"，而不是填 0 */
const readAmount = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return ''
  }
  return isDecimalString(value) ? value : null
}

const parseWallet = (value: unknown): BalanceWallet | null => {
  if (!isRecord(value)) {
    return null
  }
  const currency = value.currency
  if (typeof currency !== 'string' || currency.trim() === '') {
    return null
  }
  const total = readAmount(value.total_balance)
  const granted = readAmount(value.granted_balance)
  const toppedUp = readAmount(value.topped_up_balance)
  if (total === null || granted === null || toppedUp === null) {
    return null
  }
  return { currency, total, granted, toppedUp }
}

/**
 * 解析 GET /user/balance 的响应体。
 * @param payload 已 JSON.parse 的响应体
 * @param now 读取完成时间，注入以便测试
 * @returns 成功时的快照；结构不符合协议时返回 null（调用方据此报协议错误，而不是显示 0）
 */
export const parseBalance = (payload: unknown, now: number = Date.now()): BalanceSnapshot | null => {
  if (!isRecord(payload)) {
    return null
  }
  const infos = payload.balance_infos
  // 缺少该字段说明响应不是余额接口的形状，按协议错误处理
  if (!Array.isArray(infos)) {
    return null
  }
  const wallets: BalanceWallet[] = []
  for (const info of infos) {
    const wallet = parseWallet(info)
    // 任一钱包不合法即整体失败，避免展示一部分、隐藏另一部分造成误读
    if (wallet === null) {
      return null
    }
    wallets.push(wallet)
  }
  const isAvailable = typeof payload.is_available === 'boolean' ? payload.is_available : null
  return { isAvailable, wallets, fetchedAt: now }
}

/** 展示优先级：人民币 > 美元 > 接口顺序中的第一个 */
const CURRENCY_PRIORITY = ['CNY', 'USD']

/** 选出用于徽标等紧凑位置展示的钱包；没有钱包时返回 null */
export const preferredWallet = (wallets: readonly BalanceWallet[]): BalanceWallet | null => {
  for (const currency of CURRENCY_PRIORITY) {
    const hit = wallets.find((wallet) => wallet.currency.toUpperCase() === currency)
    if (hit) {
      return hit
    }
  }
  return wallets[0] ?? null
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
}

/** 币种符号；未知币种回退为代码本身 */
export const currencySymbol = (currency: string): string =>
  CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `

/** 金额保留两位小数用于展示；仅用于显示，不改变保存的原始字符串 */
export const formatAmount = (amount: string): string => {
  if (amount === '') {
    return '--'
  }
  // 原始值可能带指数或省略整数部分，交给 Number 归一化后再定型——此处只影响显示
  const value = Number(amount)
  if (!Number.isFinite(value)) {
    return amount
  }
  return value.toFixed(2)
}
