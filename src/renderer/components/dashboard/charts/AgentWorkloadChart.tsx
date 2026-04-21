import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { AgentWorkloadData } from "./chart-utils";
import { ChartTooltip } from "./ChartTooltip";

interface AgentWorkloadChartProps {
  data: AgentWorkloadData[];
  reducedMotion: boolean;
}

export function AgentWorkloadChart({ data, reducedMotion }: AgentWorkloadChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          horizontal={true}
          vertical={false}
        />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<ChartTooltip valueSuffix=" runs" labelMode="plain" />} />
        <Bar
          dataKey="runs"
          fill="var(--primary)"
          fillOpacity={0.85}
          radius={[4, 4, 0, 0]}
          maxBarSize={40}
          isAnimationActive={!reducedMotion}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
