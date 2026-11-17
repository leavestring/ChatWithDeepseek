import { IconPanelLeftOutline16, NewChatIcon, IconWalletOutline16 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { openBalanceDialog } from '../billing/balanceDialogState.js'
import { useBalanceBadgeText } from '../billing/useBalance.js'
import styles from './Sider.module.css'

/** 收起后左上角的按钮组 */
export const CollapsedSider = () => {
  const t = useTranslate()
  const badge = useBalanceBadgeText()
  return (
    <div className={styles.collapsed}>
      <div className={styles.collapsedGroup}>
        <IconButton
          size="m"
          tone="primary"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('expandSiderbarButton')}
          onClick={() => setSiderCollapsed(false)}
        />
        <IconButton
          size="m"
          tone="primary"
          icon={<NewChatIcon />}
          tooltip={t('newChat')}
          onClick={newChat}
        />
        {/* 收起态也保留余额入口，悬停可看金额 */}
        <IconButton
          size="m"
          tone="primary"
          icon={<IconWalletOutline16 />}
          tooltip={badge.empty ? t('balance') : badge.text}
          onClick={openBalanceDialog}
        />
      </div>
    </div>
  )
}
