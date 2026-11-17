/**
 * 余额解析与状态的单测。
 *
 * 直接 import 真实的 .ts 源码 —— Node 24 自带类型擦除，因此不需要额外的测试框架或编译步骤。
 * 用 `npm test` 运行。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseBalance, preferredWallet, formatAmount, currencySymbol, isDecimalString } from '../src/services/billing/balanceParse.ts'

const sample = (overrides = {}) => ({
  is_available: true,
  balance_infos: [
    {
      currency: 'CNY',
      total_balance: '110.00',
      granted_balance: '10.00',
      topped_up_balance: '100.00',
    },
  ],
  ...overrides,
})

test('解析正常的多币种余额响应', () => {
  const snapshot = parseBalance(
    {
      is_available: true,
      balance_infos: [
        { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
        { currency: 'USD', total_balance: '5.50', granted_balance: '0.50', topped_up_balance: '5.00' },
      ],
    },
    1700000000000
  )

  assert.equal(snapshot.isAvailable, true)
  assert.equal(snapshot.wallets.length, 2)
  assert.deepEqual(snapshot.wallets[0], {
    currency: 'CNY',
    total: '110.00',
    granted: '10.00',
    toppedUp: '100.00',
  })
  assert.equal(snapshot.wallets[1].currency, 'USD')
  assert.equal(snapshot.fetchedAt, 1700000000000)
})

test('金额字符串原样保留，不做浮点归一化', () => {
  const snapshot = parseBalance({
    is_available: true,
    balance_infos: [
      {
        currency: 'CNY',
        total_balance: '5.0000000000000000',
        granted_balance: '0E-16',
        topped_up_balance: '5.0000000000000000',
      },
    ],
  })
  assert.equal(snapshot.wallets[0].total, '5.0000000000000000')
  assert.equal(snapshot.wallets[0].granted, '0E-16')
  assert.equal(snapshot.wallets[0].toppedUp, '5.0000000000000000')
})

test('缺少赠送余额字段时补空串，而不是当作 0', () => {
  const snapshot = parseBalance({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: '12.00', topped_up_balance: '12.00' }],
  })
  assert.equal(snapshot.wallets[0].granted, '')
  assert.equal(snapshot.wallets[0].total, '12.00')
})

test('空钱包列表是合法结果（不是解析失败）', () => {
  const snapshot = parseBalance({ is_available: false, balance_infos: [] })
  assert.deepEqual(snapshot.wallets, [])
  assert.equal(snapshot.isAvailable, false)
})

test('is_available 缺失时记为未知（null），不臆断为 false', () => {
  const snapshot = parseBalance({ balance_infos: [] })
  assert.equal(snapshot.isAvailable, null)
})

test('结构不符协议时返回 null，绝不退化成零余额', () => {
  assert.equal(parseBalance(null), null)
  assert.equal(parseBalance('oops'), null)
  assert.equal(parseBalance({}), null)
  assert.equal(parseBalance({ balance_infos: 'nope' }), null)
  assert.equal(parseBalance({ balance_infos: [null] }), null)
  // 金额非法：整条记录作废，避免显示半真半假的数据
  assert.equal(
    parseBalance({
      balance_infos: [{ currency: 'CNY', total_balance: 'NaN', granted_balance: '0', topped_up_balance: '0' }],
    }),
    null
  )
  // 缺币种
  assert.equal(
    parseBalance({
      balance_infos: [{ total_balance: '1.00', granted_balance: '0', topped_up_balance: '1.00' }],
    }),
    null
  )
})

test('十进制文法与 big.js 保持一致', () => {
  for (const value of ['0', '0.00', '5.', '.5', '0E-16', '+3.14', '-1.5', '1e10']) {
    assert.equal(isDecimalString(value), true, `${value} 应被接受`)
  }
  for (const value of ['', 'NaN', 'Infinity', '-Infinity', 'abc', '1,000', null, undefined, 5]) {
    assert.equal(isDecimalString(value), false, `${String(value)} 应被拒绝`)
  }
})

test('优先展示人民币，其次美元，再退回第一个', () => {
  const usd = { currency: 'USD', total: '1', granted: '0', toppedUp: '1' }
  const cny = { currency: 'CNY', total: '2', granted: '0', toppedUp: '2' }
  const eur = { currency: 'EUR', total: '3', granted: '0', toppedUp: '3' }

  assert.equal(preferredWallet([usd, cny, eur]).currency, 'CNY')
  assert.equal(preferredWallet([usd, eur]).currency, 'USD')
  assert.equal(preferredWallet([eur]).currency, 'EUR')
  assert.equal(preferredWallet([]), null)
})

test('展示金额保留两位小数；空值显示占位', () => {
  assert.equal(formatAmount('110.00'), '110.00')
  assert.equal(formatAmount('5'), '5.00')
  assert.equal(formatAmount('0E-16'), '0.00')
  assert.equal(formatAmount(''), '--')
})

test('币种符号：已知币种给符号，未知币种回退为代码', () => {
  assert.equal(currencySymbol('CNY'), '¥')
  assert.equal(currencySymbol('usd'), '$')
  assert.equal(currencySymbol('XYZ'), 'XYZ ')
})

test('样例响应可被解析（防止字段名写错）', () => {
  const snapshot = parseBalance(sample())
  assert.equal(snapshot.wallets[0].toppedUp, '100.00')
})
