import { handleHealth, handleOptions } from './_lib/handler.js'

export async function GET(request: Request): Promise<Response> {
  return handleHealth(request)
}
export async function OPTIONS(request: Request): Promise<Response> {
  return handleOptions(request)
}
