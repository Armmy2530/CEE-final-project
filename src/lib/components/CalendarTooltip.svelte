<script lang="ts">
  import { baht, fmtRange } from '$lib/format';
  import type { SvarCalendarEvent } from '$lib/calendar';

  let { event }: { event: SvarCalendarEvent } = $props();
</script>

<div class="cal-sv-tooltip">
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
