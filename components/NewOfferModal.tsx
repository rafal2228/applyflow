"use client";

import { useState } from "react";
import { DownloadCloud, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ImportedOffer, NewJobInput } from "@/lib/types";

const EMPTY: NewJobInput = {
  title: "",
  company: "",
  url: "",
  sourceUrl: "",
  location: "",
  remote: true,
  salaryText: "",
  description: "",
  tags: [],
  status: "shortlisted",
};

const START_OPTIONS = [
  { value: "new", label: "Inbox" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "parked", label: "Parked" },
  { value: "applied", label: "Applied" },
];

type Mode = "url" | "manual";

export default function NewOfferModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<Mode>("url");
  const [form, setForm] = useState<NewJobInput>(EMPTY);
  const [tagsText, setTagsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  function set<K extends keyof NewJobInput>(key: K, value: NewJobInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function reset() {
    setForm(EMPTY);
    setTagsText("");
    setError("");
    setInfo("");
    setMode("url");
  }

  async function fetchFromUrl() {
    const url = form.url.trim();
    if (!url) return;
    setFetching(true);
    setError("");
    setInfo("");
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not import that URL.");
      const o = data.offer as ImportedOffer;
      setForm((f) => ({
        ...f,
        title: o.title || f.title,
        company: o.company || f.company,
        url: o.url || url,
        sourceUrl: url,
        location: o.location ?? f.location,
        remote: o.remote,
        salaryText: o.salaryText ?? f.salaryText,
        description: o.description || f.description,
        tags: o.tags?.length ? o.tags : f.tags,
        status: "shortlisted",
      }));
      setTagsText((o.tags ?? []).join(", "));
      setInfo(`Imported from ${o.source}. Review and edit below, then add.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFetching(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.title.trim() || !form.company.trim()) {
      setError(
        mode === "url"
          ? "Fetch the details or fill in title and company."
          : "Title and company are required.",
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          tags: tagsText
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save the offer.");
      reset();
      onCreated();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an offer</DialogTitle>
          <DialogDescription>
            Import it from a posting URL, or enter it manually. You can always
            edit the details before saving.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <div className="inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
            {(
              [
                ["url", "Import from URL"],
                ["manual", "Manual"],
              ] as [Mode, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
                  mode === value
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="no-url">Job posting URL</Label>
            <div className="flex gap-2">
              <Input
                id="no-url"
                value={form.url}
                onChange={(e) => set("url", e.target.value)}
                onKeyDown={(e) => {
                  if (mode === "url" && e.key === "Enter") {
                    e.preventDefault();
                    void fetchFromUrl();
                  }
                }}
                placeholder="https://…"
              />
              {mode === "url" && (
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  disabled={fetching || !form.url.trim()}
                  onClick={fetchFromUrl}
                >
                  {fetching ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <DownloadCloud />
                  )}
                  {fetching ? "Fetching…" : "Fetch"}
                </Button>
              )}
            </div>
            {info ? (
              <p className="text-xs text-emerald-600">{info}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {mode === "url"
                  ? "Paste a link and Fetch — we'll fill in the details for you to review."
                  : "Enter the offer details yourself."}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="no-title">Job title *</Label>
              <Input
                id="no-title"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Senior Frontend Engineer"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="no-company">Company *</Label>
              <Input
                id="no-company"
                value={form.company}
                onChange={(e) => set("company", e.target.value)}
                placeholder="Acme"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="no-loc">Location</Label>
              <Input
                id="no-loc"
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="Remote (EU)"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="no-sal">Salary</Label>
              <Input
                id="no-sal"
                value={form.salaryText}
                onChange={(e) => set("salaryText", e.target.value)}
                placeholder="€90–120k"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="no-tags">Tags (comma separated)</Label>
            <Input
              id="no-tags"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="react, typescript, remote"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="no-desc">Description / notes</Label>
            <Textarea
              id="no-desc"
              rows={5}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Markdown welcome — the grader uses this as context."
            />
          </div>

          <div className="grid grid-cols-2 items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={!!form.remote}
                onCheckedChange={(checked) => set("remote", checked === true)}
              />
              Remote role
            </label>
            <div className="grid gap-1.5">
              <Label>Start in column</Label>
              <Select
                items={START_OPTIONS}
                value={form.status}
                onValueChange={(v) => set("status", v as NewJobInput["status"])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {START_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Add offer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
