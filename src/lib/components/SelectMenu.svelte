<script lang="ts">
  export interface SelectOption<T extends string = string> {
    value: T;
    label: string;
    meta?: string;
    dotClass?: string;
    badge?: string | number;
    disabled?: boolean;
  }

  let {
    id,
    value = $bindable(''),
    options,
    ariaLabel,
    prefix,
    placeholder = 'Select...',
    align = 'right',
    size = 'sm',
    fullWidth = false,
    floating = false,
    menuClass = '',
    leadingIcon,
    disabled = false,
    onchange
  }: {
    id?: string;
    value?: string;
    options: SelectOption[];
    ariaLabel?: string;
    prefix?: string;
    placeholder?: string;
    align?: 'left' | 'right';
    size?: 'sm' | 'md';
    fullWidth?: boolean;
    floating?: boolean;
    menuClass?: string;
    leadingIcon?: 'calendar';
    disabled?: boolean;
    onchange?: (value: string) => void;
  } = $props();

  let open = $state(false);
  let wrapEl = $state<HTMLDivElement | null>(null);
  let btnEl = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let fixedStyle = $state('');

  const selectedOption = $derived(options.find((o) => o.value === value) || null);
  const displayLabel = $derived(selectedOption ? selectedOption.label : placeholder);

  function computeFloatingPosition() {
    if (!floating || !btnEl || typeof window === 'undefined') {
      fixedStyle = '';
      return;
    }
    const r = btnEl.getBoundingClientRect();
    const minW = Math.max(150, Math.round(r.width));
    const estHeight = Math.min(260, options.length * 34 + 14);
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < estHeight && r.top > spaceBelow;
    const parts: string[] = [
      'position: fixed',
      `min-width: ${minW}px`,
      'z-index: 60'
    ];
    if (openUp) {
      parts.push(`bottom: ${Math.max(8, Math.round(window.innerHeight - r.top + 5))}px`, 'top: auto');
    } else {
      parts.push(`top: ${Math.round(r.bottom + 5)}px`, 'bottom: auto');
    }
    if (align === 'left') {
      const left = Math.max(8, Math.min(window.innerWidth - minW - 8, Math.round(r.left)));
      parts.push(`left: ${left}px`, 'right: auto');
    } else {
      const right = Math.max(8, Math.round(window.innerWidth - r.right));
      parts.push(`right: ${right}px`, 'left: auto');
    }
    fixedStyle = parts.join('; ');
  }

  function toggleMenu() {
    if (disabled) return;
    if (!open) {
      computeFloatingPosition();
      open = true;
    } else {
      open = false;
    }
  }

  function pick(opt: SelectOption) {
    if (opt.disabled) return;
    const changed = value !== opt.value;
    value = opt.value;
    open = false;
    if (changed) onchange?.(opt.value);
  }

  function handleWindowClick(e: MouseEvent) {
    if (!open || !wrapEl) return;
    const target = e.target as Node | null;
    if (target && !wrapEl.contains(target)) {
      open = false;
    }
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
      btnEl?.focus();
    }
  }

  function handleWindowScroll(e: Event) {
    if (!open || !floating) return;
    const target = e.target as Node | null;
    if (target && menuEl && (menuEl === target || menuEl.contains(target))) return;
    open = false;
  }
</script>

<svelte:window
  onclick={handleWindowClick}
  onkeydown={handleWindowKeydown}
  onresize={() => {
    if (open && floating) computeFloatingPosition();
  }}
  onscrollcapture={handleWindowScroll}
/>

<div
  bind:this={wrapEl}
  class="ac-display-by"
  class:is-open={open}
  class:is-full={fullWidth}
  class:is-md={size === 'md'}
>
  <button
    bind:this={btnEl}
    type="button"
    {id}
    class="ac-display-btn"
    class:is-placeholder={!selectedOption}
    {disabled}
    aria-label={ariaLabel}
    aria-haspopup="listbox"
    aria-expanded={open}
    onclick={toggleMenu}
  >
    <span class="ac-display-btn-main">
      {#if leadingIcon === 'calendar'}
        <svg class="ac-display-lead-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 10h18" stroke-linecap="round" />
        </svg>
      {/if}
      {#if selectedOption?.dotClass}
        <span class={`cal-color-dot ${selectedOption.dotClass}`} aria-hidden="true"></span>
      {/if}
      <span class="ac-display-btn-text">
        {#if prefix}
          {prefix} <strong>{displayLabel}</strong>
        {:else if selectedOption}
          <strong>{displayLabel}</strong>
        {:else}
          {displayLabel}
        {/if}
      </span>
    </span>
    <span class="ac-display-caret" class:is-open={open} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
  </button>

  {#if open}
    <div
      bind:this={menuEl}
      class={`ac-display-menu ${align === 'left' ? 'align-left' : ''} ${menuClass}`.trim()}
      style={floating ? fixedStyle : undefined}
      role="radiogroup"
      aria-label={ariaLabel || prefix || 'Options'}
    >
      {#each options as opt (opt.value)}
        {@const active = value === opt.value}
        <button
          type="button"
          role="radio"
          aria-checked={active}
          disabled={opt.disabled}
          class="ac-display-opt"
          class:selected={active}
          class:has-meta={Boolean(opt.meta)}
          onclick={() => pick(opt)}
        >
          <span class="ac-radio-dot" class:checked={active} aria-hidden="true"></span>
          {#if opt.dotClass}
            <span class={`cal-color-dot ${opt.dotClass}`} aria-hidden="true"></span>
          {/if}
          <span class="ac-display-opt-body">
            <span class="ac-display-opt-label">{opt.label}</span>
            {#if opt.meta}
              <small class="ac-display-opt-meta">{opt.meta}</small>
            {/if}
          </span>
          {#if opt.badge !== undefined}
            <span class="ac-display-opt-badge">{opt.badge}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
