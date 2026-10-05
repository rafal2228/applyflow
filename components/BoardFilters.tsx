"use client";

import { useMemo } from "react";
import { ListFilter, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DEFAULT_FILTERS,
  countActiveFilters,
  type BoardFiltersState,
} from "@/lib/filters";
import type { Grade, JobRow } from "@/lib/types";

const GEO_LABELS: Record<string, string> = {
  PL: "Poland",
  global: "Global remote",
  EU: "EU",
  US: "United States",
  GB: "United Kingdom",
  DE: "Germany",
};

const GRADE_ITEMS = [
  { value: "all", label: "Any grade" },
  ..."ABCDEF"
    .split("")
    .map((g) => ({ value: g, label: `Grade ${g} or better` })),
];

const GRADED_ITEMS = [
  { value: "all", label: "Any" },
  { value: "graded", label: "Graded only" },
  { value: "ungraded", label: "Ungraded only" },
];

const RECENT_ITEMS = [
  { value: "any", label: "Any time" },
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
];

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} />
      {label}
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  items: { value: string; label: string }[];
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select items={items} value={value} onValueChange={(v) => onChange(v as string)}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function BoardFilters({
  filters,
  onChange,
  jobs,
}: {
  filters: BoardFiltersState;
  onChange: (f: BoardFiltersState) => void;
  jobs: JobRow[];
}) {
  const active = countActiveFilters(filters);
  const set = (patch: Partial<BoardFiltersState>) =>
    onChange({ ...filters, ...patch });

  const sources = useMemo(
    () => Array.from(new Set(jobs.map((j) => j.source))).sort(),
    [jobs],
  );
  const geos = useMemo(
    () =>
      Array.from(
        new Set(jobs.map((j) => j.geo).filter((g): g is string => !!g)),
      ).sort(),
    [jobs],
  );

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" />}>
        <ListFilter />
        Filters
        {active > 0 && (
          <Badge variant="secondary" className="ml-0.5 h-4 px-1.5">
            {active}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-medium">Filters</span>
          <Button
            size="xs"
            variant="ghost"
            disabled={active === 0}
            onClick={() => onChange({ ...DEFAULT_FILTERS })}
          >
            <RotateCcw />
            Reset
          </Button>
        </div>
        <Separator />
        <ScrollArea className="max-h-[65vh]">
          <div className="grid gap-3 p-3">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <Toggle
                label="Has salary"
                checked={filters.salary}
                onChange={(v) => set({ salary: v })}
              />
              <Toggle
                label="Has location"
                checked={filters.location}
                onChange={(v) => set({ location: v })}
              />
              <Toggle
                label="Remote only"
                checked={filters.remote}
                onChange={(v) => set({ remote: v })}
              />
              <Toggle
                label="Has apply link"
                checked={filters.applyLink}
                onChange={(v) => set({ applyLink: v })}
              />
              <Toggle
                label="Tailored"
                checked={filters.tailored}
                onChange={(v) => set({ tailored: v })}
              />
              <Toggle
                label="Follow-up due"
                checked={filters.followUpDue}
                onChange={(v) => set({ followUpDue: v })}
              />
              <Toggle
                label="Hide possible duplicates"
                checked={filters.hideDuplicates}
                onChange={(v) => set({ hideDuplicates: v })}
              />
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-3">
              <SelectField
                label="Graded"
                value={filters.graded}
                onChange={(v) => set({ graded: v as BoardFiltersState["graded"] })}
                items={GRADED_ITEMS}
              />
              <SelectField
                label="Grade at least"
                value={filters.minGrade}
                onChange={(v) =>
                  set({ minGrade: v as "all" | Grade })
                }
                items={GRADE_ITEMS}
              />
              <SelectField
                label="Location type"
                value={filters.geo}
                onChange={(v) => set({ geo: v })}
                items={[
                  { value: "all", label: "Anywhere" },
                  ...geos.map((g) => ({ value: g, label: GEO_LABELS[g] ?? g })),
                ]}
              />
              <SelectField
                label="Posted"
                value={filters.recentDays}
                onChange={(v) =>
                  set({ recentDays: v as BoardFiltersState["recentDays"] })
                }
                items={RECENT_ITEMS}
              />
            </div>

            {sources.length > 0 && (
              <>
                <Separator />
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Sources
                    </span>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={filters.sources.length === 0}
                      onClick={() => set({ sources: [] })}
                    >
                      All
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {sources.map((s) => (
                      <Toggle
                        key={s}
                        label={s}
                        checked={filters.sources.includes(s)}
                        onChange={(on) =>
                          set({
                            sources: on
                              ? [...filters.sources, s]
                              : filters.sources.filter((x) => x !== s),
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
