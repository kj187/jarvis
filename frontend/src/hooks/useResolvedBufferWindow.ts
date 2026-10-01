import { useQuery } from '@tanstack/react-query'
import { fetchStatus } from '@/api/client'
import { formatBufferWindow } from '@/lib/bufferWindow'

/** The window is fixed from process start, so this observer never refetches on its own (the Header drives ['status']). Readable resolved-buffer window ("20 minutes") from the instance status; undefined until known. */
export function useResolvedBufferWindow(): string | undefined {
  const { data } = useQuery({ queryKey: ['status'], queryFn: fetchStatus, staleTime: Infinity })
  return data?.resolved_buffer_ttl_seconds ? formatBufferWindow(data.resolved_buffer_ttl_seconds) : undefined
}
