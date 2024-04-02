import * as fs from 'fs-extra'
import * as path from 'path'
import { TransmartOptions, RunOptions, RunWork, TransmartStats, Stats } from './types'
import { Task } from './task'
import { glob } from 'glob'
import { getPairHash } from './util'
import { existsSync } from 'node:fs'

const DEFAULT_PARAMS: Partial<TransmartOptions> = {
  openAIApiUrl: 'https://api.openai.com',
  openAIApiUrlPath: '/v1/chat/completions',
  openAIApiModel: 'gpt-3.5-turbo-16k-0613',
  modelContextLimit: 4096,
  modelContextSplit: 1 / 1,
}

async function findLocalePaths(srcPath: string, targetFolders: string): Promise<string[]> {
  const localePaths: string[] = []

  async function search(dir: string) {
    const files = await fs.readdir(dir)
    for (const file of files) {
      const filePath = path.join(dir, file)
      const stats = await fs.stat(filePath)
      if (stats.isDirectory()) {
        if (file === targetFolders) {
          localePaths.push(filePath)
        } else {
          await search(filePath)
        }
      }
    }
  }

  await search(srcPath)
  return localePaths
}

export class Transmart {
  options!: Required<TransmartOptions>
  constructor(options: TransmartOptions) {
    this.options = options as Required<TransmartOptions>
  }

  public async run(options: RunOptions): Promise<TransmartStats> {
    this.validateParams()
    const {
      baseLocale,
      locales,
      localePath,
      cacheEnabled = true,
      targetFoldersName = 'locales',
      namespaceGlob = '**/*.json',
    } = this.options
    const targetLocales = locales.filter((item) => item !== baseLocale)
    const runworks: RunWork[] = []
    const localePaths = await findLocalePaths(localePath, targetFoldersName)
    // if cachePath is not provided, use the localePath/.cache as default
    const cachePath = this.options.cachePath || path.resolve(localePath, '.cache')

    for (const localePath of localePaths) {
      const baseLocaleFullPath = path.resolve(localePath, baseLocale)
      const namespaces = await glob(namespaceGlob, {
        cwd: baseLocaleFullPath,
      })

      targetLocales.forEach((targetLocale) => {
        namespaces.forEach((ns) => {
          const inputNSFilePath = path.resolve(baseLocaleFullPath, ns)
          const outputNSFilePath = path.resolve(localePath, targetLocale, ns)
          if (cacheEnabled) {
            const pairHash = getPairHash(inputNSFilePath, outputNSFilePath)
            const targetCachePath = path.join(cachePath, pairHash)
            if (existsSync(targetCachePath) && existsSync(outputNSFilePath)) {
              console.log(`cache file and output file exists, skip for namespace ${ns} - locale ${targetLocale}`)
              return
            }
          }
          const namespace = path.parse(ns).name
          runworks.push({
            namespace: namespace,
            baseLocale,
            locale: targetLocale,
            inputNSFilePath,
            outputNSFilePath,
            cachePath,
          })
        })
      })
    }
    const namespacesStats: Stats = {
      total: runworks.length,
      success: 0,
      failed: 0,
    }

    await Promise.all(
      runworks.map(async (work) => {
        const { onResult, onStart, onProgress } = options
        onStart?.(work)
        try {
          const task = new Task(this, work)
          const data = await task.start((current, total) => {
            onProgress?.(current, total, work)
          })
          namespacesStats.success++
          onResult?.({ work, content: data, failed: false })

          // after success, write the cache file
          if (cacheEnabled) {
            const pairHash = getPairHash(work.inputNSFilePath, work.outputNSFilePath)
            const targetCachePath = path.join(cachePath, pairHash)
            // just save an empty file as the cache file
            await fs.ensureFile(targetCachePath)
          }
        } catch (error) {
          namespacesStats.failed++
          onResult?.({ work, failed: true, content: '', reason: error as Error })
        }
      }),
    )
    return {
      namespaces: namespacesStats,
    }
  }

  private async processSingleNamespace(work: RunWork, options: RunOptions): Promise<void> {
    const { onResult, onStart, onProgress } = options
    onStart?.(work)
    try {
      const task = new Task(this, work)
      const data = await task.start((current, total) => {
        onProgress?.(current, total, work)
      })
      onResult?.({ work, content: data, failed: false })
    } catch (error) {
      onResult?.({ work, failed: true, content: '', reason: error as Error })
    }
  }

  private validateParams() {
    const { baseLocale, openAIApiKey, locales } = this.options
    if (typeof baseLocale !== 'string') throw new Error('valid `baseLocale` must be provided')
    if (typeof openAIApiKey !== 'string') throw new Error('valid `openAIApiKey` must be provided')
    if (!Array.isArray(locales) || locales.some((i) => typeof i !== 'string'))
      throw new Error('`locales` must be Array of string')
    // TODO: structure
    this.options = Object.assign({}, DEFAULT_PARAMS, this.options) as Required<TransmartOptions>
  }
}
