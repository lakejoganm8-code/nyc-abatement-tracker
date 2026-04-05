import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface ScoreBadgeProps {
  score: number
  size?: "sm" | "default"
}

export function ScoreBadge({ score, size = "default" }: ScoreBadgeProps) {
  const variant =
    score >= 75 ? "destructive" :
    score >= 50 ? "secondary" :
    "outline"

  const label = score >= 75 ? "High" : score >= 50 ? "Mid" : "Low"

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "tabular-nums font-semibold",
          score >= 75 ? "text-destructive" :
          score >= 50 ? "text-amber-600 dark:text-amber-400" :
          "text-muted-foreground"
        )}
      >
        {score.toFixed(0)}
      </span>
      <Badge variant={variant} className={size === "sm" ? "text-xs px-1.5" : ""}>
        {label}
      </Badge>
    </span>
  )
}
