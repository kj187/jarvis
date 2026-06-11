import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SetupPage } from './SetupPage'

vi.mock('@/api/client', () => ({
  postSetup: vi.fn(),
}))

import * as client from '@/api/client'

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'location', {
    value: { href: '' },
    writable: true,
  })
})

function fillForm(username: string, password: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } })
}

describe('SetupPage', () => {
  it('renders all form fields', () => {
    render(<SetupPage />)
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument()
  })

  it('shows error when passwords do not match', async () => {
    render(<SetupPage />)
    fillForm('admin', 'ValidPass123!', 'DifferentPass')
    fireEvent.click(screen.getByRole('button', { name: /create admin account/i }))
    await waitFor(() => expect(screen.getByText('Passwords do not match.')).toBeInTheDocument())
    expect(client.postSetup).not.toHaveBeenCalled()
  })

  it('shows error when password is too short', async () => {
    render(<SetupPage />)
    fillForm('admin', 'short', 'short')
    fireEvent.click(screen.getByRole('button', { name: /create admin account/i }))
    await waitFor(() =>
      expect(screen.getByText('Password must be at least 12 characters.')).toBeInTheDocument(),
    )
    expect(client.postSetup).not.toHaveBeenCalled()
  })

  it('calls postSetup and redirects on success', async () => {
    vi.mocked(client.postSetup).mockResolvedValue(undefined as never)
    render(<SetupPage />)
    fillForm('admin', 'ValidLongPass123!', 'ValidLongPass123!')
    fireEvent.click(screen.getByRole('button', { name: /create admin account/i }))
    await waitFor(() => expect(client.postSetup).toHaveBeenCalledWith('admin', 'ValidLongPass123!'))
  })

  it('shows strength indicator for password input', () => {
    render(<SetupPage />)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'weakpass' } })
    expect(screen.getByText(/strength:/i)).toBeInTheDocument()
  })

  it('shows error on API failure', async () => {
    vi.mocked(client.postSetup).mockRejectedValue(new Error('500'))
    render(<SetupPage />)
    fillForm('admin', 'ValidLongPass123!', 'ValidLongPass123!')
    fireEvent.click(screen.getByRole('button', { name: /create admin account/i }))
    await waitFor(() =>
      expect(screen.getByText('Setup failed. Please try again.')).toBeInTheDocument(),
    )
  })
})
