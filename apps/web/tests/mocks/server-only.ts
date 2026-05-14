// `server-only` throws at import time when used outside a Server Component.
// In Vitest we want the import to be a no-op so the same modules can run.
export {};
