import { ApiError } from './client.js'
import { readServerSentEvents } from './sse.js'
import type { MessageStreamEvent, MessageUsage, StopReason } from './types.js'
import {
  extractOpenAICompatibleReasoning,
  extractOpenAICompatibleText,
  normalizeOpenAIBaseUrl,
  parseOpenAICompatibleModelIds,
  parseOpenAICompatibleUsage,
  readOpenAICompatibleErrorMessage,
  type OpenAICompatibleUsage,
} from './openaiCompatibleParse.js'

export type OpenAICompatibleChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type OpenAICompatibleConnection = {
  baseUrl: string
  apiKey: string
}

export type OpenAICompatibleStreamOptions = OpenAICompatibleConnection & {
  model: string
  messages: OpenAICompatibleChatMessage[]
  signal: AbortSignal
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const endpoint = (baseUrl: string, path: string) =>
  `${normalizeOpenAIBaseUrl(baseUrl)}/${path.replace(/^\/+/, '')}`

const headers = (apiKey: string, stream: boolean): Record<string, string> => ({
  ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
  ...(stream
    ? { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
    : { Accept: 'application/json' }),
})

const redact = (message: string, apiKey: string) => {
  const key = apiKey.trim()
  return key ? message.split(key).join('***') : message
}

const readResponseError = async (
  response: Response,
  apiKey: string,
  kind: 'http' | 'protocol' = 'http'
): Promise<ApiError> => {
  const raw = await response.text().catch(() => '')
  let message = raw.trim()
  try {
    const payload: unknown = JSON.parse(raw)
    message = readOpenAICompatibleErrorMessage(payload) || message
  } catch {
    // 非 JSON 错误体保留清洗后的原文。
  }
  message = redact(
    message
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    apiKey
  ).slice(0, 500)
  return new ApiError(kind, message || response.statusText, response.status)
}

const fetchFromProvider = async (
  url: string,
  init: RequestInit,
  signal: AbortSignal
): Promise<Response> => {
  try {
    return await fetch(url, { ...init, signal })
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    throw new ApiError('network', { key: 'openAICompatibleNetworkError' })
  }
}

/**
 * 读取 OpenAI 兼容服务的模型目录。部分服务不提供 `/models`，
 * 调用方应允许用户手动填写模型 ID。
 */
export const fetchOpenAICompatibleModels = async (
  connection: OpenAICompatibleConnection,
  signal?: AbortSignal
): Promise<string[]> => {
  const response = await fetchFromProvider(
    endpoint(connection.baseUrl, 'models'),
    {
      method: 'GET',
      headers: headers(connection.apiKey, false),
    },
    signal ?? new AbortController().signal
  )
  if (!response.ok) {
    throw await readResponseError(response, connection.apiKey)
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError('protocol', 'models response is not valid JSON', response.status)
  }
  return parseOpenAICompatibleModelIds(payload)
}

const toMessageUsage = (
  usage: OpenAICompatibleUsage,
  hasUsage: boolean
): MessageUsage | undefined =>
  hasUsage
    ? {
        input_tokens: usage.promptTokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: usage.cachedTokens,
        output_tokens: usage.completionTokens,
      }
    : undefined

const mapFinishReason = (value: unknown): StopReason =>
  value === 'length' ? 'max_tokens' : value === 'content_filter' ? 'refusal' : 'end_turn'

type StreamState = {
  active: 'thinking' | 'text' | null
  activeIndex: number
  nextIndex: number
  finishReason: unknown
  hasUsage: boolean
  usage: OpenAICompatibleUsage
  receivedContent: boolean
}

const closeActive = (state: StreamState): MessageStreamEvent[] => {
  if (state.active === null) {
    return []
  }
  const event: MessageStreamEvent = {
    type: 'content_block_stop',
    index: state.activeIndex,
  }
  state.active = null
  state.activeIndex = -1
  return [event]
}

const openBlock = (
  state: StreamState,
  kind: 'thinking' | 'text'
): MessageStreamEvent[] => {
  if (state.active === kind) {
    return []
  }
  const events = closeActive(state)
  const index = state.nextIndex++
  state.active = kind
  state.activeIndex = index
  events.push({
    type: 'content_block_start',
    index,
    content_block:
      kind === 'thinking'
        ? { type: 'thinking', thinking: '', signature: '' }
        : { type: 'text', text: '' },
  })
  return events
}

const finishStream = (state: StreamState): MessageStreamEvent[] => {
  const events = closeActive(state)
  events.push({
    type: 'message_delta',
    delta: {
      stop_reason: mapFinishReason(state.finishReason),
      stop_sequence: null,
    },
    usage: toMessageUsage(state.usage, state.hasUsage),
  })
  events.push({ type: 'message_stop' })
  return events
}

const readDeltaEvents = (
  state: StreamState,
  delta: Record<string, unknown>
): MessageStreamEvent[] => {
  const events: MessageStreamEvent[] = []
  const reasoning = extractOpenAICompatibleReasoning(delta)
  if (reasoning) {
    state.receivedContent = true
    events.push(...openBlock(state, 'thinking'))
    events.push({
      type: 'content_block_delta',
      index: state.activeIndex,
      delta: { type: 'thinking_delta', thinking: reasoning },
    })
  }
  const text = extractOpenAICompatibleText(delta.content)
  if (text) {
    state.receivedContent = true
    events.push(...openBlock(state, 'text'))
    events.push({
      type: 'content_block_delta',
      index: state.activeIndex,
      delta: { type: 'text_delta', text },
    })
  }
  return events
}

const readCompletionPayload = (
  state: StreamState,
  payload: unknown
): MessageStreamEvent[] => {
  if (!isRecord(payload)) {
    return []
  }
  if (payload.error) {
    throw new ApiError(
      'stream',
      readOpenAICompatibleErrorMessage(payload) || 'The provider returned an error.'
    )
  }
  if (isRecord(payload.usage)) {
    state.hasUsage = true
    state.usage = parseOpenAICompatibleUsage(payload.usage)
  }
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined
  if (!isRecord(choice)) {
    return []
  }
  if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
    state.finishReason = choice.finish_reason
  }
  const delta = isRecord(choice.delta) ? choice.delta : choice.message
  if (isRecord(delta)) {
    return readDeltaEvents(state, delta)
  }
  const legacyText = extractOpenAICompatibleText(choice.text)
  return legacyText
    ? readDeltaEvents(state, { content: legacyText })
    : []
}

const messageStart = (model: string): MessageStreamEvent => ({
  type: 'message_start',
  message: { id: 'openai-compatible', model },
})

/**
 * POST /chat/completions（stream: true），将 OpenAI 兼容的流式响应
 * 映射为应用内部统一的 MessageStreamEvent。
 */
export async function* streamOpenAICompatible(
  options: OpenAICompatibleStreamOptions
): AsyncGenerator<MessageStreamEvent> {
  const body = {
    model: options.model,
    messages: options.messages,
    stream: true,
    stream_options: { include_usage: true },
  }
  const url = endpoint(options.baseUrl, 'chat/completions')
  let response = await fetchFromProvider(
    url,
    {
      method: 'POST',
      headers: headers(options.apiKey, true),
      body: JSON.stringify(body),
    },
    options.signal
  )

  if (!response.ok) {
    const firstError = await readResponseError(response, options.apiKey)
    const retryWithoutOptions =
      response.status === 400 &&
      /stream_options|stream options|include_usage|unknown (?:field|parameter)|extra (?:field|input)|unrecognized|unsupported/i.test(
        firstError.message
      )
    if (!retryWithoutOptions) {
      throw firstError
    }
    response = await fetchFromProvider(
      url,
      {
        method: 'POST',
        headers: headers(options.apiKey, true),
        body: JSON.stringify({
          model: options.model,
          messages: options.messages,
          stream: true,
        }),
      },
      options.signal
    )
    if (!response.ok) {
      throw await readResponseError(response, options.apiKey)
    }
  }

  if (!response.body) {
    throw new ApiError('protocol', 'The provider returned an empty response body.')
  }

  const state: StreamState = {
    active: null,
    activeIndex: -1,
    nextIndex: 0,
    finishReason: null,
    hasUsage: false,
    usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0 },
    receivedContent: false,
  }
  const contentType = response.headers.get('Content-Type') ?? ''
  yield messageStart(options.model)

  if (contentType.includes('application/json')) {
    const payload: unknown = await response.json().catch(() => null)
    const events = readCompletionPayload(state, payload)
    for (const event of events) {
      yield event
    }
    if (!state.receivedContent && state.finishReason === null) {
      throw new ApiError('protocol', 'The provider returned no completion choices.')
    }
    for (const event of finishStream(state)) {
      yield event
    }
    return
  }

  let done = false
  try {
    for await (const { data } of readServerSentEvents(response.body, options.signal)) {
      if (data.trim() === '[DONE]') {
        done = true
        break
      }
      let payload: unknown
      try {
        payload = JSON.parse(data)
      } catch {
        continue
      }
      const events = readCompletionPayload(state, payload)
      for (const event of events) {
        yield event
      }
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    if (options.signal.aborted) {
      throw error
    }
    throw new ApiError(
      'interrupted',
      error instanceof Error ? error.message : 'The stream ended unexpectedly.'
    )
  }

  if (!done && !state.receivedContent && state.finishReason === null) {
    throw new ApiError('interrupted', 'The stream ended before any content was received.')
  }
  for (const event of finishStream(state)) {
    yield event
  }
}
