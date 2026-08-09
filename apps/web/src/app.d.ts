declare global {
  namespace App {
    interface Locals {
      user: import('$lib/auth').SessionUser | null
    }
  }
}

export {}
