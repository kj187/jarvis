import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchSilenceTemplates,
  createSilenceTemplate,
  updateSilenceTemplate,
  deleteSilenceTemplate,
} from '@/api/client'
import type { SilenceMatcher } from '@/types'

export function useSilenceTemplates() {
  return useQuery({
    queryKey: ['silenceTemplates'],
    queryFn: () => fetchSilenceTemplates(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}

export function useCreateSilenceTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; matchers: SilenceMatcher[]; reason: string }) =>
      createSilenceTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['silenceTemplates'] })
    },
  })
}

export function useUpdateSilenceTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { id: string; name: string; matchers: SilenceMatcher[]; reason: string }) =>
      updateSilenceTemplate(data.id, { name: data.name, matchers: data.matchers, reason: data.reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['silenceTemplates'] })
    },
  })
}

export function useDeleteSilenceTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteSilenceTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['silenceTemplates'] })
    },
  })
}
