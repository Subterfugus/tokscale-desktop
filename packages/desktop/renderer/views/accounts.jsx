import React, { useMemo, useState } from "react";
import { TerminalSquare } from "lucide-react";
import { useReport } from "../use-report.js";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Empty,
  ReportState,
  Segmented,
} from "../ui.jsx";
import { Meter } from "../charts.jsx";
import {
  ClaudeDesktopCard,
  ConnectionCards,
  OpenRouterCard,
} from "../connections.jsx";
import { brand, compact, dateTime, number, safeMessage } from "../format.js";

const DIAGNOSTICS = "usage --light";
// Quota providers the engine reports that this app does not show. The tray
// limit status in electron/main.cjs skips the same ones. The engine and
// Terminal are unaffected.
const HIDDEN_PROVIDERS = ["copilot"];

function creditText(credit) {
  if (credit.unlimited) return "Unlimited";
  const value =
    credit.balance ??
    (credit.has_credits == null
      ? "Not reported"
      : credit.has_credits
        ? "Available"
        : "None");
  return `${value}${credit.overage_limit_reached ? " · overage limit reached" : ""}`;
}

export function Limits({ epoch, refresh, toCommand }) {
  const state = useReport(["usage", "--json"], epoch);
  const rows = (Array.isArray(state.data) ? state.data : []).filter(
    (r) => !HIDDEN_PROVIDERS.includes(String(r.provider).toLowerCase()),
  );
  return (
    <>
      <div className="connection-grid two">
        <ClaudeDesktopCard epoch={epoch} />
        <OpenRouterCard epoch={epoch} />
      </div>
      <div className="section-head">
        <h2>Other providers</h2>
        <Button
          small
          variant="ghost"
          icon={TerminalSquare}
          onClick={() => toCommand(DIAGNOSTICS)}
        >
          Run diagnostics
        </Button>
      </div>
      <ReportState state={state} onRetry={refresh}>
        {!rows.length ? (
          <Card>
            <Empty
              title="No quota data from other providers"
              text="The engine leaves out providers that fail to respond or are not signed in. Run diagnostics to see each provider's status."
            />
          </Card>
        ) : (
          <div className="connection-grid two">
            {rows.map((r, i) => (
              <Card
                key={i}
                title={brand(r.provider)}
                description={[r.plan, r.account?.label, r.email]
                  .filter(Boolean)
                  .join(" · ")}
                action={
                  <Badge tone="good">
                    {r.account?.is_active ? "Active" : "Connected"}
                  </Badge>
                }
              >
                <div className="connection-body">
                  {r.metrics?.map((m, j) => (
                    <Meter
                      key={j}
                      label={m.label}
                      value={m.used_percent}
                      detail={[
                        m.remaining_label,
                        m.resets_at ? `Resets ${dateTime(m.resets_at)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                  ))}
                  {r.credit_status && (
                    <p className="connection-line">
                      <span>Credits</span>
                      <b>{creditText(r.credit_status)}</b>
                    </p>
                  )}
                  {r.spend_control && (
                    <p className="connection-line">
                      <span>Spend limit</span>
                      <b>
                        {r.spend_control.individual_limit ?? "Not reported"}
                        {r.spend_control.reached ? " · reached" : ""}
                      </b>
                    </p>
                  )}
                  {r.reset_credits && (
                    <details className="disclosure">
                      <summary>
                        {r.reset_credits.available_count} reset credits available
                      </summary>
                      <pre>{JSON.stringify(r.reset_credits.credits, null, 2)}</pre>
                    </details>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </ReportState>
      <p className="footnote">
        Limits are live account figures. The date and client filters on report
        pages do not apply here.
      </p>
    </>
  );
}

const HELP_CLIENTS = ["codex", "cursor", "trae", "warp", "antigravity", "hindsight"];
const ACCOUNT_COMMANDS = [
  "codex accounts --help",
  "cursor accounts --help",
  "login --help",
  "logout --help",
  "whoami",
  "headless --help",
  "import --help",
];

export function Connections({ epoch, refresh, toCommand, home }) {
  const state = useReport(
      ["clients", "--json", ...(home ? ["--home", home] : [])],
      epoch,
    ),
    [catalog, setCatalog] = useState("detected");
  const all = state.data?.clients || [];
  const rows = useMemo(
    () =>
      all
        .filter(
          (r) => catalog === "all" || r.messageCount > 0 || r.sessionsPathExists,
        )
        .map((r) => ({ ...r, name: r.label || brand(r.client) })),
    [state.data, catalog],
  );
  const columns = useMemo(
    () => [
      { key: "name", label: "Client", render: (r) => <b>{r.name}</b> },
      {
        key: "status",
        label: "Status",
        sortValue: (r) => (r.messageCount ? 2 : r.sessionsPathExists ? 1 : 0),
        render: (r) =>
          r.messageCount ? (
            <Badge tone="good">Activity found</Badge>
          ) : (
            <Badge>{r.sessionsPathExists ? "Folder found" : "Not detected"}</Badge>
          ),
      },
      {
        key: "messageCount",
        label: "Messages",
        numeric: true,
        render: (r) => compact(r.messageCount),
      },
      {
        key: "sessionsPath",
        label: "Location",
        render: (r) => (
          <code className="path" title={r.sessionsPath}>
            {r.sessionsPath || "—"}
          </code>
        ),
      },
    ],
    [],
  );
  return (
    <>
      <ConnectionCards epoch={epoch} refresh={refresh} />
      <div className="section-head">
        <h2>Local clients</h2>
        <Button
          small
          variant="ghost"
          icon={TerminalSquare}
          onClick={() => toCommand("clients")}
        >
          Run diagnostics
        </Button>
      </div>
      <ReportState state={state} onRetry={refresh}>
        <Card className="table-card">
          <DataTable
            rows={rows}
            columns={columns}
            defaultSort="messageCount"
            searchPlaceholder="Search clients"
            emptyText="No local clients were detected. Switch to All supported to see every location Tokscale scans."
            tools={
              <Segmented
                label="Client list"
                value={catalog}
                onChange={setCatalog}
                options={[
                  ["detected", "Detected"],
                  ["all", `All supported (${all.length})`],
                ]}
              />
            }
            renderDetails={(r) => (
              <div className="client-details">
                {r.headlessSupported && (
                  <p>
                    Headless capture supported ·{" "}
                    {number(r.headlessMessageCount)} messages
                  </p>
                )}
                {r.exporterStatus && (
                  <p>
                    Exporter:{" "}
                    {typeof r.exporterStatus === "string"
                      ? r.exporterStatus
                      : JSON.stringify(r.exporterStatus)}
                  </p>
                )}
                <pre>
                  {safeMessage(
                    JSON.stringify(
                      {
                        sessionsPath: r.sessionsPath,
                        additionalPaths: r.additionalPaths,
                        legacyPaths: r.legacyPaths,
                        headlessPaths: r.headlessPaths,
                        extraPaths: r.extraPaths,
                        diagnostics: r.diagnostics,
                      },
                      null,
                      2,
                    ),
                  )}
                </pre>
                <Button
                  small
                  icon={TerminalSquare}
                  onClick={() =>
                    toCommand(
                      HELP_CLIENTS.includes(r.client)
                        ? `${r.client} --help`
                        : "clients --help",
                    )
                  }
                >
                  Commands for this client
                </Button>
              </div>
            )}
          />
        </Card>
        {state.data?.note && <p className="footnote">{state.data.note}</p>}
      </ReportState>
      <Card
        title="Account commands"
        description="Sign-in and import tools from the Tokscale engine. Each opens in Terminal so you can review it before running."
      >
        <div className="chip-row">
          {ACCOUNT_COMMANDS.map((command) => (
            <Button key={command} small onClick={() => toCommand(command)}>
              {command.replace(" --help", "")}
            </Button>
          ))}
        </div>
      </Card>
    </>
  );
}
