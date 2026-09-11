import { cn } from '@/lib/utils'
import { avatarColorClass, avatarInitials } from '@/lib/avatarUtils'

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full text-[10px] font-semibold leading-none text-white select-none',
        avatarColorClass(name),
        className,
      )}
      aria-hidden="true"
    >
      {avatarInitials(name)}
    </div>
  )
}

export { Avatar }
