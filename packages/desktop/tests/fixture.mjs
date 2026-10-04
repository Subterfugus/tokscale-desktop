import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Every id in the engine's usage provider registry (commands/usage/mod.rs).
export const USAGE_PROVIDERS = [
  "claude", "codex", "zai", "amp", "antigravity", "copilot", "grok", "kimi",
  "minimax", "minimax-token-plan", "warp", "sakana", "opencode-go",
];

// Fixed, invented activity: 40 sessions, 160 messages, 5,446,000 tokens.
// No credentials, real conversation text, or provider account data.
export async function createFixture(home) {
  const codexRoot = path.join(home, ".codex/sessions");
  const claudeRoot = path.join(home, ".claude/projects/C--Demo-Atlas");
  const configRoot = path.join(home, ".config/tokscale");
  for (const dir of [codexRoot, claudeRoot, configRoot])
    await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(configRoot, "settings.json"),
    JSON.stringify({
      scanner: { bucketTimezone: "America/New_York" },
      // Some providers read sign-ins from the Windows credential store, which
      // a fixture home cannot redirect. Disabling them keeps checks offline.
      usage: { disabledProviders: USAGE_PROVIDERS },
    }),
  );
  const iso = (time) => new Date(time).toISOString();
  const jsonl = (rows) =>
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  // Codex's saved display name can differ from its initial prompt-derived title.
  const index = new DatabaseSync(path.join(home, ".codex/state_5.sqlite"));
  index.exec("CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, title TEXT, name TEXT, rollout_path TEXT)");
  const saveTitle = index.prepare("INSERT OR REPLACE INTO threads (id,title,name,rollout_path) VALUES (?,?,?,?)");
  for (let day = 0; day < 10; day++) {
    const date = Date.UTC(2026, 9, 3 - day);
    const stamp = iso(date).slice(0, 10);
    for (let session = 0; session < 2; session++) {
      const id = `synthetic-codex-${stamp}-${session}`;
      const model = session === 0 ? "gpt-5.4" : "gpt-5.5";
      const cwd = session === 0 ? "C:/Demo/Atlas" : "C:/Demo/Beacon";
      saveTitle.run(id, "Initial synthetic prompt rather than saved chat name", `${session === 0 ? "Atlas" : "Beacon"} planning · ${stamp}`, path.join(codexRoot, `rollout-${id}.jsonl`));
      let time = date + (15 + session * 3) * 3600000;
      const rows = [
        {
          timestamp: iso(time),
          type: "session_meta",
          payload: { id, source: "cli", model_provider: "openai", cwd },
        },
      ];
      let input = 0,
        cached = 0,
        output = 0,
        reasoning = 0;
      for (let turn = 0; turn < 4; turn++) {
        time += 180000;
        rows.push({
          timestamp: iso(time),
          type: "turn_context",
          payload: { turn_id: `${id}-turn-${turn}`, model, cwd },
        });
        const newInput = 12000 + day * 1700 + session * 4600 + turn * 3300;
        const newCached = 4000 + day * 800 + turn * 1000;
        const newOutput = 2500 + session * 1200 + turn * 600;
        const newReasoning = 900 + session * 500 + turn * 200;
        input += newInput;
        cached += newCached;
        output += newOutput;
        reasoning += newReasoning;
        rows.push({
          timestamp: iso(time + 90000),
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: input,
                cached_input_tokens: cached,
                output_tokens: output,
                reasoning_output_tokens: reasoning,
                total_tokens: input + output,
              },
              last_token_usage: {
                input_tokens: newInput,
                cached_input_tokens: newCached,
                output_tokens: newOutput,
                reasoning_output_tokens: newReasoning,
                total_tokens: newInput + newOutput,
              },
            },
          },
        });
      }
      await writeFile(path.join(codexRoot, `rollout-${id}.jsonl`), jsonl(rows));
      const claudeId = `synthetic-claude-${stamp}-${session}`;
      time = date + (17 + session) * 3600000;
      const claudeRows = [
        // Saved title metadata as written by Claude Code; no message text.
        { type: "ai-title", sessionId: claudeId, aiTitle: `Cedar generated · ${stamp}` },
        { type: "custom-title", customTitle: `Cedar review · ${stamp}`, sessionId: claudeId },
      ];
      for (let turn = 0; turn < 4; turn++) {
        time += 240000;
        claudeRows.push({
          type: "user",
          sessionId: claudeId,
          timestamp: iso(time),
          cwd: "C:/Demo/Atlas",
          message: {
            role: "user",
            content:
              "Synthetic demo task; no real conversation or account data.",
          },
        });
        claudeRows.push({
          type: "assistant",
          sessionId: claudeId,
          timestamp: iso(time + 80000),
          cwd: "C:/Demo/Atlas",
          requestId: `${claudeId}-request-${turn}`,
          message: {
            id: `${claudeId}-message-${turn}`,
            role: "assistant",
            model: session === 0 ? "claude-sonnet-4-6" : "claude-opus-4-6",
            content: [{ type: "text", text: "Synthetic completion." }],
            usage: {
              input_tokens: 9000 + day * 1600 + turn * 1700,
              output_tokens: 1800 + turn * 450,
              cache_read_input_tokens: 6500 + day * 1400,
              cache_creation_input_tokens: 2100 + turn * 700,
            },
          },
        });
      }
      await writeFile(
        path.join(claudeRoot, `${claudeId}.jsonl`),
        jsonl(claudeRows),
      );
    }
  }
  index.close();
}
