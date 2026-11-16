<script lang="ts">
  export interface ToastItem {
    id: number;
    title: string;
    body: string;
    severity: 'critical' | 'warning';
  }

  let {
    toasts,
    onDismiss,
    onView
  }: {
    toasts: ToastItem[];
    onDismiss: (id: number) => void;
    onView: (id: number) => void;
  } = $props();
</script>

<div id="toasts" class="toasts" aria-live="polite">
  {#each toasts as t (t.id)}
    <div class={`toast ${t.severity}`} role="status">
      <span class={`sev ${t.severity}`} aria-hidden="true">!</span>
      <div>
        <strong>{t.title}</strong>
        <div>{t.body}</div>
        <button class="link" type="button" onclick={() => onView(t.id)}>View</button>
      </div>
      <button class="icon-btn" type="button" aria-label="Dismiss" onclick={() => onDismiss(t.id)}>
        &times;
      </button>
    </div>
  {/each}
</div>
