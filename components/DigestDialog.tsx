"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function DigestDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/digest", { cache: "no-store" });
    if (res.ok) {
      const d = await res.json();
      setMarkdown(d.markdown);
      setUpdatedAt(d.updatedAt);
    } else {
      setMarkdown(null);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function regenerate() {
    setBusy(true);
    const t = toast.loading("Generating digest…");
    try {
      const res = await fetch("/api/digest", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed");
      setMarkdown(d.markdown);
      setUpdatedAt(d.updatedAt);
      toast.success("Digest updated", { id: t });
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4 pr-8">
            <div>
              <DialogTitle>Daily digest</DialogTitle>
              <DialogDescription>
                {updatedAt ? `Generated ${updatedAt}` : "Shortlist, follow-ups & market"}
              </DialogDescription>
            </div>
            <Button size="xs" variant="outline" disabled={busy} onClick={regenerate}>
              <RefreshCw />
              {busy ? "Working…" : "Regenerate"}
            </Button>
          </div>
        </DialogHeader>

        {markdown ? (
          <ScrollArea className="min-h-0 flex-1 rounded-lg border bg-muted/30">
            <pre className="p-4 text-xs leading-relaxed whitespace-pre-wrap">
              {markdown}
            </pre>
          </ScrollArea>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No digest yet — click “Regenerate”.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
