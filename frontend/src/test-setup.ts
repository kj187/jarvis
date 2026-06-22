import '@testing-library/jest-dom'

// Node 25 + Vitest 4 + jsdom 29 can lose the Storage prototype when Node's
// built-in test runner processes --localstorage-file without a valid path.
// Provide a conformant localStorage so Zustand persist and test code work.
class LocalStorageMock implements Storage {
  private store: Record<string, string> = {}

  get length(): number {
    return Object.keys(this.store).length
  }
  key(index: number): string | null {
    return Object.keys(this.store)[index] ?? null
  }
  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value)
  }
  removeItem(key: string): void {
    delete this.store[key]
  }
  clear(): void {
    this.store = {}
  }
}

Object.defineProperty(window, 'localStorage', {
  value: new LocalStorageMock(),
  writable: true,
  configurable: true,
})
