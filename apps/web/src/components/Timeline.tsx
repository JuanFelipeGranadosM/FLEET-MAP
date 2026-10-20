import { useMemo, useRef } from 'react';
import type { EChartsOption } from 'echarts';
import type { Aggregates } from '../data/aggregate';
import { useUi } from '../data/store';
import { ReactECharts, echarts, baseText, tooltipStyle } from '../lib/echarts';
import { COLORS, fmt } from '../lib/format';

/** Barras apiladas por día de toda la historia; arrastrar selecciona el rango de fechas. */
export function Timeline({ agg, days }: { agg: Aggregates; days: string[] }) {
  const range = useUi(s => s.range);
  const chart = useRef<{ getEchartsInstance(): echarts.ECharts } | null>(null);
  const n = days.length;
  const dragging = useRef(false);

  const option = useMemo<EChartsOption>(() => {
    const d = agg.daily, inR = (i: number) => i >= range.from && i <= range.to;
    const mk = (name: string, color: string, val: (i: number) => number) => ({
      id: name, type: 'bar' as const, name, stack: 'd', barCategoryGap: '18%', large: false,
      data: days.map((_, i) => ({ value: +val(i).toFixed(1), itemStyle: { color, opacity: inR(i) ? 1 : 0.25 } })),
    });
    return {
      animationDurationUpdate: 250,
      grid: { left: 40, right: 8, top: 8, bottom: 20 },
      xAxis: { type: 'category', data: days, axisLine: { lineStyle: { color: COLORS.line } }, axisTick: { show: false },
        axisLabel: { ...baseText, interval: (i: number) => days[i].endsWith('-01'), formatter: (v: string) => fmt.date(v, { month: 'short' }).toUpperCase() } },
      yAxis: { type: 'value', splitNumber: 3, axisLabel: { ...baseText, formatter: (v: number) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v)) }, splitLine: { lineStyle: { color: COLORS.line } } },
      tooltip: { ...tooltipStyle, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(20,40,70,.06)' } },
        formatter: (p: unknown) => {
          const i = (p as { dataIndex: number }[])[0].dataIndex;
          return `<b>${fmt.date(days[i], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</b><br/>
            Trabajadas ${fmt.hours(d.work[i])}<br/>Ralentí ${fmt.hours(d.idle[i])}<br/>Standby ${fmt.hours(d.standby[i])}<br/>Avería ${fmt.hours(d.down[i])}<br/>
            <span style="color:${COLORS.accentText}">${fmt.moneyFull(d.billed[i])}</span>`;
        } },
      toolbox: { show: false },
      series: [
        mk('Trabajadas', COLORS.op, i => d.work[i] - d.idle[i]),
        mk('Ralentí', COLORS.idle, i => d.idle[i]),
        mk('Standby', COLORS.standby, i => d.standby[i]),
        mk('Avería', COLORS.down, i => d.down[i]),
      ],
    };
  }, [agg, days, range]);

  const arm = (inst: echarts.ECharts) =>
    inst.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: 'lineX', brushMode: 'single' } });
  // El brush se configura una sola vez: así las actualizaciones de datos no lo reinician.
  const init = (inst: echarts.ECharts) => {
    inst.setOption({
      brush: { xAxisIndex: 0, brushType: 'lineX', brushMode: 'single', transformable: false, throttleType: 'debounce', throttleDelay: 60,
        brushStyle: { color: 'rgba(245,184,0,.18)', borderColor: COLORS.accent, borderWidth: 1 }, outOfBrush: { colorAlpha: 1 } },
    });
    arm(inst);
  };

  // onEvents estable: echarts-for-react reinicia el gráfico si cambia la referencia.
  const nRef = useRef(n); nRef.current = n;
  const events = useMemo(() => ({
    brush: (p: { areas?: unknown[] }) => { if (p.areas?.length) dragging.current = true; },
    brushEnd: (p: { areas: { coordRange: [number, number] }[] }) => {
      dragging.current = false;
      const a = p.areas[0]; if (!a) return;
      useUi.getState().setRange(a.coordRange[0], a.coordRange[1], nRef.current);
      const inst = chart.current?.getEchartsInstance();
      inst?.dispatchAction({ type: 'brush', areas: [] }); if (inst) arm(inst);
    },
  }), []);

  // Mientras el usuario arrastra, no se aplican actualizaciones en vivo (interrumpirían el brush).
  const shown = useRef(option);
  if (!dragging.current) shown.current = option;

  return (
    <div className="timeline panel">
      <div className="tl-head">
        <h3>Horas diarias de la flota<span>{fmt.date(days[range.from])} – {fmt.date(days[range.to], { day: 'numeric', month: 'short', year: 'numeric' })} · {range.to - range.from + 1} días</span></h3>
        <div className="tl-legend">
          <span><i style={{ background: COLORS.op }} />Trabajadas</span><span><i style={{ background: COLORS.idle }} />Ralentí</span>
          <span><i style={{ background: COLORS.standby }} />Standby</span><span><i style={{ background: COLORS.down }} />Avería</span>
          <span style={{ color: COLORS.accentText }}>Arrastre para elegir fechas</span>
        </div>
      </div>
      <div className="tl">
        <ReactECharts ref={chart as never} echarts={echarts} option={shown.current} notMerge={false} style={{ position: 'absolute', inset: 0, height: '100%' }}
          onChartReady={init}
          onEvents={events} />
      </div>
    </div>
  );
}
