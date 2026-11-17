import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import {
  IconCheckOutline16,
  IconCloseFill14,
  IconModelOutline16,
} from '../base/icons.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import { ApiError } from '../../services/api/client.js'
import { fetchOpenAICompatibleModels } from '../../services/api/openaiCompatible.js'
import { normalizeOpenAIBaseUrl } from '../../services/api/openaiCompatibleParse.js'
import {
  clearOpenAICompatibleConfig,
  setModelSource,
  setOpenAICompatibleConfig,
  useSettings,
} from '../../services/settings.js'
import styles from './ModelSettings.module.css'

type Status = { type: 'ok' | 'error'; text: string } | null

const sortModels = (models: string[]) =>
  [...new Set(models.map((model) => model.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, 'en', { sensitivity: 'base' })
  )

const describeError = (error: unknown, t: ReturnType<typeof useTranslate>) =>
  error instanceof ApiError && error.localMessage
    ? t(error.localMessage.key, error.localMessage.params)
    : error instanceof Error
      ? error.message
      : String(error)

/** DeepSeek 官方与任意 OpenAI 兼容接口的切换和配置。 */
export const ModelSettings = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const modelSource = useSettings((state) => state.modelSource)
  const storedBaseUrl = useSettings((state) => state.openAIBaseUrl)
  const storedApiKey = useSettings((state) => state.openAIApiKey)
  const storedModels = useSettings((state) => state.openAIModels)
  const storedModel = useSettings((state) => state.openAIModel)
  const [baseUrl, setBaseUrl] = useState(storedBaseUrl)
  const [apiKey, setApiKey] = useState(storedApiKey ?? '')
  const [models, setModels] = useState(storedModels)
  const [selectedModel, setSelectedModel] = useState(storedModel ?? '')
  const [query, setQuery] = useState('')
  const [manualModel, setManualModel] = useState('')
  const [fetching, setFetching] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const requestRef = useRef<AbortController | null>(null)
  const baseUrlRef = useRef<HTMLInputElement>(null)

  useEffect(
    () => () => {
      requestRef.current?.abort()
    },
    []
  )

  const configured = Boolean(storedBaseUrl.trim() && storedModel?.trim())
  const filteredModels = query.trim()
    ? models.filter((model) => model.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    : models

  const testConnection = async () => {
    let normalized: string
    try {
      normalized = normalizeOpenAIBaseUrl(baseUrl)
    } catch {
      setStatus({ type: 'error', text: t('settingsModelInvalidUrl') })
      return
    }
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setFetching(true)
    setStatus(null)
    try {
      const fetched = await fetchOpenAICompatibleModels(
        { baseUrl: normalized, apiKey },
        controller.signal
      )
      const nextModels = sortModels([...models, ...fetched])
      setBaseUrl(normalized)
      setModels(nextModels)
      setSelectedModel((current) => current || nextModels[0] || '')
      setStatus({
        type: 'ok',
        text: fetched.length
          ? t('settingsModelFetched', { count: fetched.length })
          : t('settingsModelFetchedEmpty'),
      })
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }
      setStatus({
        type: 'error',
        text: t('settingsModelRequestFailed', { message: describeError(error, t) }),
      })
    } finally {
      if (!controller.signal.aborted) {
        setFetching(false)
      }
    }
  }

  const addManualModel = () => {
    const id = manualModel.trim()
    if (!id) {
      return
    }
    if (models.includes(id)) {
      setStatus({ type: 'error', text: t('settingsModelAddExists') })
      return
    }
    setModels((current) => sortModels([...current, id]))
    setSelectedModel(id)
    setManualModel('')
    setStatus(null)
  }

  const removeModel = (id: string) => {
    const next = models.filter((model) => model !== id)
    setModels(next)
    if (selectedModel === id) {
      setSelectedModel(next[0] ?? '')
    }
  }

  const save = () => {
    let normalized: string
    try {
      normalized = normalizeOpenAIBaseUrl(baseUrl)
    } catch {
      setStatus({ type: 'error', text: t('settingsModelInvalidUrl') })
      return
    }
    if (!selectedModel.trim()) {
      setStatus({ type: 'error', text: t('settingsModelMissingModel') })
      return
    }
    const nextModels = sortModels([...models, selectedModel])
    setOpenAICompatibleConfig({
      baseUrl: normalized,
      apiKey,
      models: nextModels,
      model: selectedModel,
    })
    setModelSource('openai-compatible')
    setBaseUrl(normalized)
    setModels(nextModels)
    setStatus({ type: 'ok', text: t('settingsModelSaved') })
    showToast({ key: 'settingsModelSaved' })
  }

  const clear = () => {
    requestRef.current?.abort()
    setFetching(false)
    clearOpenAICompatibleConfig()
    setModelSource('deepseek')
    setBaseUrl('')
    setApiKey('')
    setModels([])
    setSelectedModel('')
    setManualModel('')
    setQuery('')
    setStatus({ type: 'ok', text: t('settingsModelCleared') })
    showToast({ key: 'settingsModelCleared' })
  }

  return (
    <div className={clsx(styles.root, mobile && styles.mobile)}>
      <div className={styles.intro}>
        <span className={styles.introIcon}>
          <IconModelOutline16 />
        </span>
        <div>
          <div className={styles.introTitle}>{t('settingsModelSection')}</div>
          <p className={styles.introText}>{t('settingsModelSwitchHint')}</p>
        </div>
      </div>

      <div className={styles.providerOptions} role="radiogroup" aria-label={t('settingsModelSection')}>
        <button
          type="button"
          role="radio"
          aria-checked={modelSource === 'deepseek'}
          className={clsx(
            styles.providerOption,
            modelSource === 'deepseek' && styles.providerActive
          )}
          onClick={() => setModelSource('deepseek')}
        >
          <span className={styles.providerTop}>
            <span className={styles.providerName}>{t('settingsModelDeepSeekName')}</span>
            {modelSource === 'deepseek' ? (
              <span className={styles.activeBadge}>{t('settingsModelInUse')}</span>
            ) : null}
          </span>
          <span className={styles.providerDescription}>
            {t('settingsModelDeepSeekDescription')}
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={modelSource === 'openai-compatible'}
          className={clsx(
            styles.providerOption,
            modelSource === 'openai-compatible' && styles.providerActive
          )}
          onClick={() => {
            if (configured) {
              setModelSource('openai-compatible')
              return
            }
            setStatus({ type: 'error', text: t('settingsModelMissingConfig') })
            baseUrlRef.current?.focus()
          }}
        >
          <span className={styles.providerTop}>
            <span className={styles.providerName}>{t('settingsModelCompatibleName')}</span>
            {modelSource === 'openai-compatible' ? (
              <span className={styles.activeBadge}>{t('settingsModelInUse')}</span>
            ) : configured ? (
              <span className={styles.configuredBadge}>{t('settingsModelConfigured')}</span>
            ) : (
              <span className={styles.configuredBadge}>{t('settingsModelNotConfigured')}</span>
            )}
          </span>
          <span className={styles.providerDescription}>
            {t('settingsModelCompatibleDescription')}
          </span>
        </button>
      </div>

      <section className={styles.form} aria-labelledby="openai-compatible-title">
        <div className={styles.formHeading}>
          <div id="openai-compatible-title" className={styles.formTitle}>
            {t('settingsModelOpenAITitle')}
          </div>
          <p className={styles.formDescription}>{t('settingsModelOnlyTextHint')}</p>
        </div>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('settingsModelBaseUrl')}</span>
          <input
            ref={baseUrlRef}
            className={styles.input}
            value={baseUrl}
            placeholder={t('settingsModelBaseUrlPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('settingsModelApiKey')}</span>
          <input
            className={styles.input}
            type="password"
            value={apiKey}
            placeholder={t('settingsModelApiKeyPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <span className={styles.fieldHint}>{t('settingsModelKeyStorageHint')}</span>
        </label>

        <div className={styles.testRow}>
          <Button
            variant="outlined"
            size="m"
            disabled={fetching}
            onClick={() => void testConnection()}
          >
            {fetching ? t('settingsModelTesting') : t('settingsModelTest')}
          </Button>
          <span className={styles.fieldHint}>{t('settingsModelCorsHint')}</span>
        </div>

        <div className={styles.modelHeader}>
          <span className={styles.fieldLabel}>{t('settingsModelModels')}</span>
          <span className={styles.modelCount}>{models.length}</span>
        </div>
        {models.length > 5 ? (
          <input
            className={styles.input}
            value={query}
            placeholder={t('settingsModelSearchPlaceholder')}
            aria-label={t('settingsModelSearchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
        ) : null}
        {models.length === 0 ? (
          <div className={styles.empty}>{t('settingsModelEmpty')}</div>
        ) : filteredModels.length === 0 ? (
          <div className={styles.empty}>{t('settingsModelNoMatch')}</div>
        ) : (
          <div className={styles.modelList} role="radiogroup" aria-label={t('settingsModelModels')}>
            {filteredModels.map((model) => (
              <div
                key={model}
                className={clsx(styles.modelRow, selectedModel === model && styles.modelSelected)}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedModel === model}
                  className={styles.modelChoice}
                  onClick={() => setSelectedModel(model)}
                >
                  <span className={styles.radio}>
                    {selectedModel === model ? <IconCheckOutline16 /> : null}
                  </span>
                  <span className={styles.modelId}>{model}</span>
                </button>
                <button
                  type="button"
                  className={styles.removeModel}
                  aria-label={`${t('settingsModelRemove')}: ${model}`}
                  onClick={() => removeModel(model)}
                >
                  <IconCloseFill14 />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={styles.manualRow}>
          <input
            className={styles.input}
            value={manualModel}
            placeholder={t('settingsModelManualPlaceholder')}
            aria-label={t('settingsModelManualPlaceholder')}
            spellCheck={false}
            onChange={(event) => setManualModel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                addManualModel()
              }
            }}
          />
          <Button variant="outlined" size="m" onClick={addManualModel}>
            {t('settingsModelAdd')}
          </Button>
        </div>

        {status ? (
          <div
            className={clsx(styles.status, status.type === 'error' && styles.statusError)}
            role="status"
          >
            {status.text}
          </div>
        ) : null}

        <div className={styles.actions}>
          <Button variant="outlined" size="m" onClick={clear}>
            {t('settingsModelClear')}
          </Button>
          <Button variant="primary" size="m" onClick={save}>
            {t('settingsModelSave')}
          </Button>
        </div>
      </section>
    </div>
  )
}
