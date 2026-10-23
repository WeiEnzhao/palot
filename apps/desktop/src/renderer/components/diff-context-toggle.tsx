import { ListCollapse } from "lucide-react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function DiffContextToggle({
  expanded,
  onExpandedChange,
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const label = expanded ? "使用紧凑差异" : "显示未更改的行";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={expanded ? "ghost" : "secondary"}
            size="icon-sm"
            aria-label={label}
            aria-pressed={!expanded}
            onClick={() => onExpandedChange(!expanded)}
          />
        }
      >
        <ListCollapse />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
