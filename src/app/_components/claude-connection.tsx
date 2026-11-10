"use client";

import { useEffect, useState } from "react";

import { Button, FormError, friendlyError } from "~/app/_components/form";
import { formatMomentInWords } from "~/lib/format";
import { api } from "~/trpc/react";

/**
 * On My profile: connecting Claude to WeLodge OS (doc §2.10) — the address
 * to add as a connector, how, and the connections that are live, each one
 * disconnected in a click.
 */
export function ClaudeConnectionCard() {
  const utils = api.useUtils();
  const connections = api.user.claudeConnections.useQuery();
  const disconnect = api.user.disconnectClaude.useMutation({ onSuccess: () => void utils.user.claudeConnections.invalidate() });
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const [copied, setCopied] = useState(false);
  const url = `${origin}/api/mcp`;
  const live = connections.data ?? [];

  return (
    <div className="border-ink-200/60 mb-8 rounded-xl border bg-white p-5">
      <h2 className="text-ink-900 text-[15px] font-medium">Claude</h2>
      <p className="text-ink-500 mt-1 mb-3 text-sm font-light">
        Connect Claude to WeLodge OS and ask it to look things up or make everyday changes for you — in your name, each one in the history &ldquo;via
        Claude&rdquo;. It cannot delete anything, buy, block or sell rooms, or make contracts.
      </p>
      <ol className="text-ink-700 mb-3 list-decimal space-y-1 pl-5 text-sm font-light">
        <li>
          In Claude (claude.ai or the app): <span className="font-medium">Settings → Connectors → Add custom connector</span>.
        </li>
        <li>
          Name it <span className="font-medium">WeLodge OS</span> and paste this address:{" "}
          <code className="bg-ink-50 rounded px-1.5 py-0.5 text-xs">{url}</code>{" "}
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(url).then(() => (setCopied(true), setTimeout(() => setCopied(false), 2000)))}
            className="text-brand-700 text-xs font-medium hover:underline"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </li>
        <li>
          Press <span className="font-medium">Connect</span>, sign in to WeLodge if asked, and <span className="font-medium">Allow</span>.
        </li>
      </ol>
      {live.length > 0 ? (
        <div className="border-ink-200/60 border-t pt-3">
          <p className="text-ink-900 text-[13px] font-medium">Connected</p>
          <ul className="mt-1 space-y-1 text-sm font-light">
            {live.map((connection) => (
              <li key={connection.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {connection.client.name ?? "Claude"} · since {formatMomentInWords(connection.createdAt)}
                  {connection.lastUsedAt ? ` · last used ${formatMomentInWords(connection.lastUsedAt)}` : ""}
                </span>
                <Button type="button" variant="ghost" disabled={disconnect.isPending} onClick={() => disconnect.mutate({ clientId: connection.client.id })}>
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-ink-500 text-xs font-light">{connections.isLoading ? "…" : "Not connected."}</p>
      )}
      {disconnect.error && <FormError message={friendlyError(disconnect.error)} />}
    </div>
  );
}
