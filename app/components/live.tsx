"use client"

// Live data for the control room. One queue poll feeds the navigation and the
// worklist; it speeds up while the agent is working so progress shows promptly,
// and pauses when the tab is hidden.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { Queue } from "@/lib/triage"

export type QueueData = Queue & {
  sweep: { running: boolean; total: number; done: number; startedAt: string | null; available: number }
  agentAvailable: boolean
}

export function useLive<T>(url: string | null, interval: (data: T | null) => number) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dataRef = useRef<T | null>(null)
  const intervalRef = useRef(interval)
  intervalRef.current = interval
  const tick = useRef(0)

  const load = useCallback(async () => {
    if (!url) return
    const id = ++tick.current
    try {
      const response = await fetch(url, { cache: "no-store" })
      if (!response.ok) throw new Error(response.status === 404 ? "Not found" : "Could not load")
      const json = await response.json() as T
      if (id === tick.current) { dataRef.current = json; setData(json); setError(null) }
    } catch (cause) {
      if (id === tick.current) setError(cause instanceof Error ? cause.message : "Could not load")
    }
  }, [url])

  useEffect(() => {
    dataRef.current = null
    setData(null)
    setError(null)
    if (!url) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const loop = async () => {
      if (stopped) return
      if (document.visibilityState === "visible") await load()
      if (!stopped) timer = setTimeout(loop, intervalRef.current(dataRef.current))
    }
    void loop()
    const onVisible = () => { if (document.visibilityState === "visible") void load() }
    document.addEventListener("visibilitychange", onVisible)
    return () => { stopped = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible) }
  }, [url, load])

  return { data, error, reload: load }
}

const QueueContext = createContext<{ queue: QueueData | null; error: string | null; reload: () => Promise<void> }>({ queue: null, error: null, reload: async () => {} })

export function QueueProvider({ children }: { children: React.ReactNode }) {
  const { data, error, reload } = useLive<QueueData>("/api/queue", (current) =>
    current && (current.agent.working > 0 || current.agent.waiting > 0 || current.sweep.running) ? 2500 : 8000)
  return <QueueContext.Provider value={{ queue: data, error, reload }}>{children}</QueueContext.Provider>
}

export function useQueue() {
  return useContext(QueueContext)
}

export async function post<T = unknown>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) })
  const json = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(json.error ?? "Something went wrong")
  return json
}

/** A short-lived message at the bottom of the screen. */
export function useToast() {
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(timer)
  }, [toast])
  const node = toast ? <div className="toast" role="status">{toast}</div> : null
  return { show: setToast, node }
}
