<script lang="ts">
  export interface ChartCategory {
    label: string;
    note?: string;
    flag?: boolean;
  }

  export interface ChartSeries {
    key: string;
    name: string;
    cls: 'planned' | 'actual' | 'att';
    values: number[];
  }

  let {
    categories = [],
    series = [],
    format = (v: number) => String(v),
    ariaLabel = 'Chart',
    emptyText = 'No data to show.',
    maxBar = 28
  }: {
    categories: ChartCategory[];
    series: ChartSeries[];
    format?: (v: number) => string;
    ariaLabel?: string;
    emptyText?: string;
    maxBar?: number;
  } = $props();

  let hostEl = $state<HTMLDivElement | null>(null);
  let tipEl = $state<HTMLDivElement | null>(null);
  let hostWidth = $state(480);
  let hoveredIndex = $state<number | null>(null);
  let tipLeft = $state(4);

  const H = 300;
  const m = { t: 16, r: 12, b: 84, l: 46 };

  function niceMax(v: number): number {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / p;
    const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nf * p;
  }

  function shortLabel(n: number): string {
    return n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0).replace('.0', '') + 'k' : String(n);
  }

  function trunc(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  const n = $derived(categories.length);
  const W = $derived(Math.max(hostWidth || 480, n * 56 + 60));
  const iw = $derived(W - m.l - m.r);
  const ih = H - m.t - m.b;

  const maxVal = $derived.by(() => {
    let max = 0;
    for (const s of series) {
      for (const v of s.values) {
        if (v > max) max = v;
      }
    }
    return max;
  });

  const top = $derived(niceMax(maxVal * 1.08));
  const yPos = (v: number) => m.t + ih - (v / top) * ih;

  const ticks = $derived.by(() => {
    const count =
      [5, 4, 2, 3].find((t) => {
        const st = top / t;
        const p = Math.pow(10, Math.floor(Math.log10(st)));
        const f = Math.round((st / p) * 1000) / 1000;
        return f === 1 || f === 2 || f === 2.5 || f === 5;
      }) || 4;
    const out: Array<{ value: number; y: number; label: string }> = [];
    for (let i = 0; i <= count; i++) {
      const tv = (top / count) * i;
      out.push({ value: tv, y: yPos(tv), label: shortLabel(Math.round(tv * 10) / 10) });
    }
    return out;
  });

  const band = $derived(n > 0 ? iw / n : iw);
  const gap = 2;
  const vis = $derived(series.length);
  const bw = $derived(vis > 0 ? Math.min(maxBar, (band * 0.7 - gap * (vis - 1)) / vis) : 0);

  function barPath(bx: number, by: number, width: number, bh: number): string {
    const r = Math.min(4, width / 2, bh);
    return (
      `M${bx},${by + bh}V${by + r}` +
      `Q${bx},${by} ${bx + r},${by}` +
      `H${bx + width - r}` +
      `Q${bx + width},${by} ${bx + width},${by + r}` +
      `V${by + bh}Z`
    );
  }

  function barClass(cls: ChartSeries['cls']): string {
    return cls === 'actual' ? 'bar-actual' : cls === 'planned' ? 'bar-planned' : 'bar-att';
  }

  function showTip(ci: number, cx: number) {
    hoveredIndex = ci;
    if (!hostEl) return;
    const tw = tipEl?.offsetWidth || 180;
    const scrollLeft = hostEl.scrollLeft || 0;
    const clientW = hostEl.clientWidth || hostWidth || 480;
    const clamped = Math.min(Math.max(cx - tw / 2, 4), scrollLeft + clientW - tw - 4);
    tipLeft = Math.max(clamped, scrollLeft + 4);
  }

  function hideTip() {
    hoveredIndex = null;
  }
</script>

<div class="chart" bind:this={hostEl} bind:clientWidth={hostWidth}>
  {#if !categories.length || !series.length}
    <div class="empty">{emptyText}</div>
  {:else}
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
      {#each ticks as t}
        <line x1={m.l} x2={W - m.r} y1={t.y} y2={t.y} class="gridline" />
        <text x={m.l - 8} y={t.y + 4} text-anchor="end" class="axis-text">{t.label}</text>
      {/each}

      {#each categories as c, ci}
        {@const cx = m.l + band * ci + band / 2}
        {@const startX = cx - (vis * bw + gap * (vis - 1)) / 2}
        {#each series as s, si}
          {@const v = s.values[ci] ?? 0}
          {@const bx = startX + si * (bw + gap)}
          {@const by = yPos(v)}
          {@const bh = m.t + ih - by}
          {#if bh > 0}
            <path d={barPath(bx, by, bw, bh)} class={barClass(s.cls)} />
          {/if}
        {/each}

        {#if c.flag}
          {@const maxCat = Math.max(...series.map((s) => s.values[ci] ?? 0))}
          {@const fy = yPos(maxCat) - 6}
          <path
            d={`M${cx},${fy - 9}L${cx + 6},${fy}L${cx - 6},${fy}Z`}
            class="flag-mark"
            aria-hidden="true"
          />
        {/if}

        <text
          x={cx}
          y={m.t + ih + 14}
          text-anchor="end"
          class="axis-text"
          transform={`rotate(-35 ${cx} ${m.t + ih + 14})`}
        >
          {trunc(c.label, 16)}
        </text>

        <rect
          x={m.l + band * ci}
          y={m.t}
          width={band}
          height={ih}
          class="hit"
          tabindex="0"
          role="button"
          aria-label={`${c.label}: ${series.map((s) => `${s.name} ${format(s.values[ci] ?? 0)}`).join(', ')}${c.note ? '. ' + c.note : ''}`}
          onmouseenter={() => showTip(ci, cx)}
          onfocus={() => showTip(ci, cx)}
          onmouseleave={hideTip}
          onblur={hideTip}
        />
      {/each}
    </svg>

    {#if hoveredIndex !== null && categories[hoveredIndex]}
      {@const active = categories[hoveredIndex]}
      <div class="chart-tooltip" bind:this={tipEl} style={`left:${tipLeft}px;top:4px;`}>
        <strong>{active.label}</strong>
        {#each series as s}
          <div class="row">
            <span>
              <i
                class={`sw ${s.cls}`}
                style="display:inline-block;width:10px;height:10px;border-radius:2px"
              ></i>
              {s.name}
            </span>
            <b>{format(s.values[hoveredIndex] ?? 0)}</b>
          </div>
        {/each}
        {#if active.note}
          <div class="note">{active.note}</div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
