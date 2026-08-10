const RETIRED_EMAIL_ERROR = 'Legacy email capability is retired'

function rejectRetiredEmail(): never {
  throw new Error(RETIRED_EMAIL_ERROR)
}

export async function sendVerificationEmail(_to: string, _token: string): Promise<void> {
  rejectRetiredEmail()
}

export async function sendPasswordResetEmail(_to: string, _token: string): Promise<void> {
  rejectRetiredEmail()
}

export async function sendAdminPasswordResetEmail(_to: string, _token: string, _adminName: string): Promise<void> {
  rejectRetiredEmail()
}

export async function sendDeckSharedEmail(
  _to: string,
  _sharedByName: string,
  _deckTitle: string,
  _deckId: string,
  _role: string,
): Promise<void> {
  rejectRetiredEmail()
}
