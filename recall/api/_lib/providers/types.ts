import type { Config } from '../config.js'
import type { PageInput } from '../types.js'

export interface ProviderCall {
  system: string
  pages: PageInput[]
  schema: Record<string, unknown>
  schemaName: string
  signal?: AbortSignal
}
export class ProviderError extends Error {
  constructor(public code: string, message: string, public status = 502, public retryable = true) { super(message) }
}
export type Provider = (cfg: Config, call: ProviderCall) => Promise<unknown>
