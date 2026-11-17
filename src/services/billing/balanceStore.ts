/**
 * 余额状态：把 fetchBalance 的结果投影成界面可直接订阅的状态。
 *
 * 设计要点：
 * - 只保留"最近一次成功"的快照；失败时保留旧快照并标注，绝不把界面清成 0。
 * - API Key 变化时立即作废旧账号的结果，避免串号。
 * - 并发调用合并为一次请求（如侧边栏与面板同时触发刷新）。
 */
import { create } from 'zustand'
import { fetchBalance, type BalanceResult } from './balance.js'
import type { BalanceSnapshot } from './balanceParse.js'

export type BalanceStatus =
  /** 还没查过（例如尚未设置 API Key） */
  | 'idle'
  | 'loading'
  | 'ready'
  /** Key 无效，需要更换 */
  | 'unauthorized'
  | 'failed'

type BalanceState = {
  status: BalanceStatus
  /** 最近一次成功的余额；失败时保留，供界面继续显示并标注时间 */
  snapshot: BalanceSnapshot | null
  /** 最近一次失败的原因 */
  failure: Extract<BalanceResult, { status: 'failed' }> | null
  /** 无 Key 时不发请求，状态回到 idle */
  refresh: (apiKey: string | null) => Promise<void>
  /** Key 变更/清空时丢弃上一个账号的余额 */
  reset: () => void
  /** 打开面板期间的定时轮询开关 */
  startPolling: (intervalMs?: number) => void
  stopPolling: () => void
}

/** 默认轮询间隔；面板打开时保持余额新鲜 */
const DEFAULT_POLL_MS = 60_000
/** 失败后的静默期：短暂内不重复请求，避免断网时疯狂重试 */
const FAILURE_COOLDOWN_MS = 15_000

let pollingTimer: ReturnType<typeof setInterval> | null = null
/** 进行中的请求，用于合并并发刷新 */
let inflight: Promise<void> | null = null
/** 上次请求的 Key，供轮询复用 */
let currentKey: string | null = null
/** 上次失败时间，用于静默期判断 */
let lastFailureAt = 0

export const useBalance = create<BalanceState>((set, get) => ({
  status: 'idle',
  snapshot: null,
  failure: null,

  refresh: async (apiKey) => {
    const key = apiKey?.trim() ?? ''
    if (!key) {
      // 没有 Key 就没有可查的余额：回到 idle，并清掉旧账号残留
      currentKey = null
      set({ status: 'idle', snapshot: null, failure: null })
      return
    }
    currentKey = key

    if (inflight) {
      return inflight
    }
    // 失败静默期内，且已经有过失败记录时不重复请求
    const state = get()
    if (
      state.status === 'failed' &&
      Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS
    ) {
      return
    }

    set({ status: state.snapshot ? state.status : 'loading' })

    inflight = (async () => {
      try {
        const result = await fetchBalance(key)
        // 请求返回时若 Key 已被更换，丢弃这次结果
        if (currentKey !== key) {
          return
        }
        switch (result.status) {
          case 'ready':
            set({ status: 'ready', snapshot: result.snapshot, failure: null })
            return
          case 'unauthorized':
            // Key 被拒：清掉余额，避免继续显示别的账号或已失效的金额
            set({ status: 'unauthorized', snapshot: null, failure: null })
            return
          case 'failed':
            lastFailureAt = Date.now()
            set({ status: 'failed', failure: result })
            return
        }
      } catch {
        // 取消等异常不外抛，保持状态不变
      } finally {
        inflight = null
      }
    })()

    return inflight
  },

  reset: () => {
    currentKey = null
    lastFailureAt = 0
    set({ status: 'idle', snapshot: null, failure: null })
  },

  startPolling: (intervalMs = DEFAULT_POLL_MS) => {
    get().stopPolling()
    pollingTimer = setInterval(() => {
      if (currentKey) {
        void get().refresh(currentKey)
      }
    }, intervalMs)
  },

  stopPolling: () => {
    if (pollingTimer !== null) {
      clearInterval(pollingTimer)
      pollingTimer = null
    }
  },
}))

/** 便捷入口：用当前 Key 刷新余额（普通函数，可在事件里直接调用） */
export const refreshBalance = (apiKey: string | null) => useBalance.getState().refresh(apiKey)
