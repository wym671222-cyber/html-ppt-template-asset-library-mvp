import { registrationEnabled } from '$lib/server/registration'

export const load = () => ({ registrationEnabled: registrationEnabled() })
