<script lang="ts">
  import { apiFetch } from '$lib/format';

  interface ChatBubble {
    who: 'user' | 'bot';
    text: string;
    typing?: boolean;
  }

  let { firstName }: { firstName: string } = $props();

  let open = $state(false);
  let input = $state('');
  let asking = $state(false);
  let chatMode = $state('Ask about club & sheet data');
  let history = $state<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  let messages = $state<ChatBubble[]>([]);
  let logEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let fabEl = $state<HTMLButtonElement | null>(null);

  const CHIPS = [
    'Budget status',
    'Spending by category',
    'Upcoming events',
    'Best attendance',
    'AC-002',
    'จำนวนสมาชิก'
  ];

  $effect(() => {
    messages = [
      {
        who: 'bot',
        text: `Hi ${firstName}! Ask me about members, projects (e.g. AC-002), attendance, or spending categories.`
      }
    ];
    history = [];
  });

  function scrollBottom() {
    queueMicrotask(() => {
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    });
  }

  function toggleOpen(next: boolean) {
    open = next;
    if (open) {
      queueMicrotask(() => inputEl?.focus());
    } else {
      queueMicrotask(() => fabEl?.focus());
    }
  }

  async function ask(text: string) {
    const trimmed = text.trim();
    if (asking || !trimmed) return;
    asking = true;
    input = '';
    messages = [...messages, { who: 'user', text: trimmed }, { who: 'bot', text: 'Thinking…', typing: true }];
    scrollBottom();

    try {
      const r = await apiFetch<{ reply: string; mode: 'ai' | 'offline' }>('POST', '/api/chat', {
        message: trimmed,
        history
      });
      const reply = r.reply || '(no answer)';
      messages = [...messages.slice(0, -1), { who: 'bot', text: reply }];
      history = [...history, { role: 'user', content: trimmed }, { role: 'assistant', content: reply }];
      chatMode =
        r.mode === 'ai'
          ? 'OpenRouter AI • Live club data'
          : 'Offline mode (rule-based answers)';
    } catch (e) {
      messages = [...messages.slice(0, -1), { who: 'bot', text: `Sorry, ${(e as Error).message}` }];
    } finally {
      asking = false;
      scrollBottom();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      toggleOpen(false);
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<button
  id="chatFab"
  class="chat-fab"
  type="button"
  aria-label="Open AI assistant"
  aria-expanded={open}
  bind:this={fabEl}
  onclick={() => toggleOpen(!open)}
>
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 5h16v11H9l-5 4V5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
  </svg>
</button>

{#if open}
  <div id="chatPanel" class="chat-panel" role="dialog" aria-label="AI assistant">
    <div class="chat-head">
      <div>
        <strong>Club assistant</strong>
        <small id="chatMode">{chatMode}</small>
      </div>
      <button
        id="chatClose"
        class="icon-btn"
        type="button"
        aria-label="Close assistant"
        onclick={() => toggleOpen(false)}
      >
        &times;
      </button>
    </div>

    <div id="chatLog" class="chat-log" aria-live="polite" bind:this={logEl}>
      {#each messages as m}
        <div class={`msg ${m.who}`} class:typing={m.typing}>{m.text}</div>
      {/each}
    </div>

    <div id="chatChips" class="chat-chips">
      {#each CHIPS as c}
        <button type="button" onclick={() => ask(c)}>{c}</button>
      {/each}
    </div>

    <form
      id="chatForm"
      class="chat-form"
      onsubmit={(ev) => {
        ev.preventDefault();
        ask(input);
      }}
    >
      <input
        id="chatInput"
        maxlength="500"
        placeholder="Ask a question..."
        autocomplete="off"
        aria-label="Your question"
        bind:this={inputEl}
        bind:value={input}
      />
      <button class="btn primary" type="submit" disabled={asking}>Send</button>
    </form>
  </div>
{/if}
