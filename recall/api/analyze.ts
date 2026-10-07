import { handleAnalyze, handleOptions } from './_lib/handler.js'

export async function POST(request: Request): Promise<Response> {
  return handleAnalyze(request)
}
export async function OPTIONS(request: Request): Promise<Response> {
  return handleOptions(request)
}
