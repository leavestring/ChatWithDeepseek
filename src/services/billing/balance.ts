/**
 * 余额查询：GET /user/balance（DeepSeek 官方文档的 API Key 余额接口）。
 *
 * 这里只负责"取回并解析"，不做缓存与状态管理（那是 balanceStore 的职责），
 * 也不关心界面，便于单测与复用。
 */
import { API_ORIGIN } from '../api/client.js'
import { parseBalance, type BalanceSnapshot } from './balanceParse.js'

/** DeepSeek Platform 的官方充值页；点击后由浏览器/系统浏览器打开 */
export const TOP_UP_URL = 'https://platform.deepseek.com/top_up'
/** 用量明细（仅支持平台登录态，App 内以外链打开） */
export const USAGE_URL = 'https://platform.deepseek.com/usage'
/** API Keys 管理页，用于创建/更换 Key */
export const API_KEYS_URL = 'https://platform.deepseek.com/api_keys'

/** 余额查询的超时时间；超时不改变已保存的 Key，也不伪造零余额 */
const BALANCE_TIMEOUT_MS = 15_000

export type BalanceFailureKind =
  /** 请求没有到达服务端：断网、CORS 被拦截等 */
  | 'network'
  /** 非 2xx 响应（401 单独归为 unauthorized） */
  | 'http'
  /** 响应不是可解析的余额结构 */
  | 'protocol'
  /** 请求超时 */
  | 'timeout'

export type BalanceResult =
  /** 读到了余额 */
  | { status: 'ready'; snapshot: BalanceSnapshot }
  /** Key 无效或已被删除；调用方应引导用户更换 Key */
  | { status: 'unauthorized' }
  /** 读取失败；绝不折算成零余额 */
  | { status: 'failed'; kind: BalanceFailureKind; detail?: string }

/**
 * 读取当前 API Key 的余额。
 * @param apiKey 明文 API Key
 * @param signal 调用方生命周期，用于取消
 */
export const fetchBalance = async (
  apiKey: string,
  signal?: AbortSignal
): Promise<BalanceResult> => {
  const key = apiKey.trim()
  if (!key) {
    return { status: 'unauthorized' }
  }

  // 超时与调用方取消合并：任一触发都中止本次请求
  const timeout = AbortSignal.timeout(BALANCE_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetch(`${API_ORIGIN}/user/balance`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: combined,
    })
  } catch (error) {
    // 调用方主动取消不是错误，交给上层忽略
    if (signal?.aborted) {
      throw error
    }
    if (timeout.aborted) {
      return { status: 'failed', kind: 'timeout' }
    }
    return {
      status: 'failed',
      kind: 'network',
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  if (response.status === 401) {
    return { status: 'unauthorized' }
  }
  if (!response.ok) {
    return { status: 'failed', kind: 'http', detail: `HTTP ${response.status}` }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { status: 'failed', kind: 'protocol', detail: 'invalid JSON' }
  }

  const snapshot = parseBalance(payload)
  if (!snapshot) {
    return { status: 'failed', kind: 'protocol', detail: 'unexpected payload' }
  }
  return { status: 'ready', snapshot }
}
