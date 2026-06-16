import { useQuery } from '@tanstack/react-query'
import { fetchInfo } from '@/api/client'

export function useVersion() {
  const { data } = useQuery({
    queryKey: ['info'],
    queryFn: fetchInfo,
    staleTime: Infinity,
  })
  return data?.version ?? null
}
