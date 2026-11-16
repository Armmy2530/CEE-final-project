import adapter from 'svelte-adapter-bun';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ out: 'build', precompress: false }),
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
        'font-src': ['https://fonts.gstatic.com'],
        'img-src': ['self', 'data:', 'https:'],
        'script-src': ['self'],
        'connect-src': ['self'],
        'frame-ancestors': ['none']
      }
    }
  }
};

export default config;
