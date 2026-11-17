/** 余额与充值的统一入口：侧边栏徽标、设置页、聊天里的"前往充值"都用这两个组件。 */
import type { ReactNode } from 'react'
import { IconRightUpOutline14, IconWalletOutline16 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { API_KEYS_URL, TOP_UP_URL, USAGE_URL } from '../../services/billing/balance.js'
import styles from './Balance.module.css'

/** 跳转 DeepSeek 官方平台的外链；目标一律在新标签/系统浏览器打开 */
const ExternalLink = ({
  href,
  children,
  primary = false,
}: {
  href: string
  children: ReactNode
  primary?: boolean
}) => (
  <a
    className={primary ? styles.primaryLink : styles.link}
    href={href}
    target="_blank"
    rel="noreferrer"
  >
    {children}
    <IconRightUpOutline14 />
  </a>
)

/** 充值 + 用量 + Key 管理，供余额面板与聊天错误提示复用 */
export const TopUpActions = ({ compact = false }: { compact?: boolean }) => {
  const t = useTranslate()
  return (
    <div className={compact ? styles.actionsCompact : styles.actions}>
      <ExternalLink href={TOP_UP_URL} primary>
        {t('topUp')}
      </ExternalLink>
      {compact ? null : (
        <>
          <ExternalLink href={USAGE_URL}>{t('balanceViewUsage')}</ExternalLink>
          <ExternalLink href={API_KEYS_URL}>{t('balanceManageKeys')}</ExternalLink>
        </>
      )}
    </div>
  )
}

/** 侧边栏里的余额徽标按钮 */
export const BalanceBadge = ({
  text,
  empty,
  onClick,
}: {
  text: string
  empty: boolean
  onClick: () => void
}) => (
  <button
    type="button"
    className={empty ? styles.badgeEmpty : styles.badge}
    onClick={onClick}
    aria-haspopup="dialog"
  >
    <span className={styles.badgeIcon}>
      <IconWalletOutline16 />
    </span>
    <span className={styles.badgeText}>{text}</span>
  </button>
)
