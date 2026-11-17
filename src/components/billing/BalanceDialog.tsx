/**
 * 余额面板：大字号总余额 + 充值/赠送拆分 + 官方平台入口。
 *
 * 关键约定（与 DSH 一致）：查询失败时保留上一次成功的金额并标注时间，
 * 绝不把"查不到"显示成"0 余额"。
 */
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { Modal } from '../base/Modal.js'
import { Button } from '../base/Button.js'
import { IconRefreshOutline16, IconWalletOutline16 } from '../base/icons.js'
import { useBalance } from '../../services/billing/balanceStore.js'
import { TopUpActions } from './Balance.js'
import { closeBalanceDialog, useBalanceDialog } from './balanceDialogState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import {
  useBalanceFailureText,
  useBalancePolling,
  useBalanceUpdatedAt,
  useRefreshBalance,
  useWalletRows,
} from './useBalance.js'
import styles from './BalanceDialog.module.css'

export const BalanceDialog = () => {
  const t = useTranslate()
  const open = useBalanceDialog((state) => state.open)
  const apiKey = useSettings((state) => state.apiKey)
  const status = useBalance((state) => state.status)
  const snapshot = useBalance((state) => state.snapshot)
  const rows = useWalletRows()
  const failureText = useBalanceFailureText()
  const updatedAt = useBalanceUpdatedAt()
  const refresh = useRefreshBalance()

  // 只在面板打开时轮询，关闭即停
  useBalancePolling(open)

  if (!open) {
    return null
  }

  const loading = status === 'loading'
  const hasWallets = rows.length > 0
  // 余额存在但不足以调用 API：这是需要用户立刻处理的信号
  const insufficient = snapshot?.isAvailable === false

  return (
    <Modal
      title={t('balanceTitle')}
      closable
      onClose={closeBalanceDialog}
      footer={
        apiKey ? (
          <div className={styles.refreshRow}>
            <button
              type="button"
              className={styles.refresh}
              disabled={loading}
              onClick={refresh}
              aria-label={t('balanceRefresh')}
            >
              <IconRefreshOutline16 />
              {t('balanceRefresh')}
            </button>
          </div>
        ) : (
          <div className={styles.refreshRow}>
            <button
              type="button"
              className={styles.refresh}
              onClick={() => {
                closeBalanceDialog()
                openSettings('data')
              }}
            >
              <IconWalletOutline16 />
              {t('apiKeyStart')}
            </button>
          </div>
        )
      }
    >
      <div className={styles.body}>
        {!apiKey ? (
          <div className={styles.empty}>{t('balanceNoKey')}</div>
        ) : !hasWallets ? (
          <div className={styles.empty}>
            {loading ? t('balanceLoading') : status === 'idle' ? t('balanceNoKey') : failureText}
          </div>
        ) : (
          <>
            {rows.map((row) => (
              <div key={row.currency} className={styles.card}>
                <div className={styles.cardHead}>
                  <span className={styles.currency}>{row.currency}</span>
                  <span className={styles.totalLabel}>{t('balanceTotal')}</span>
                </div>
                <div className={styles.totalAmount}>
                  <span className={styles.symbol}>{row.symbol}</span>
                  {row.totalText}
                </div>
                <div className={styles.breakdown}>
                  <div className={styles.breakdownItem}>
                    <span className={styles.breakdownLabel}>{t('balanceToppedUp')}</span>
                    <span className={styles.breakdownValue}>
                      {row.symbol}
                      {row.toppedUpText}
                    </span>
                  </div>
                  <div className={styles.breakdownItem}>
                    <span className={styles.breakdownLabel}>{t('balanceGranted')}</span>
                    <span className={styles.breakdownValue}>
                      {row.symbol}
                      {row.grantedText}
                    </span>
                  </div>
                </div>
              </div>
            ))}

            {insufficient ? (
              <div className={styles.warning} role="status">
                {t('balanceInsufficientHint')}
              </div>
            ) : null}

            {/* 失败但仍有旧快照：说明数据可能不是最新 */}
            {status === 'failed' ? <div className={styles.stale}>{failureText}</div> : null}
            {updatedAt ? <div className={styles.updatedAt}>{updatedAt}</div> : null}
          </>
        )}

        {status === 'unauthorized' ? (
          <div className={styles.unauthorized}>
            <span>{t('balanceApiKeyInvalid')}</span>
            <Button
              variant="outlined"
              size="s"
              onClick={() => {
                closeBalanceDialog()
                openSettings('data')
              }}
            >
              {t('changeApiKey')}
            </Button>
          </div>
        ) : null}

        <TopUpActions />
      </div>
    </Modal>
  )
}
