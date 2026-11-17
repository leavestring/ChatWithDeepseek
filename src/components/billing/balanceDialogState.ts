import { create } from 'zustand'

/** 余额面板的开合状态；侧边栏徽标、移动端顶栏都可以打开它 */
export const useBalanceDialog = create(() => ({ open: false }))

export const openBalanceDialog = () => useBalanceDialog.setState({ open: true })

export const closeBalanceDialog = () => useBalanceDialog.setState({ open: false })
