/**
 * 余额相关的界面状态与文案。
 *
 * 把"何时刷新、状态如何映射成文案"集中在这里，Sider / 设置 / 弹窗都复用同一套逻辑，
 * 避免各处对同一状态给出不一致的说法。
 */
import { useEffect } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import {
  preferredWallet,
  currencySymbol,
  formatAmount,
  type BalanceWallet,
} from '../../services/billing/balanceParse.js'
import { refreshBalance, useBalance } from '../../services/billing/balanceStore.js'

/** 把时间戳格式化为 HH:MM，用于"更新于" */
const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 徽标上的紧凑余额文本：有余额显示金额，其余状态显示"余额"占位 */
export const useBalanceBadgeText = (): { text: string; empty: boolean } => {
  const t = useTranslate()
  const status = useBalance((state) => state.status)
  const snapshot = useBalance((state) => state.snapshot)
  const wallet = snapshot ? preferredWallet(snapshot.wallets) : null

  if (wallet && (status === 'ready' || status === 'failed')) {
    return {
      text: `${currencySymbol(wallet.currency)}${formatAmount(wallet.total)}`,
      empty: false,
    }
  }
  // 没有可用金额时显示占位文案，绝不显示 0
  return { text: t('balance'), empty: true }
}

/**
 * 应用级余额生命周期：Key 变化时重新拉取，窗口重新获得焦点时刷新。
 * 挂在 App 上，保证任何界面（侧边栏/设置/聊天）看到的是同一份余额。
 */
export const useBalanceLifecycle = () => {
  const apiKey = useSettings((state) => state.apiKey)
  const reset = useBalance((state) => state.reset)

  // Key 变化：先清掉上一个 Key 的结果，再按新 Key 拉取
  useEffect(() => {
    reset()
    if (!apiKey) {
      return
    }
    void refreshBalance(apiKey)
  }, [apiKey, reset])

  useEffect(() => {
    if (!apiKey) {
      return
    }
    const onFocus = () => {
      void refreshBalance(apiKey)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [apiKey])
}

/** 面板打开期间轮询，关闭即停；同时立即刷新一次 */
export const useBalancePolling = (active: boolean) => {
  const apiKey = useSettings((state) => state.apiKey)
  const startPolling = useBalance((state) => state.startPolling)
  const stopPolling = useBalance((state) => state.stopPolling)

  useEffect(() => {
    if (!active) {
      return
    }
    if (apiKey) {
      void refreshBalance(apiKey)
      startPolling()
    }
    return () => stopPolling()
  }, [active, apiKey, startPolling, stopPolling])
}

/** 取当前设置里的 Key 手动刷新（供按钮使用） */
export const useRefreshBalance = (): (() => void) => {
  const apiKey = useSettings((state) => state.apiKey)
  return () => {
    void refreshBalance(apiKey)
  }
}

/** 失败原因 → 本地化文案 */
export const useBalanceFailureText = (): string => {
  const t = useTranslate()
  const status = useBalance((state) => state.status)
  const failure = useBalance((state) => state.failure)

  if (status === 'unauthorized') {
    return t('balanceApiKeyInvalid')
  }
  if (status !== 'failed' || !failure) {
    return t('balanceUnavailable')
  }
  switch (failure.kind) {
    case 'network':
      return t('balanceUnavailableNetwork')
    case 'timeout':
      return t('balanceUnavailableTimeout')
    case 'protocol':
      return t('balanceUnavailableProtocol')
    default:
      return t('balanceUnavailable')
  }
}

export type WalletRow = BalanceWallet & {
  /** 展示用金额 */
  totalText: string
  toppedUpText: string
  grantedText: string
  symbol: string
}

/** 面板中逐币种展示的行 */
export const useWalletRows = (): WalletRow[] => {
  const snapshot = useBalance((state) => state.snapshot)
  if (!snapshot) {
    return []
  }
  return snapshot.wallets.map((wallet) => ({
    ...wallet,
    totalText: formatAmount(wallet.total),
    toppedUpText: formatAmount(wallet.toppedUp),
    grantedText: formatAmount(wallet.granted),
    symbol: currencySymbol(wallet.currency),
  }))
}

/** 更新时间文案；没有快照时不展示 */
export const useBalanceUpdatedAt = (): string | null => {
  const t = useTranslate()
  const snapshot = useBalance((state) => state.snapshot)
  return snapshot ? t('balanceUpdatedAt', { time: formatTime(snapshot.fetchedAt) }) : null
}
