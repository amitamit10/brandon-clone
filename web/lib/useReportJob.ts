import { useEffect, useState } from 'react'
import { advance, ApiError, NetworkError, type JobState } from './api'

export type JobStatus = 'running' | 'done' | 'failed'

export interface ReportJob {
  status: JobStatus
  phase: string
  progress: number
  total: number
  /** the last error code seen (for example 'rate_limited' or 'llm_error'), or null */
  error: string | null
}

export const INITIAL_JOB: ReportJob = { status: 'running', phase: '', progress: 0, total: 0, error: null }

/** Pauses between calls. Exported so tests and callers share one set of numbers. */
export const JOB_DELAYS = { afterSuccessMs: 400, rateLimitedMs: 5000, afterErrorMs: 2000 } as const
export const MAX_CONSECUTIVE_ERRORS = 20

/**
 * One chain of advance calls per report id, across every hook instance. A second loop for the same
 * report (React StrictMode mounts effects twice, or a remount during a slow call) waits for the
 * first call instead of overlapping it.
 */
const gates = new Map<string, Promise<void>>()

function gated<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = gates.get(key) ?? Promise.resolve()
  const result = previous.then(task)
  const settled = result.then(
    () => undefined,
    () => undefined,
  )
  gates.set(key, settled)
  void settled.then(() => {
    if (gates.get(key) === settled) gates.delete(key)
  })
  return result
}

function errorCode(err: unknown): string {
  if (err instanceof NetworkError) return 'network'
  if (err instanceof ApiError) return err.code ?? `http_${err.status}`
  return 'error'
}

/**
 * Calls advance one step at a time until the job is done or failed. The next call waits 400 ms after a
 * success, 5 s after a 'rate_limited' answer, and 2 s after any other error. Gives up after 20 errors
 * in a row (the status becomes 'failed' with the error code), on a 404, or when the component unmounts.
 */
export function useReportJob(reportId: string | null): ReportJob {
  const [job, setJob] = useState<ReportJob>(INITIAL_JOB)

  useEffect(() => {
    if (!reportId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let wake: (() => void) | undefined

    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        wake = resolve
        timer = setTimeout(() => {
          wake = undefined
          resolve()
        }, ms)
      })

    const loop = async () => {
      let consecutiveErrors = 0
      while (!stopped) {
        let wait: number
        try {
          const state: JobState = await gated(reportId, () => advance(reportId))
          if (stopped) return
          consecutiveErrors = 0
          if (state.status === 'done' || state.status === 'failed') {
            setJob({
              status: state.status === 'done' ? 'done' : 'failed',
              phase: state.phase,
              progress: state.progress,
              total: state.total,
              error: state.error,
            })
            return
          }
          setJob({ status: 'running', phase: state.phase, progress: state.progress, total: state.total, error: state.error })
          wait =
            state.error === null
              ? JOB_DELAYS.afterSuccessMs
              : state.error === 'rate_limited'
                ? JOB_DELAYS.rateLimitedMs
                : JOB_DELAYS.afterErrorMs
        } catch (err) {
          if (stopped) return
          consecutiveErrors++
          const code = errorCode(err)
          if ((err instanceof ApiError && err.status === 404) || consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            setJob((prev) => ({ ...prev, status: 'failed', error: err instanceof ApiError && err.status === 404 ? 'not_found' : code }))
            return
          }
          setJob((prev) => ({ ...prev, status: 'running', error: code }))
          wait = code === 'rate_limited' ? JOB_DELAYS.rateLimitedMs : JOB_DELAYS.afterErrorMs
        }
        await pause(wait)
      }
    }

    void loop()

    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      wake?.()
    }
  }, [reportId])

  return job
}
