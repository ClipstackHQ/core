// Doc 7 §2.1 hero KPI tile — predicted-percentile distribution.
// Numbers always mono with tabular-nums (Doc 8 §11.1 hard rule).
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "./Sparkline";

interface HeroKpiTileProps {
  predicted: number;       // 0–100
  delta: number;           // ±15 calibrated band per Doc 4 DoD #22
  trend: number[];         // last N drafts
  weeklyShipped: number;
}

export function HeroKpiTile({ predicted, delta, trend, weeklyShipped }: HeroKpiTileProps) {
  const sign = delta >= 0 ? "+" : "−";
  const tone = predicted >= 70 ? "success" : predicted >= 50 ? "warning" : "danger";

  return (
    <Card size="hero" tone="default" className="flex flex-col">
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <CardLabel>predicted percentile</CardLabel>
          <span className="text-xs text-text-tertiary">
            Calibrated within ±15 points · LightGBM
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={tone}>this week</Badge>
          <Link
            href="/performance"
            className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors duration-fast"
            aria-label="open performance dashboard"
          >
            history
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>

      <div className="flex items-end gap-4 mb-4">
        <span className="font-mono tabular-nums text-3xl font-semibold text-text-primary leading-none">
          {predicted}
        </span>
        <span className="font-mono tabular-nums text-xl text-text-secondary leading-none">
          ±{Math.abs(delta)}
        </span>
        <span className="font-mono tabular-nums text-sm text-text-tertiary mb-0.5">
          {sign}
          {Math.abs(delta)} vs last week
        </span>
      </div>

      <Sparkline
        values={trend}
        width={320}
        height={48}
        // Cap to the card's content width on narrow viewports so the
        // 320×48 SVG can't overflow the 12-col stacked layout. SVG
        // preserves its viewBox so the chart scales proportionally.
        className="w-full max-w-[320px] h-auto"
      />

      <div className="mt-auto pt-4 flex items-center gap-4 text-xs text-text-secondary">
        <span>
          shipped this week:{" "}
          <span className="font-mono tabular-nums text-text-primary">{weeklyShipped}</span>
        </span>
        <span className="ml-auto text-text-tertiary">live · &lt;5min lag</span>
      </div>
    </Card>
  );
}
