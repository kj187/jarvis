import { OwlMeshBackdrop } from './OwlMeshBackdrop'

export interface EmptyStateProps {
  message?: string
}

export function EmptyState({ message = 'No alerts' }: EmptyStateProps) {
  return (
    <div
      className="flex min-h-[70vh] flex-col items-center justify-center gap-5 select-none"
      aria-label={message}
    >
      <div className="relative h-96 w-96">
        <OwlMeshBackdrop />
      </div>
      <p className="text-sm text-muted-foreground opacity-70" aria-hidden>
        {message}
      </p>
    </div>
  )
}
