<script lang="ts">
  import SvelteMarkdown from '@humanspeak/svelte-markdown';
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
  let chatMode = $state('Knows your club data');
  let history = $state<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  let messages = $state<ChatBubble[]>([]);
  let contentEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let fabEl = $state<HTMLButtonElement | null>(null);

  const CHIPS = [
    'How much of our budget is left?',
    'Which event had the most attendees?',
    'Spending by category',
    'AC-002',
    'จำนวนสมาชิก'
  ];

  $effect(() => {
    messages = [];
    history = [];
  });

  function scrollBottom() {
    queueMicrotask(() => {
      if (contentEl) contentEl.scrollTop = contentEl.scrollHeight;
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
  class="assistant-fab ac-ai-pill"
  type="button"
  aria-label="Ask club AI"
  aria-expanded={open}
  bind:this={fabEl}
  onclick={() => toggleOpen(!open)}
>
  <span aria-hidden="true">&#10022;</span>
  <span>Ask club AI</span>
</button>

{#if open}
  <div id="chatPanel" class="assistant-panel" role="dialog" aria-label="Clubhouse assistant">
    <div class="assistant-head">
      <span class="assistant-spark" aria-hidden="true">&#10022;</span>
      <div>
        <b>Clubhouse assistant</b>
        <small id="chatMode">{chatMode}</small>
      </div>
      <button
        id="chatClose"
        type="button"
        aria-label="Close assistant"
        onclick={() => toggleOpen(false)}
      >
        &times;
      </button>
    </div>

    <div class="assistant-content" bind:this={contentEl}>
      <div class="assistant-greeting">
        <b>Hi {firstName}, how can I help?</b>
        <p>Ask me about events, members, attendance, or your budget.</p>
      </div>

      <div id="chatChips" class="suggestions-grid">
        {#each CHIPS as c}
          <button type="button" class="suggestion" onclick={() => ask(c)}>
            {c} <span aria-hidden="true">&#8599;</span>
          </button>
        {/each}
      </div>

      <div id="chatLog" class="chat-messages" aria-live="polite">
        {#each messages as m}
          {#if m.who === 'bot' && !m.typing}
            <div class="chat-bubble md-body">
              <SvelteMarkdown source={m.text} />
            </div>
          {:else}
            <div class="chat-bubble" class:user={m.who === 'user'} class:typing={m.typing}>
              {m.text}
            </div>
          {/if}
        {/each}
      </div>
    </div>

    <form
      id="chatForm"
      class="assistant-input"
      onsubmit={(ev) => {
        ev.preventDefault();
        ask(input);
      }}
    >
      <input
        id="chatInput"
        maxlength="500"
        placeholder="Ask about your club..."
        autocomplete="off"
        aria-label="Ask the assistant"
        bind:this={inputEl}
        bind:value={input}
      />
      <button type="submit" aria-label="Send message" disabled={asking}>&#8593;</button>
    </form>
  </div>
{/if}
