import { Transmart } from './transmart'
import { RunWork } from './types'
import { readFile } from 'fs/promises' // Changed import path
import { translate } from './translate'
import { splitJSONtoSmallChunks } from './split'
import { limit } from './limit'
import { jsonrepair } from 'jsonrepair'

interface TaskResult {
  content: string
  index: number
}

export class Task {
  transmart: Transmart
  work: RunWork

  constructor(transmart: Transmart, work: RunWork) {
    this.transmart = transmart
    this.work = work
  }

  async start(onProgress: (current: number, total: number) => any): Promise<string> {
    const { inputNSFilePath, namespace, locale } = this.work
    const { modelContextLimit, modelContextSplit } = this.transmart.options
    const content: string = await readFile(inputNSFilePath, { encoding: 'utf-8' })
    const chunks: any[] = splitJSONtoSmallChunks(JSON.parse(content), { modelContextLimit, modelContextSplit })
    let count: number = 0

    const p: Promise<TaskResult>[] = chunks.map((chunk: any, index: number) => {
      return limit(() =>
        (async () => {
          const result = await this.run(JSON.stringify(chunk, null, 2), index)
          count++
          onProgress(count, chunks.length)
          return result
        })(),
      )
    })
    const results: TaskResult[] = await Promise.all(p)
    let namespaceResult: Record<string, any> = this.pack(results)

    const dirPath: string = inputNSFilePath.substring(0, inputNSFilePath.lastIndexOf('/locales/'))
    const localeOverridesPath = `${dirPath}/locales/${locale}/_${namespace}.override.json`;
    try {
      const localeOverridesContent: string = await readFile(localeOverridesPath, { encoding: 'utf-8' })
      const localeOverrides: Record<string, any> = JSON.parse(localeOverridesContent)
      if (localeOverrides) {
        namespaceResult = deepMerge(namespaceResult, localeOverrides)
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('Error reading or applying overrides:', error)
      }
    }

    function deepMerge(target: any, source: any): any {
      for (const key in source) {
        if (source.hasOwnProperty(key)) {
          if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
            if (!target[key]) {
              target[key] = {}
            }
            deepMerge(target[key], source[key])
          } else {
            target[key] = source[key]
          }
        }
      }
      return target
    }
    return JSON.stringify(namespaceResult, null, 2)
  }

  private async run(content: string, index: number): Promise<TaskResult> {
    const {
      openAIApiKey,
      openAIApiUrl,
      openAIApiUrlPath,
      openAIApiModel,
      baseLocale,
      context,
      systemPromptTemplate,
      additionalReqBodyParams,
    } = this.transmart.options
    const { locale } = this.work

    const data: string = await translate({
      content,
      baseLang: baseLocale,
      targetLang: locale,
      context,
      openAIApiModel,
      openAIApiKey,
      openAIApiUrl,
      openAIApiUrlPath,
      systemPromptTemplate,
      additionalReqBodyParams,
    })
    return {
      content: data,
      index,
    }
  }

  parse(content: string): Record<string, any> {
    try {
      const parsedJson: Record<string, any> = JSON.parse(content)
      return parsedJson
    } catch (e) {
      const parsedJson: Record<string, any> = JSON.parse(jsonrepair(content))
      return parsedJson
    }
  }

  pack(result: TaskResult[]): Record<string, any> {
    const onePiece: Record<string, any> = result
      .sort((a, b) => a.index - b.index)
      .reduce((prev, next) => {
        const parsedJson: Record<string, any> = this.parse(next.content)
        return {
          ...prev,
          ...parsedJson,
        }
      }, {})
    return onePiece
  }
}
