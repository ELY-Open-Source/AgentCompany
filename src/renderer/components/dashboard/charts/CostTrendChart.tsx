import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DailyCostData } from "./chart-utils";
import { formatShortDate } from "./chart-utils";
import { ChartTooltip } from "./ChartTooltip";

interface CostTrendChartProps {
  data: DailyCostData[];
  reducedMotion: boolean;
}

export function CostTrendChart({ data, reducedMotion }: CostTrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          horizontal={true}
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tickFormatter={formatShortDate}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(val: number) => "$" + val.toFixed(0)}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<ChartTooltip valuePrefix="$" />} />
        <Area
          type="monotone"
          dataKey="total"
          stroke="var(--primary)"
          fill="var(--primary)"
          fillOpacity={0.15}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: "var(--primary)" }}
          isAnimationActive={!reducedMotion}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
