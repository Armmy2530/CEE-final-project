<script lang="ts">
  import { baht, fmtRange } from '$lib/format';
  import type { SvarCalendarEvent } from '$lib/calendar';

  let { event }: { event: SvarCalendarEvent } = $props();

  function clampToViewport(node: HTMLElement) {
    function adjust() {
      if (typeof window === 'undefined') return;
      node.style.transform = '';
      const rect = node.getBoundingClientRect();
      const pad = 12;
      let dx = 0;
      let dy = 0;
      if (rect.right > window.innerWidth - pad) {
        dx = window.innerWidth - pad - rect.right;
      }
      if (rect.left + dx < pad) {
        dx = pad - rect.left;
      }
      if (rect.bottom > window.innerHeight - pad) {
        dy = window.innerHeight - pad - rect.bottom;
      }
      if (dx !== 0 || dy !== 0) {
        node.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
      }
    }
    adjust();
    const raf = requestAnimationFrame(adjust);
    return {
      destroy() {
        cancelAnimationFrame(raf);
      }
    };
  }
</script>

<div class="cal-sv-tooltip" use:clampToViewport>
  <div class="cal-sv-tooltip-head">
    <span class={`cal-sv-dot ev-swatch-${event.colorIndex}`}></span>
    <strong>{event.event_id} &middot; {event.title}</strong>
  </div>
  <div class="cal-sv-tooltip-meta">
    <span>{fmtRange({ date: event.start_date, end_date: event.end_date })}</span>
    <span>&middot;</span>
    <span>{event.days > 1 ? `${event.days} days (ต่อเนื่อง)` : '1 day'}</span>
  </div>
  <div class="cal-sv-tooltip-foot">
    <span>{event.location || 'TBA'}</span>
    <span>{baht(event.budget_actual)} / {baht(event.budget_planned)}</span>
  </div>
</div>
