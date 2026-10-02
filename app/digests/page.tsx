import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import DigestsView from "@/components/DigestsView";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default function DigestsPage() {
  return (
    <div className="flex h-svh flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background/80 px-4 py-2.5 backdrop-blur">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/" />}
        >
          <ArrowLeft />
          Board
        </Button>
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">Digests</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            daily shortlist &amp; market
          </span>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col p-4">
        <DigestsView />
      </main>
    </div>
  );
}
