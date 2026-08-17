import { redirect } from '@sveltejs/kit'
import { registrationEnabled } from '$lib/server/registration'

export const load = () => {
  if (!registrationEnabled()) throw redirect(303, '/login')
  return {}
}
