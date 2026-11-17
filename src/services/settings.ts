import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 新消息使用的模型来源；DeepSeek 官方能力与 OpenAI 兼容接口分别走不同协议。 */
export type ModelSource = 'deepseek' | 'openai-compatible'

export type OpenAICompatibleConfig = {
  baseUrl: string
  apiKey: string
  models: string[]
  model: string
}

/** 本机设置，存 localStorage：两套 API 配置、语言、主题、位置、思考开关与侧边栏状态 */
type Settings = {
  apiKey: string | null
  modelSource: ModelSource
  openAIBaseUrl: string
  openAIApiKey: string | null
  openAIModels: string[]
  openAIModel: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  modelSource: 'chat-demo:model-source',
  openAIBaseUrl: 'chat-demo:openai-base-url',
  openAIApiKey: 'chat-demo:openai-api-key',
  openAIModels: 'chat-demo:openai-models',
  openAIModel: 'chat-demo:openai-model',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

const initialModelSource = (): ModelSource =>
  read(KEYS.modelSource) === 'openai-compatible' ? 'openai-compatible' : 'deepseek'

const initialOpenAIModels = (): string[] => {
  try {
    const value: unknown = JSON.parse(read(KEYS.openAIModels) ?? '[]')
    return Array.isArray(value)
      ? [
          ...new Set(
            value.flatMap((item) => {
              const id = typeof item === 'string' ? item.trim() : ''
              return id ? [id] : []
            })
          ),
        ]
      : []
  } catch {
    return []
  }
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  modelSource: initialModelSource(),
  openAIBaseUrl: read(KEYS.openAIBaseUrl) ?? '',
  openAIApiKey: read(KEYS.openAIApiKey),
  openAIModels: initialOpenAIModels(),
  openAIModel: read(KEYS.openAIModel),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setModelSource = (modelSource: ModelSource) => {
  write(KEYS.modelSource, modelSource)
  useSettings.setState({ modelSource })
}

export const setOpenAICompatibleConfig = (config: OpenAICompatibleConfig) => {
  const models = [...new Set(config.models.map((model) => model.trim()).filter(Boolean))]
  const model = config.model.trim()
  const nextModels = model && !models.includes(model) ? [...models, model] : models
  write(KEYS.openAIBaseUrl, config.baseUrl.trim())
  write(KEYS.openAIApiKey, config.apiKey.trim())
  write(KEYS.openAIModels, JSON.stringify(nextModels))
  write(KEYS.openAIModel, model)
  useSettings.setState({
    openAIBaseUrl: config.baseUrl.trim(),
    openAIApiKey: config.apiKey.trim(),
    openAIModels: nextModels,
    openAIModel: model,
  })
}

export const setOpenAICompatibleModel = (openAIModel: string | null) => {
  write(KEYS.openAIModel, openAIModel)
  useSettings.setState({ openAIModel })
}

export const clearOpenAICompatibleConfig = () => {
  for (const key of [
    KEYS.openAIBaseUrl,
    KEYS.openAIApiKey,
    KEYS.openAIModels,
    KEYS.openAIModel,
  ]) {
    write(key, null)
  }
  useSettings.setState({
    openAIBaseUrl: '',
    openAIApiKey: null,
    openAIModels: [],
    openAIModel: null,
  })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

/** 当前模型是否已有发起对话所需的配置。 */
export const hasActiveModelConfig = (): boolean => {
  const settings = useSettings.getState()
  return settings.modelSource === 'deepseek'
    ? Boolean(settings.apiKey)
    : Boolean(settings.openAIBaseUrl.trim() && settings.openAIModel?.trim())
}

