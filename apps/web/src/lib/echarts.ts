// Registro selectivo de ECharts (tree-shaking): sólo lo que usa el tablero.
import * as echarts from 'echarts/core';
import { BarChart, GaugeChart } from 'echarts/charts';
import { BrushComponent, GridComponent, ToolboxComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, GaugeChart, BrushComponent, GridComponent, ToolboxComponent, TooltipComponent, CanvasRenderer]);
export { echarts };
export { default as ReactECharts } from 'echarts-for-react/lib/core';

export const baseText = { color: '#5d6b7e', fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontSize: 10 };
export const tooltipStyle = {
  backgroundColor: 'rgba(255,255,255,.98)', borderColor: 'rgba(20,40,70,.12)', borderWidth: 1, padding: [6, 9],
  textStyle: { color: '#14202e', fontFamily: '"IBM Plex Sans", system-ui, sans-serif', fontSize: 12 },
  extraCssText: 'border-radius:8px;box-shadow:0 10px 30px rgba(20,40,70,.16)',
};
