// Registro selectivo de ECharts (tree-shaking): sólo lo que usa el tablero.
import * as echarts from 'echarts/core';
import { BarChart, GaugeChart } from 'echarts/charts';
import { BrushComponent, GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, GaugeChart, BrushComponent, GridComponent, TooltipComponent, CanvasRenderer]);
export { echarts };
export { default as ReactECharts } from 'echarts-for-react/lib/core';

export const baseText = { color: '#8797b0', fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontSize: 10 };
export const tooltipStyle = {
  backgroundColor: 'rgba(9,17,29,.96)', borderColor: 'rgba(140,172,214,.25)', borderWidth: 1, padding: [6, 9],
  textStyle: { color: '#e8eef7', fontFamily: '"IBM Plex Sans", system-ui, sans-serif', fontSize: 12 },
  extraCssText: 'border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.4)',
};
