/**
 * OpenAI 兼容协议的纯解析逻辑。
 *
 * 这里不导入任何浏览器 API 或应用状态，便于 node --test 直接验证。
 */

export type OpenAICompatibleUsage = {
  promptTokens: number
  completionTokens: number
  cachedTokens: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readNonNegativeNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0

const readModelId = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const id = value.trim()
    return id || null
  }
  if (isRecord(value) && typeof value.id === 'string') {
    const id = value.id.trim()
    return id || null
  }
  return null
}

/**
 * 规范化用户填写的 Base URL：只接受 HTTP(S)，去掉尾部斜杠，
 * 并兼容用户误把 `/models` 或 `/chat/completions` 贴进来的情况。
 */
export const normalizeOpenAIBaseUrl = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('empty')
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('invalid')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('protocol')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('invalid')
  }
  const pathname = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/(?:chat\/completions|models)$/i, '')
  return `${url.origin}${pathname}`
}

/** 读取 GET /models 的常见响应形状，去重并稳定排序。 */
export const parseOpenAICompatibleModelIds = (payload: unknown): string[] => {
  const values = Array.isArray(payload)
    ? payload
    : isRecord(payload)
      ? Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(payload.models)
          ? payload.models
          : []
      : []
  const ids = values.flatMap((value) => {
    const id = readModelId(value)
    return id ? [id] : []
  })
  return [...new Set(ids)].sort((left, right) =>
    left.localeCompare(right, 'en', { sensitivity: 'base' })
  )
}

/** 兼容字符串、内容片段数组，以及少数服务商返回的对象形状。 */
export const extractOpenAICompatibleText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }
        if (!isRecord(part)) {
          return ''
        }
        return extractOpenAICompatibleText(part.text) || extractOpenAICompatibleText(part.content)
      })
      .join('')
  }
  if (isRecord(value)) {
    return extractOpenAICompatibleText(value.text) || extractOpenAICompatibleText(value.content)
  }
  return ''
}

/** OpenAI、DeepSeek、OpenRouter 等兼容服务常见的思考字段。 */
export const extractOpenAICompatibleReasoning = (value: Record<string, unknown>): string => {
  const direct =
    extractOpenAICompatibleText(value.reasoning_content) ||
    extractOpenAICompatibleText(value.thinking) ||
    extractOpenAICompatibleText(value.reasoning)
  if (direct) {
    return direct
  }
  if (!Array.isArray(value.reasoning_details)) {
    return ''
  }
  return value.reasoning_details
    .map((item) => {
      if (!isRecord(item)) {
        return ''
      }
      return extractOpenAICompatibleText(item.text) || extractOpenAICompatibleText(item.summary)
    })
    .join('')
}

export const parseOpenAICompatibleUsage = (payload: unknown): OpenAICompatibleUsage => {
  if (!isRecord(payload)) {
    return { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }
  }
  const details = isRecord(payload.prompt_tokens_details)
    ? payload.prompt_tokens_details
    : undefined
  return {
    promptTokens: readNonNegativeNumber(payload.prompt_tokens),
    completionTokens: readNonNegativeNumber(payload.completion_tokens),
    cachedTokens: readNonNegativeNumber(details?.cached_tokens),
  }
}

/** 从错误响应中取出服务商提供的可读信息，读不到时返回空串。 */
export const readOpenAICompatibleErrorMessage = (payload: unknown): string => {
  if (!isRecord(payload)) {
    return ''
  }
  if (isRecord(payload.error)) {
    const message = payload.error.message
    if (typeof message === 'string') {
      return message
    }
  }
  return typeof payload.message === 'string' ? payload.message : ''
}
