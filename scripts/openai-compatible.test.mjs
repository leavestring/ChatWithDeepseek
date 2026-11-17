import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extractOpenAICompatibleReasoning,
  extractOpenAICompatibleText,
  normalizeOpenAIBaseUrl,
  parseOpenAICompatibleModelIds,
  parseOpenAICompatibleUsage,
  readOpenAICompatibleErrorMessage,
} from '../src/services/api/openaiCompatibleParse.ts'

test('规范化兼容接口 Base URL', () => {
  assert.equal(normalizeOpenAIBaseUrl('https://api.example.com/v1/'), 'https://api.example.com/v1')
  assert.equal(
    normalizeOpenAIBaseUrl('https://api.example.com/v1/chat/completions'),
    'https://api.example.com/v1'
  )
  assert.equal(normalizeOpenAIBaseUrl('http://localhost:11434/v1/models'), 'http://localhost:11434/v1')
  assert.throws(() => normalizeOpenAIBaseUrl(''))
  assert.throws(() => normalizeOpenAIBaseUrl('api.example.com/v1'))
  assert.throws(() => normalizeOpenAIBaseUrl('ftp://api.example.com/v1'))
  assert.throws(() => normalizeOpenAIBaseUrl('https://api.example.com/v1?token=secret'))
})

test('兼容模型目录的常见响应形状', () => {
  assert.deepEqual(
    parseOpenAICompatibleModelIds({
      data: [{ id: 'qwen-max' }, { id: 'gpt-4.1' }, { id: 'qwen-max' }, { object: 'model' }],
    }),
    ['gpt-4.1', 'qwen-max']
  )
  assert.deepEqual(parseOpenAICompatibleModelIds(['beta', { id: 'alpha' }, 'alpha']), [
    'alpha',
    'beta',
  ])
  assert.deepEqual(parseOpenAICompatibleModelIds({ models: [{ id: ' local ' }] }), ['local'])
  assert.deepEqual(parseOpenAICompatibleModelIds({ data: 'invalid' }), [])
})

test('提取字符串和内容片段正文', () => {
  assert.equal(extractOpenAICompatibleText('hello'), 'hello')
  assert.equal(
    extractOpenAICompatibleText([
      { type: 'text', text: 'hello ' },
      { type: 'output_text', text: 'world' },
      '!',
    ]),
    'hello world!'
  )
  assert.equal(extractOpenAICompatibleText({ content: [{ text: 'nested' }] }), 'nested')
})

test('提取多家兼容服务的思考字段', () => {
  assert.equal(extractOpenAICompatibleReasoning({ reasoning_content: 'think' }), 'think')
  assert.equal(extractOpenAICompatibleReasoning({ thinking: 'think' }), 'think')
  assert.equal(
    extractOpenAICompatibleReasoning({
      reasoning_details: [{ summary: 'step one ' }, { text: 'step two' }],
    }),
    'step one step two'
  )
})

test('读取 token 用量与错误文案', () => {
  assert.deepEqual(
    parseOpenAICompatibleUsage({
      prompt_tokens: 12,
      completion_tokens: 34,
      prompt_tokens_details: { cached_tokens: 5 },
    }),
    { promptTokens: 12, completionTokens: 34, cachedTokens: 5 }
  )
  assert.deepEqual(parseOpenAICompatibleUsage(null), {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
  })
  assert.equal(
    readOpenAICompatibleErrorMessage({ error: { message: 'invalid key' } }),
    'invalid key'
  )
  assert.equal(readOpenAICompatibleErrorMessage({ message: 'limited' }), 'limited')
  assert.equal(readOpenAICompatibleErrorMessage({ error: null }), '')
})
