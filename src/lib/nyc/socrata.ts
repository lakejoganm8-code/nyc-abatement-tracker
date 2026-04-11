import { SOCRATA_BASE_URL, SOCRATA_PAGE_SIZE } from "@/lib/analysis/config"

// ─── Socrata SODA2 API client ─────────────────────────────────────────────────

interface SocrataParams {
  $where?: string
  $select?: string
  $order?: string
  $limit?: number
  $offset?: number
  [key: string]: string | number | undefined
}

export class SocrataClient {
  private appToken: string | undefined
  private baseUrl: string

  constructor(appToken?: string) {
    this.appToken = appToken ?? process.env.NYC_OPEN_DATA_APP_TOKEN ?? undefined
    this.baseUrl = SOCRATA_BASE_URL
  }

  private buildUrl(datasetId: string, params: SocrataParams): string {
    const url = new URL(`${this.baseUrl}/${datasetId}.json`)
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined) url.searchParams.set(key, String(val))
    }
    return url.toString()
  }

  private headers(): HeadersInit {
    const h: HeadersInit = { "Accept": "application/json" }
    if (this.appToken) h["X-App-Token"] = this.appToken
    return h
  }

  /**
   * Fetch a single page from a Socrata dataset (GET).
   */
  async fetchPage<T = Record<string, string>>(
    datasetId: string,
    params: SocrataParams
  ): Promise<T[]> {
    const url = this.buildUrl(datasetId, params)
    const res = await this.fetchWithRetry(url)
    return res.json() as Promise<T[]>
  }

  /**
   * Fetch a single page using POST (avoids URL length limits for large WHERE clauses).
   */
  async fetchPagePost<T = Record<string, string>>(
    datasetId: string,
    params: SocrataParams
  ): Promise<T[]> {
    const url = `${this.baseUrl}/${datasetId}.json`
    const body = new URLSearchParams()
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined) body.set(key, String(val))
    }
    const res = await this.fetchWithRetry(url, 5, {
      method: "POST",
      body: body.toString(),
      extraHeaders: { "Content-Type": "application/x-www-form-urlencoded" },
    })
    return res.json() as Promise<T[]>
  }

  /**
   * Fetch ALL rows matching the query, handling pagination automatically (GET).
   */
  async fetchAll<T = Record<string, string>>(
    datasetId: string,
    params: Omit<SocrataParams, "$limit" | "$offset">
  ): Promise<T[]> {
    const allResults: T[] = []
    let offset = 0

    while (true) {
      const page = await this.fetchPage<T>(datasetId, {
        ...params,
        $limit: SOCRATA_PAGE_SIZE,
        $offset: offset,
      })

      allResults.push(...page)
      if (page.length < SOCRATA_PAGE_SIZE) break
      offset += SOCRATA_PAGE_SIZE
    }

    return allResults
  }

  /**
   * Fetch ALL rows using POST pagination (for large WHERE clauses that exceed URL limits).
   */
  async fetchAllPost<T = Record<string, string>>(
    datasetId: string,
    params: Omit<SocrataParams, "$limit" | "$offset">
  ): Promise<T[]> {
    const allResults: T[] = []
    let offset = 0

    while (true) {
      const page = await this.fetchPagePost<T>(datasetId, {
        ...params,
        $limit: SOCRATA_PAGE_SIZE,
        $offset: offset,
      })

      allResults.push(...page)
      if (page.length < SOCRATA_PAGE_SIZE) break
      offset += SOCRATA_PAGE_SIZE
    }

    return allResults
  }

  /**
   * Fetch with exponential backoff on 429/5xx and network errors (ECONNRESET, timeout).
   */
  private async fetchWithRetry(
    url: string,
    maxRetries = 3,
    options?: { method?: string; body?: string; extraHeaders?: Record<string, string> }
  ): Promise<Response> {
    let delay = 2000

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let res: Response
      try {
        res = await fetch(url, {
          method: options?.method ?? "GET",
          body: options?.body,
          headers: { ...this.headers(), ...(options?.extraHeaders ?? {}) },
          signal: AbortSignal.timeout(60_000), // 60s timeout per request
        })
      } catch (err) {
        if (attempt < maxRetries) {
          console.warn(`[socrata] Network error (attempt ${attempt + 1}/${maxRetries + 1}): ${(err as Error).message}. Retrying in ${delay}ms...`)
          await sleep(delay)
          delay = Math.min(delay * 2, 30_000)
          continue
        }
        throw err
      }

      if (res.ok) return res

      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        console.warn(`[socrata] HTTP ${res.status} (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay}ms...`)
        await sleep(delay)
        delay = Math.min(delay * 2, 30_000)
        continue
      }

      const body = await res.text().catch(() => "(no body)")
      throw new Error(`[socrata] HTTP ${res.status} fetching ${url}: ${body}`)
    }

    throw new Error(`[socrata] Max retries exceeded for ${url}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Shared client instance ───────────────────────────────────────────────────

let _client: SocrataClient | null = null

export function getSocrataClient(): SocrataClient {
  if (!_client) _client = new SocrataClient()
  return _client
}
