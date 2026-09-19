import { OwlMeshBackdrop } from './OwlMeshBackdrop'

export interface EmptyStateProps {
  message?: string
}

export function EmptyState({ message = 'No alerts' }: EmptyStateProps) {
  return (
    <div role="status" className="flex min-h-[70vh] flex-col items-center justify-center gap-5 select-none">
      <div className="relative h-96 w-96">
        <OwlMeshBackdrop />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
