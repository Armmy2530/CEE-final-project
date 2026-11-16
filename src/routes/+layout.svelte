<script lang="ts">
  import '../app.css';
  import { onMount, setContext } from 'svelte';
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';
  import type { ThemeMode } from '$lib/types';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  let theme = $state<ThemeMode>('light');

  $effect.pre(() => {
    theme = data.initialTheme;
  });

  function applyTheme(t: ThemeMode) {
    theme = t;
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', t);
      document.documentElement.classList.toggle('dark', t === 'dark');
    }
  }

  onMount(() => {
    if (!data.hasThemePref) {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem('theme') || localStorage.getItem('clubhouse-theme');
      } catch {
        saved = null;
      }
      if (saved === 'light' || saved === 'dark') {
        applyTheme(saved);
      } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        applyTheme('dark');
      } else {
        applyTheme('light');
      }
    } else {
      applyTheme(data.initialTheme);
    }
  });

  setContext('theme', {
    get value() {
      return theme;
    },
    set: (t: ThemeMode) => {
      applyTheme(t);
      try {
        localStorage.setItem('theme', t);
        localStorage.setItem('clubhouse-theme', t);
      } catch {
        // ignore storage errors
      }
    }
  });
</script>

{@render children()}
