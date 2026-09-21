import { Sheet } from '@/components/ui/sheet'
import { AccountDetails } from '@/components/account/AccountDetails'
import type { AuthUser } from '@/types'

/** The signed-in SSO user's identity as Jarvis sees it — opened from the user menu. */
export function AccountSheet({ open, onClose, user }: { open: boolean; onClose: () => void; user: AuthUser }) {
  return (
    <Sheet open={open} onClose={onClose} ariaLabel="Account" className="sm:max-w-md lg:max-w-md">
      <div className="p-5 pt-10">
        <h2 className="mb-4 text-base font-semibold">Account</h2>
        <AccountDetails user={user} />
      </div>
    </Sheet>
  )
}
