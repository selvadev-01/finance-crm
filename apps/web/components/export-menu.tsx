"use client";

import {
  downloadFile,
  type ExportFormat,
  type RouteDefinition,
  type RouteRequest,
} from "@repo/contracts";
import {
  DownloadSimple,
  FilePdf,
  FileXls,
  SpinnerGap,
} from "@phosphor-icons/react/dist/ssr";
import { Button, Menu, toast } from "@repo/ui";
import { useState } from "react";

import { describeWriteFailure } from "../lib/api-errors";

/** The query a file route takes, less the format the menu chooses. */
type ExportQuery<Route extends RouteDefinition> =
  RouteRequest<Route> extends { query?: infer Query }
    ? Omit<NonNullable<Query>, "format">
    : never;

/**
 * Export ▾ → Excel or PDF, for a page's `actions` (M12). The file is built by
 * the API from the same read as the page, for exactly the filters in `query`,
 * and every export is recorded in the audit log — so the menu says nothing
 * clever, it asks and saves.
 *
 * `disabled` while the page has nothing to export (an invalid range, a view
 * still loading); the API would refuse the same request anyway.
 */
export function ExportMenu<Route extends RouteDefinition & { file: true }>({
  route,
  query,
  disabled = false,
}: {
  route: Route;
  query: ExportQuery<Route>;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState<ExportFormat | null>(null);

  async function run(format: ExportFormat) {
    setPending(format);
    try {
      const result = await downloadFile({ baseUrl: "" }, route, {
        query: { ...query, format },
      } as RouteRequest<Route>);
      if (!result.ok) {
        toast({
          tone: "critical",
          title: "Couldn’t export",
          description:
            describeWriteFailure(result.status, result.body, {}).form ??
            undefined,
        });
        return;
      }
      save(result.blob, result.filename);
    } catch {
      toast({
        tone: "critical",
        title: "Couldn’t export",
        description:
          "Could not reach Rasi. Check your connection and try again.",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          disabled={disabled || pending !== null}
          aria-busy={pending !== null}
        >
          {pending ? (
            <SpinnerGap aria-hidden size={16} className="animate-spin" />
          ) : (
            <DownloadSimple aria-hidden size={16} />
          )}
          {pending ? "Exporting…" : "Export"}
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item onSelect={() => void run("xlsx")}>
          <FileXls aria-hidden size={16} />
          Excel (.xlsx)
        </Menu.Item>
        <Menu.Item onSelect={() => void run("pdf")}>
          <FilePdf aria-hidden size={16} />
          PDF
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

/** Hands the bytes to the browser as a download, then lets them go. */
function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // After the click has been dispatched; revoking at once can cancel it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
