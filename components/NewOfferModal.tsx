"use client";

import { useState } from "react";
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
import type { NewJobInput } from "@/lib/types";

const EMPTY: NewJobInput = {
  title: "",
  company: "",
  url: "",
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
  { value: "applied", label: "Applied" },
];

export default function NewOfferModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<NewJobInput>(EMPTY);
  const [tagsText, setTagsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof NewJobInput>(key: K, value: NewJobInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.title.trim() || !form.company.trim()) {
      setError("Title and company are required.");
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
      setForm(EMPTY);
      setTagsText("");
      onCreated();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Track a new offer</DialogTitle>
          <DialogDescription>
            Add a role you found off-pipeline, then grade it in one click.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="no-title">Job title *</Label>
              <Input
                id="no-title"
                autoFocus
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

          <div className="grid gap-1.5">
            <Label htmlFor="no-url">Posting URL</Label>
            <Input
              id="no-url"
              value={form.url}
              onChange={(e) => set("url", e.target.value)}
              placeholder="https://…"
            />
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
              rows={4}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Paste the posting text so the grader has context…"
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
                onValueChange={(v) =>
                  set("status", v as NewJobInput["status"])
                }
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
