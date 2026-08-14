import { ASSET_LIBRARY_THEME_COOKIE, parseThemeChoice } from '$lib/library-theme'

export const load = ({ locals, cookies }: import('./$types').LayoutServerLoadEvent) => ({
  user: locals.user,
  themeChoice: parseThemeChoice(cookies.get(ASSET_LIBRARY_THEME_COOKIE)),
})
