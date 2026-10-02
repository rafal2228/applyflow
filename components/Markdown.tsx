"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Renders markdown with typography that matches the app. */
export default function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none dark:prose-invert",
        "prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-h1:mt-0 prose-h1:text-xl prose-h2:text-base prose-h3:text-sm",
        "prose-p:leading-relaxed prose-p:text-muted-foreground",
        "prose-li:text-muted-foreground prose-li:marker:text-muted-foreground/60",
        "prose-a:font-medium prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
        "prose-strong:text-foreground prose-strong:font-semibold",
        "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:font-normal prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-muted prose-pre:text-xs",
        "prose-hr:border-border",
        "prose-table:text-sm prose-th:text-muted-foreground prose-td:align-top",
        "prose-blockquote:border-l-2 prose-blockquote:not-italic prose-blockquote:text-muted-foreground",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
