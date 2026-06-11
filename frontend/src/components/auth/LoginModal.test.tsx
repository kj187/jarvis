import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LoginModal } from './LoginModal'
import { useAuthStore } from '@/store/authStore'

vi.mock('@/api/client', () => ({
  postLogin: vi.fn(),
  fetchAuthInfo: vi.fn(),
  fetchAuthMe: vi.fn(),
  postLogout: vi.fn(),
}))

import * as client from '@/api/client'

beforeEach(() => {
  useAuthStore.setState({ user: null, providerInfo: null, isAuthenticated: false, isLoading: false })
  vi.clearAllMocks()
})

describe('LoginModal — closed', () => {
  it('renders nothing when open=false', () => {
    render(<LoginModal open={false} onSuccess={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('LoginModal — internal mode', () => {
  beforeEach(() => {
    useAuthStore.setState({ providerInfo: { mode: 'internal', loginUrl: '' } })
  })

  it('renders username + password inputs', () => {
    render(<LoginModal open onSuccess={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByPlaceholderText('Username')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument()
  })

  it('calls onSuccess after successful login', async () => {
    vi.mocked(client.postLogin).mockResolvedValue({
      user: { id: 'u1', username: 'alice', role: 'admin', provider: 'internal' },
    } as never)
    const onSuccess = vi.fn()
    render(<LoginModal open onSuccess={onSuccess} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: /login/i }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })

  it('shows error on failed login', async () => {
    vi.mocked(client.postLogin).mockRejectedValue(new Error('401'))
    render(<LoginModal open onSuccess={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /login/i }))
    await waitFor(() => expect(screen.getByText('Invalid username or password.')).toBeInTheDocument())
  })

  it('calls onClose when X button clicked', () => {
    const onClose = vi.fn()
    render(<LoginModal open onSuccess={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('LoginModal — oidc mode', () => {
  beforeEach(() => {
    useAuthStore.setState({ providerInfo: { mode: 'oidc', loginUrl: '/auth/oidc/start' } })
  })

  it('renders SSO button', () => {
    render(<LoginModal open onSuccess={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /login with sso/i })).toBeInTheDocument()
  })

  it('does not render username input', () => {
    render(<LoginModal open onSuccess={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByPlaceholderText('Username')).toBeNull()
  })
})

describe('LoginModal — none mode', () => {
  beforeEach(() => {
    useAuthStore.setState({ providerInfo: { mode: 'none', loginUrl: '' } })
  })

  it('shows not-configured message', () => {
    render(<LoginModal open onSuccess={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/authentication is not configured/i)).toBeInTheDocument()
  })
})
