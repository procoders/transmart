import { Transmart } from './transmart'
import { RunWork } from './types'
import { readFile } from 'node:fs/promises'
import { translate } from './translate'
import { isPlainObject, splitJSONtoSmallChunks } from './split'
import { limit } from './limit'
import { jsonrepair } from 'jsonrepair'

interface TaskResult {
  content: string
  index: number
}

export class Task {
  constructor(private transmart: Transmart, private work: RunWork) {}

  async start(onProgress: (current: number, total: number) => any) {
    const { inputNSFilePath, namespace, locale } = this.work
    const { modelContextLimit, modelContextSplit } = this.transmart.options
    const content = await readFile(inputNSFilePath, { encoding: 'utf-8' })
    const chunks = splitJSONtoSmallChunks(JSON.parse(content), { modelContextLimit, modelContextSplit })
    let count = 0

    const p = chunks.map((chunk, index) => {
      return limit(() =>
        (async () => {
          const result = await this.run(JSON.stringify(chunk, null, 2), index)
          count++
          onProgress(count, chunks.length)
          return result
        })(),
      )
    })
    const results = await Promise.all(p)
    let namespaceResult = this.pack(results)
    const { overrides } = this.transmart.options

    // override with user provided
    if (overrides) {
      // Check if overrides exist for the current locale
      const localeOverrides = overrides[locale];
      if (localeOverrides) {
        // Apply overrides for the locale
        const namespaceOverrides = localeOverrides[namespace];
        if (namespaceOverrides) {
          // Merge overrides with existing values
          namespaceResult = deepMerge(namespaceResult, namespaceOverrides);
        } else {
          console.log("No overrides found for namespace:", namespace);
        }
      } else {
        console.log("No overrides found for locale:", locale);
      }
    }

    // Function to deeply merge objects
    function deepMerge(target: any, source: any) {
      for (const key in source) {
        if (source.hasOwnProperty(key)) {
          if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
            if (!target[key]) {
              target[key] = {};
            }
            deepMerge(target[key], source[key]);
          } else {
            target[key] = source[key];
          }
        }
      }
      return target;
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

    const data = await translate({
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
      const parsedJson = JSON.parse(content)
      return parsedJson
    } catch (e) {
      // try fix using jsonrepair, if it still fails, just raise error
      const parsedJson = JSON.parse(jsonrepair(content))
      return parsedJson
    }
  }

  pack(result: TaskResult[]): Record<string, any> {
    const onePiece = result
      .sort((a, b) => a.index - b.index)
      .reduce((prev, next) => {
        const parsedJson = this.parse(next.content)
        return {
          ...prev,
          ...parsedJson,
        }
      }, {})
    return onePiece
  }
}
