import { useQuery } from '@tanstack/react-query'
import { fetchGlobalSettingsSections } from '@/api/client'

/**
 * Phase 0 of the RBAC label-scoped-access plan: a minimal scaffold for the
 * admin-settings foundation. It only lists the sections the backend has
 * registered — nothing is registered yet, so this renders an empty state
 * until a later phase (e.g. an "access" section) registers itself. No
 * section-specific form lives here on purpose; that comes with the phase
 * that registers the section.
 */
export function GlobalSettings() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-global-settings-sections'],
    queryFn: fetchGlobalSettingsSections,
  })

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading global settings…</p>
  if (isError) return <p className="text-xs text-destructive">Failed to load global settings.</p>

  const sections = data?.sections ?? []

  if (sections.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No global settings sections are available yet.
      </p>
    )
  }

  return (
    <ul className="space-y-1 text-xs">
      {sections.map((section) => (
        <li key={section} className="rounded-compact border border-border px-3 py-2">
          {section}
        </li>
      ))}
    </ul>
  )
}
