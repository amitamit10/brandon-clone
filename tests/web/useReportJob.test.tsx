import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useReportJob, MAX_CONSECUTIVE_ERRORS } from '../../web/lib/useReportJob'

const ID = 'a'.repeat(32)

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const running = (progress: number, error: string | null = null) => ({
  status: 'running',
  phase: 'summarizing',
  progress,
  total: 10,
  error,
})

/** Runs timers and lets the promise chains settle between steps. */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useReportJob', () => {
  it('calls advance until the job is done, 400 ms apart', async () => {
    const replies = [running(1), running(2), { status: 'done', phase: 'done', progress: 10, total: 10, error: null }]
    const fetchMock = vi.fn(async () => jsonResponse(200, replies.shift()))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useReportJob(ID))
    await tick(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.progress).toBe(1)

    await tick(399)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await tick(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await tick(400)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.current).toEqual({ status: 'done', phase: 'done', progress: 10, total: 10, error: null })

    await tick(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`/api/reports/${ID}/advance`)
    expect(init.method).toBe('POST')
  })

  it('stops on a failed job and reports the failure', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { status: 'failed', phase: 'failed', progress: 3, total: 10, error: 'llm_error' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useReportJob(ID))
    await tick(0)
    expect(result.current.status).toBe('failed')
    expect(result.current.error).toBe('llm_error')

    await tick(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('waits 5 s after a rate_limited answer and 2 s after other errors', async () => {
    const replies: unknown[] = [
      running(1, 'rate_limited'),
      running(1, 'llm_error'),
      running(2),
    ]
    const fetchMock = vi.fn(async () => jsonResponse(200, replies.shift()))
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useReportJob(ID))
    await tick(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await tick(4_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await tick(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await tick(1_999)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await tick(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('backs off on an HTTP 429 and recovers when the next call succeeds', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls++
      return calls === 1
        ? jsonResponse(429, { error: 'rate_limited' })
        : jsonResponse(200, { status: 'done', phase: 'done', progress: 10, total: 10, error: null })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useReportJob(ID))
    await tick(0)
    expect(result.current.error).toBe('rate_limited')
    await tick(4_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await tick(1)
    expect(result.current.status).toBe('done')
  })

  it('never runs two advance calls at once, even with two hook instances on one report', async () => {
    let inFlight = 0
    let maxInFlight = 0
    let remaining = 4
    const fetchMock = vi.fn(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      inFlight--
      remaining--
      return jsonResponse(200, remaining > 0 ? running(4 - remaining) : { status: 'done', phase: 'done', progress: 10, total: 10, error: null })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useReportJob(ID))
    renderHook(() => useReportJob(ID))
    await tick(60_000)

    expect(maxInFlight).toBe(1)
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4)
  })

  it('retries network errors and gives up after the limit with an error state', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useReportJob(ID))
    await tick(0)
    expect(result.current.status).toBe('running')
    expect(result.current.error).toBe('network')

    await tick(2_000 * (MAX_CONSECUTIVE_ERRORS - 1) + 10)
    expect(fetchMock).toHaveBeenCalledTimes(MAX_CONSECUTIVE_ERRORS)
    expect(result.current.status).toBe('failed')
    expect(result.current.error).toBe('network')

    await tick(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(MAX_CONSECUTIVE_ERRORS)
  })

  it('stops for good when the report is not found', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(404, { error: 'not_found' }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useReportJob(ID))
    await tick(0)
    expect(result.current.status).toBe('failed')
    expect(result.current.error).toBe('not_found')
    await tick(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops calling when unmounted, even while a call is still pending', async () => {
    let resolveFirst: ((r: Response) => void) | undefined
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { unmount } = renderHook(() => useReportJob(ID))
    await tick(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    unmount()

    await act(async () => {
      resolveFirst?.(jsonResponse(200, running(1)))
    })
    await tick(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
