<template>
  <div class="chart-root">
    <!-- Legend: the dependable identity channel — text wears ink, the line key carries the color -->
    <div class="chart-legend">
      <div v-for="s in series" :key="s.label" class="legend-entry">
        <span class="legend-key" :style="{ background: s.color }" />
        <span class="legend-label">{{ s.label }}</span>
      </div>
    </div>

    <div
      ref="plotEl"
      class="plot-wrap"
      tabindex="0"
      role="img"
      :aria-label="ariaLabel"
      @pointermove="onPointerMove"
      @pointerleave="hoverIndex = null"
      @focus="hoverIndex = hoverIndex ?? days.length - 1"
      @blur="hoverIndex = null"
      @keydown.left.prevent="moveHover(-1)"
      @keydown.right.prevent="moveHover(1)"
    >
      <svg :viewBox="`0 0 ${W} ${H}`" class="plot-svg" preserveAspectRatio="none">
        <!-- Gridlines: hairline, solid, recessive -->
        <g>
          <line
            v-for="tick in yTicks"
            :key="`g${tick}`"
            :x1="PAD_L"
            :x2="W - PAD_R"
            :y1="yFor(tick)"
            :y2="yFor(tick)"
            class="gridline"
          />
        </g>

        <!-- Series lines: 2px, round join/cap. A single-day range has no line — markers carry it -->
        <g v-for="(s, si) in series" :key="s.label">
          <polyline
            v-if="days.length > 1"
            :points="linePoints(si)"
            fill="none"
            :stroke="s.color"
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
            vector-effect="non-scaling-stroke"
          />
          <circle
            v-else-if="days.length === 1"
            :cx="xFor(0)"
            :cy="yFor(values[si]?.[0] ?? 0)"
            r="4"
            :fill="s.color"
            class="marker-ring"
          />
        </g>

        <!-- Crosshair finds the X; hover markers get a 2px surface ring -->
        <g v-if="hoverIndex !== null">
          <line
            :x1="xFor(hoverIndex)"
            :x2="xFor(hoverIndex)"
            :y1="PAD_T"
            :y2="H - PAD_B"
            class="crosshair"
          />
          <circle
            v-for="(s, si) in series"
            :key="`h${s.label}`"
            :cx="xFor(hoverIndex)"
            :cy="yFor(values[si]?.[hoverIndex] ?? 0)"
            r="4"
            :fill="s.color"
            class="marker-ring"
          />
        </g>
      </svg>

      <!-- Axis text lives in HTML so it never stretches with preserveAspectRatio="none" -->
      <div
        v-for="tick in yTicks"
        :key="`yl${tick}`"
        class="y-label"
        :style="{ top: `${(yFor(tick) / H) * 100}%` }"
      >
        {{ tick.toLocaleString() }}
      </div>
      <div
        v-for="index in xLabelIndexes"
        :key="`xl${index}`"
        class="x-label"
        :style="{ left: `${(xFor(index) / W) * 100}%` }"
      >
        {{ shortDay(days[index]!) }}
      </div>

      <div v-if="isEmpty" class="empty-note">{{ emptyLabel }}</div>

      <!-- One tooltip, every series; values lead, labels follow -->
      <div
        v-if="hoverIndex !== null"
        class="chart-tooltip"
        :style="tooltipStyle"
      >
        <div class="tooltip-day">{{ longDay(days[hoverIndex]!) }}</div>
        <div v-for="(s, si) in series" :key="`t${s.label}`" class="tooltip-row">
          <span class="legend-key" :style="{ background: s.color }" />
          <span class="tooltip-value">{{ (values[si]?.[hoverIndex] ?? 0).toLocaleString() }}</span>
          <span class="tooltip-label">{{ s.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { DayCount } from 'src/api/admin';

export interface ChartSeries {
  label: string;
  /** Series color — marks only; all text stays in ink tokens. */
  color: string;
  data: DayCount[];
}

const props = defineProps<{
  series: ChartSeries[];
  /** Inclusive UTC range, YYYY-MM-DD. Drives gap filling — absent days are zero, not missing. */
  from: string;
  to: string;
  emptyLabel: string;
}>();

// Fixed drawing space; the SVG scales to the container. Axis/tooltip text is
// HTML positioned in %, so nothing stretches.
const W = 800;
const H = 240;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 8;

const DAY_MS = 86_400_000;

/** Dense day axis — the API omits zero days, a chart that connects the gaps lies. */
const days = computed<string[]>(() => {
  const fromMs = Date.parse(`${props.from}T00:00:00Z`);
  const toMs = Date.parse(`${props.to}T00:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) return [];
  const out: string[] = [];
  for (let ms = fromMs; ms <= toMs; ms += DAY_MS) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
});

const values = computed<number[][]>(() =>
  props.series.map((s) => {
    const byDay = new Map(s.data.map((d) => [d.day, d.count]));
    return days.value.map((day) => byDay.get(day) ?? 0);
  }),
);

const maxValue = computed(() => Math.max(0, ...values.value.flat()));
const isEmpty = computed(() => maxValue.value === 0);

/** Clean tick ceiling: 1/2/5 × 10^n at or above the max. */
const yMax = computed(() => {
  const max = Math.max(1, maxValue.value);
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= max) return m * pow;
  }
  return 10 * pow;
});

const yTicks = computed(() => {
  const step = yMax.value / 4;
  // Integer ticks only — fractional "0.5 items" ticks are noise
  if (!Number.isInteger(step)) return [0, yMax.value / 2, yMax.value].filter(Number.isInteger);
  return [0, step, step * 2, step * 3, yMax.value];
});

function xFor(index: number): number {
  if (days.value.length <= 1) return PAD_L + (W - PAD_L - PAD_R) / 2;
  return PAD_L + (index / (days.value.length - 1)) * (W - PAD_L - PAD_R);
}

function yFor(value: number): number {
  return H - PAD_B - (value / yMax.value) * (H - PAD_T - PAD_B);
}

function linePoints(seriesIndex: number): string {
  const row = values.value[seriesIndex] ?? [];
  return row.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ');
}

/** Up to 6 evenly spread date labels, always including first and last day. */
const xLabelIndexes = computed<number[]>(() => {
  const n = days.value.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  const count = Math.min(6, n);
  const out = new Set<number>();
  for (let i = 0; i < count; i++) out.add(Math.round((i / (count - 1)) * (n - 1)));
  return [...out];
});

function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'numeric',
    timeZone: 'UTC',
  });
}

function longDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const ariaLabel = computed(() =>
  props.series
    .map((s, si) => `${s.label}: ${(values.value[si] ?? []).reduce((a, b) => a + b, 0)}`)
    .join(', '),
);

// ── Hover / keyboard ──

const plotEl = ref<HTMLElement | null>(null);
const hoverIndex = ref<number | null>(null);

function onPointerMove(event: PointerEvent) {
  const el = plotEl.value;
  if (!el || days.value.length === 0) return;
  const rect = el.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * W;
  const fraction = (x - PAD_L) / (W - PAD_L - PAD_R);
  const index = Math.round(fraction * (days.value.length - 1));
  hoverIndex.value = Math.max(0, Math.min(days.value.length - 1, index));
}

function moveHover(delta: number) {
  if (days.value.length === 0) return;
  const current = hoverIndex.value ?? days.value.length - 1;
  hoverIndex.value = Math.max(0, Math.min(days.value.length - 1, current + delta));
}

/** Flip the tooltip to the left half once the crosshair crosses the middle. */
const tooltipStyle = computed(() => {
  if (hoverIndex.value === null) return {};
  const fraction = xFor(hoverIndex.value) / W;
  return fraction <= 0.5
    ? { left: `calc(${fraction * 100}% + 12px)` }
    : { right: `calc(${(1 - fraction) * 100}% + 12px)` };
});
</script>

<style scoped lang="sass">
.chart-root
  width: 100%

.chart-legend
  display: flex
  flex-wrap: wrap
  gap: 4px 16px
  margin-bottom: 8px

.legend-entry
  display: flex
  align-items: center
  gap: 6px

.legend-key
  display: inline-block
  width: 14px
  height: 3px
  border-radius: 2px
  flex: none

.legend-label
  font-size: 12px
  color: $muted

.plot-wrap
  position: relative
  padding: 0 0 20px 0
  margin-left: 44px
  outline: none
  &:focus-visible
    border-radius: 4px
    box-shadow: 0 0 0 2px rgba($primary, 0.35)

.plot-svg
  display: block
  width: 100%
  height: 240px

.gridline
  stroke: $divider
  stroke-width: 1
  vector-effect: non-scaling-stroke

.crosshair
  stroke: $muted
  stroke-width: 1
  vector-effect: non-scaling-stroke

.marker-ring
  // 2px surface ring keeps markers legible where they cross a line
  stroke: $surface
  stroke-width: 2

.y-label
  position: absolute
  right: 100%
  transform: translateY(-50%)
  padding-right: 8px
  font-size: 11px
  color: $muted
  font-variant-numeric: tabular-nums
  white-space: nowrap

.x-label
  position: absolute
  bottom: 0
  transform: translateX(-50%)
  font-size: 11px
  color: $muted
  font-variant-numeric: tabular-nums
  white-space: nowrap

.empty-note
  position: absolute
  inset: 0 0 20px 0
  display: flex
  align-items: center
  justify-content: center
  font-size: 13px
  color: $muted
  pointer-events: none

.chart-tooltip
  position: absolute
  top: 8px
  z-index: 2
  background: $surface
  border: 1px solid $divider
  border-radius: 6px
  padding: 8px 10px
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08)
  pointer-events: none
  min-width: 140px

.tooltip-day
  font-size: 11px
  color: $muted
  margin-bottom: 4px

.tooltip-row
  display: flex
  align-items: center
  gap: 6px
  font-size: 12px
  line-height: 1.6

.tooltip-value
  font-weight: 700
  color: $ink
  font-variant-numeric: tabular-nums

.tooltip-label
  color: $muted
</style>
