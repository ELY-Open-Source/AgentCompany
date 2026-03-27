import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DailyRunData } from "./chart-utils";
import { formatShortDate } from "./chart-utils";
import { ChartTooltip } from "./ChartTooltip";

interface SuccessRateChartProps {
  data: DailyRunData[];
  reducedMotion: boolean;
}

export function SuccessRateChart({ data, reducedMotion }: SuccessRateChartProps) {
  const rateData = useMemo(
    () =>
      data.map((d) => ({
        date: d.date,
        rate: d.total > 0 ? Math.round((d.succeeded / d.total) * 100) : 0,
      })),
    [data],
  );

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={rateData}>
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
          domain={[0, 100]}
          tickFormatter={(val: number) => `${val}%`}
          tick={{ fontSize: 11, fill: "var(--muted)" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<ChartTooltip valueSuffix="%" />} />
        <Line
          type="monotone"
          dataKey="rate"
          stroke="var(--success)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: "var(--success)" }}
          isAnimationActive={!reducedMotion}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
