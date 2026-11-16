import type { LayoutServerLoad } from './$types';
import type { ThemeMode } from '$lib/types';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
  const cookieTheme = cookies.get('theme');
  const initialTheme: ThemeMode =
    locals.user?.theme || (cookieTheme === 'dark' ? 'dark' : 'light');

  return {
    user: locals.user,
    initialTheme,
    hasThemePref: Boolean(locals.user?.theme || cookieTheme === 'light' || cookieTheme === 'dark')
  };
};
