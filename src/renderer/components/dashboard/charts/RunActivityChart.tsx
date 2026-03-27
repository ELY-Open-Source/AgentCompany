import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DailyRunData } from "./chart-utils";
import { formatShortDate } from "./chart-utils";
import { ChartTooltip } from "./ChartTooltip";

interface RunActivityChartProps {
  data: DailyRunData[];
  reducedMotion: boolean;
}

export function RunActivityChart({ data, reducedMotion }: RunActivityChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--line)"
          horizontal={true}
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tickFormatter={formatShortDate}
          tick={{ fontSize: 11, fill: "var(--muted)" }}
          axisLine={{ stroke: "var(--line)" }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: "var(--muted)" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<ChartTooltip valueSuffix=" runs" />} />
        <Area
          type="monotone"
          dataKey="total"
          stroke="var(--accent)"
          fill="var(--accent-soft)"
          fillOpacity={0.3}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: "var(--accent)" }}
          isAnimationActive={!reducedMotion}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
