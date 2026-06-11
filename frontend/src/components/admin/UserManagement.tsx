import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { fetchAdminUsers, createAdminUser, updateAdminUser, deleteAdminUser } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import type { AdminUser } from '@/types'

export function UserManagement() {
  const qc = useQueryClient()
  const { user: currentUser, providerInfo } = useAuthStore()
  const isInternalMode = providerInfo?.mode === 'internal'

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: fetchAdminUsers,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => updateAdminUser(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAdminUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  const createMutation = useMutation({
    mutationFn: (body: { username: string; password: string; role: string }) => createAdminUser(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      setNewUsername('')
      setNewPassword('')
      setNewRole('user')
      setCreateError('')
    },
    onError: () => setCreateError('Failed to create user (username may already exist).'),
  })

  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('user')
  const [createError, setCreateError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError('')
    if (newPassword.length < 12) {
      setCreateError('Password must be at least 12 characters.')
      return
    }
    createMutation.mutate({ username: newUsername, password: newPassword, role: newRole })
  }

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading users…</p>

  return (
    <div className="space-y-4">
      {/* User table */}
      <div className="rounded border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Username</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Role</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Provider</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Last login</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u: AdminUser) => {
              const isSelf = currentUser?.id === u.id
              return (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">
                    {u.username}
                    {isSelf && <span className="ml-1.5 text-[10px] text-muted-foreground">(you)</span>}
                  </td>
                  <td className="px-3 py-2">
                    {isSelf ? (
                      <span>{u.role}</span>
                    ) : (
                      <Select
                        value={u.role}
                        onChange={(e) => updateMutation.mutate({ id: u.id, role: e.target.value })}
                        className="h-6 w-20"
                        selectClassName="text-xs"
                        disabled={updateMutation.isPending}
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </Select>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{u.provider}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {!isSelf && (
                      confirmDeleteId === u.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-destructive">Confirm?</span>
                          <button
                            onClick={() => { deleteMutation.mutate(u.id); setConfirmDeleteId(null) }}
                            className="cursor-pointer text-destructive hover:text-destructive/80"
                          >
                            Yes
                          </button>
                          <button onClick={() => setConfirmDeleteId(null)} className="cursor-pointer text-muted-foreground">
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(u.id)}
                          className="cursor-pointer text-muted-foreground hover:text-destructive"
                          aria-label={`Delete ${u.username}`}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Add user form (internal mode only) */}
      {isInternalMode && (
        <form onSubmit={handleCreate} className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Add user</h4>
          <div className="flex items-center gap-2">
            <Input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Username"
              className="h-7 text-xs flex-1"
              required
            />
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Password (min 12 chars)"
              className="h-7 text-xs flex-1"
              required
            />
            <Select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="h-7 w-20 shrink-0"
              selectClassName="text-xs"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </Select>
            <Button type="submit" size="sm" className="h-7 shrink-0" disabled={createMutation.isPending}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          {createError && <p className="text-xs text-destructive">{createError}</p>}
        </form>
      )}
    </div>
  )
}
