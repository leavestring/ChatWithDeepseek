import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconEllipsisOutline16,
  IconMenuOutline20,
  IconPanelLeftOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  IconWalletOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { BalanceBadge } from '../billing/Balance.js'
import { openBalanceDialog } from '../billing/balanceDialogState.js'
import { useBalanceBadgeText } from '../billing/useBalance.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import logoUrl from '../../assets/brand/logo-mark-brandblue.png'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [query, setQuery] = useState('')
  const badge = useBalanceBadgeText()
  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) {
      return groups
    }
    return groups
      .map((group) => ({
        ...group,
        sessions: group.sessions.filter((session) =>
          session.title.toLocaleLowerCase().includes(needle)
        ),
      }))
      .filter((group) => group.sessions.length > 0)
  }, [groups, query])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      {mobile ? (
        <label className={styles.search}>
          <IconSearchOutline16 />
          <input
            type="search"
            value={query}
            aria-label={t('sessionSearchPlaceholder')}
            placeholder={t('sessionSearchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      ) : (
        <div className={styles.top}>
          <div className={styles.brand}>
            <img className={styles.brandMark} src={logoUrl} alt="" />
            <div className={styles.appName}>{t('appName')}</div>
          </div>
          <IconButton
            size="m"
            icon={<IconPanelLeftOutline16 />}
            tooltip={t('collapseSiderbarButton')}
            tooltipPlacement="bottom"
            onClick={() => setSiderCollapsed(true)}
          />
        </div>
      )}
      {mobile ? null : (
        <button
          type="button"
          className={styles.newChat}
          onClick={() => {
            newChat()
            closeMobileSider()
          }}
        >
          <span className={styles.newChatIcon}>
            <NewChatIcon />
          </span>
          {t('newChat')}
        </button>
      )}
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {filteredGroups.map((group) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}>{group.label}</div>
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={session.id === activeId}
                  onDelete={() => setDeleting(session)}
                />
              ))}
            </div>
          ))}
          {mobile && query.trim() && filteredGroups.length === 0 ? (
            <div className={styles.searchEmpty}>{t('sessionSearchNoResults')}</div>
          ) : null}
        </div>
      </div>
      <div className={styles.bottom}>
        {mobile ? (
          <div className={styles.accountRow}>
            <span className={styles.accountAvatar}>
              <img src={logoUrl} alt="" />
            </span>
            <span className={styles.accountName}>{t('appName')}</span>
            <Menu
              options={[
                {
                  key: 'balance',
                  label: t('balanceAndTopUp'),
                  icon: <IconWalletOutline16 />,
                  onSelect: () => {
                    closeMobileSider()
                    openBalanceDialog()
                  },
                },
                {
                  key: 'settings',
                  label: t('settings'),
                  icon: <IconSettingsOutline16 />,
                  onSelect: () => {
                    closeMobileSider()
                    openSettings('general')
                  },
                },
              ]}
            >
              {({ toggle }) => (
                <IconButton
                  tone="primary"
                  icon={<IconEllipsisOutline16 />}
                  aria-label={t('more')}
                  onClick={toggle}
                />
              )}
            </Menu>
          </div>
        ) : (
          <>
            {/* 余额常驻入口：点击打开余额面板，其中可跳转官方充值页 */}
            <BalanceBadge
              text={badge.text}
              empty={badge.empty}
              onClick={() => openBalanceDialog()}
            />
            <button
              type="button"
              className={styles.settings}
              onClick={() => openSettings('general')}
            >
              <span className={styles.settingsIcon}>
                <IconSettingsOutline16 />
              </span>
              <span className={styles.settingsLabel}>{t('settings')}</span>
            </button>
          </>
        )}
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const t = useTranslate()
  const open = useMobileSider((state) => state.open)

  useEffect(() => {
    if (!open) {
      return
    }
    document.body.dataset.mobileSiderOpen = 'true'
    return () => {
      delete document.body.dataset.mobileSiderOpen
    }
  }, [open])

  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile />
      </div>
      <button
        type="button"
        className={styles.drawerClose}
        aria-label={t('close')}
        onClick={closeMobileSider}
      >
        <IconMenuOutline20 />
      </button>
    </>
  )
}
