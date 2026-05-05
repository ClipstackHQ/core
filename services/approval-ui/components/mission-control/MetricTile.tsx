// Doc 8 §9.2 — secondary metric tile. Single number + sparkline + tone hint.
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Sparkline } from "./Sparkline";
import { cn } from "@/lib/utils";

interface MetricTileProps {
  label: string;
  value: string | number;
  unit?: string;
  delta?: { value: number; label?: string };
  trend?: number[];
  size?: "small" | "medium" | "wide";
  tone?: "default" | "accent" | "success" | "warning" | "danger";
  className?: string;
  // Optional click-through href. When set, the CardHeader gets an
  // ArrowUpRight link to the detail surface — keeps the tile lean
  // when a metric has no deeper view yet.
  href?: string;
  hrefLabel?: string;
}

export function MetricTile({
  label,
  value,
  unit,
  delta,
  trend,
  size = "medium",
  tone = "default",
  className,
  href,
  hrefLabel = "history",
}: MetricTileProps) {
  const deltaTone =
    delta === undefined
      ? "text-text-tertiary"
      : delta.value > 0
        ? "text-status-success"
        : delta.value < 0
          ? "text-status-danger"
          : "text-text-tertiary";

  return (
    <Card size={size} tone={tone} className={cn("flex flex-col", className)}>
      <CardHeader>
        <CardLabel>{label}</CardLabel>
        {href && (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors duration-fast"
            aria-label={`open ${label} ${hrefLabel}`}
          >
            {hrefLabel}
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
      </CardHeader>
      <div className="flex items-baseline gap-2">
        <span className="font-mono tabular-nums text-2xl font-semibold text-text-primary leading-none">
          {value}
        </span>
        {unit && <span className="text-xs text-text-tertiary">{unit}</span>}
      </div>
      {delta && (
        <div className={cn("mt-1 text-xs font-mono tabular-nums", deltaTone)}>
          {delta.value >= 0 ? "+" : ""}
          {delta.value}
          {delta.label && <span className="text-text-tertiary ml-1.5">{delta.label}</span>}
        </div>
      )}
      {trend && trend.length > 1 && (
        <div className="mt-auto pt-3">
          <Sparkline values={trend} width={120} height={24} />
        </div>
      )}
    </Card>
  );
}
