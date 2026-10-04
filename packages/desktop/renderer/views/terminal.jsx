import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Copy,
  Eraser,
  ExternalLink,
  Play,
  Square,
} from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api } from "../use-report.js";
import { Button, IconButton, Notice, Popover, SearchField } from "../ui.jsx";
import { safeMessage } from "../format.js";

// Arguments are passed directly to the original executable, never a shell.
function parseArgs(text) {
  const args = [];
  let word = "",
    quote = null,
    started = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) {
        quote = null;
        started = true;
      } else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started) {
        args.push(word);
        word = "";
        started = false;
      }
    } else {
      word += c;
      started = true;
    }
  }
  if (quote)
    throw new Error("Close the quoted argument before running the command.");
  if (started) args.push(word);
  if (args[0] === "tokscale" || args[0] === "tokscale.exe") args.shift();
  return args;
}

// Shown until the engine's own help has been parsed.
const FALLBACK_COMMANDS = [
  "models",
  "monthly",
  "hourly",
  "graph",
  "clients",
  "usage",
  "login",
  "logout",
  "whoami",
  "pricing",
  "headless",
  "import",
  "submit",
  "wrapped",
  "config",
].map((name) => ({ name, description: "" }));

// The terminal stays dark in both themes, like the engine's own TUI.
const THEME = {
  background: "#141413",
  foreground: "#e8e6dc",
  cursor: "#e8e6dc",
  selectionBackground: "#4a4944",
  black: "#141413",
  red: "#e66767",
  green: "#5fbf8f",
  yellow: "#d9a441",
  blue: "#6aa5ec",
  magenta: "#c58fd6",
  cyan: "#5cbfc2",
  white: "#e8e6dc",
  brightBlack: "#898781",
};

export function TerminalView({ initialCommand, onCommandConsumed, visible }) {
  const [command, setCommand] = useState(initialCommand || "--help"),
    [status, setStatus] = useState("Ready"),
    [busy, setBusy] = useState(false),
    [help, setHelp] = useState(""),
    [libraryOpen, setLibraryOpen] = useState(false),
    [librarySearch, setLibrarySearch] = useState(""),
    [error, setError] = useState("");
  const terminalElement = useRef(null),
    inputElement = useRef(null),
    term = useRef(null),
    fit = useRef(null),
    session = useRef(null),
    early = useRef([]),
    earlyExit = useRef(new Map()),
    commandRevision = useRef(0),
    running = useRef(false);
  const closeLibrary = useCallback(() => setLibraryOpen(false), []);
  useEffect(() => {
    if (initialCommand) {
      setCommand(initialCommand);
      onCommandConsumed();
    }
  }, [initialCommand]);
  useEffect(() => {
    let live = true;
    api.run(["--no-spinner", "--help"]).then(
      (r) => live && r.code === 0 && setHelp(r.stdout || r.stderr),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const t = new Terminal({
      fontFamily: "Cascadia Mono, Cascadia Code, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      convertEol: true,
      scrollback: 10000,
      theme: THEME,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(terminalElement.current);
    term.current = t;
    fit.current = f;
    t.writeln("\x1b[90mRun a command above, or start the interactive TUI.\x1b[0m");
    const input = t.onData((data) => {
      if (session.current)
        api
          .writeTerminal(session.current, data)
          .catch((e) => setError(safeMessage(e.message)));
    });
    const finished = (code) => {
      session.current = null;
      running.current = false;
      setBusy(false);
      setStatus(`Finished · exit ${code ?? 0}`);
      t.writeln(`\r\n\x1b[90mProcess finished (${code ?? 0}).\x1b[0m`);
    };
    const offData = api.onTerminalData(({ id, data }) => {
      if (session.current === id) t.write(data);
      else if (running.current) early.current.push({ id, data });
    });
    const offExit = api.onTerminalExit(({ id, code }) => {
      if (id === session.current) finished(code);
      else if (running.current) earlyExit.current.set(id, code);
    });
    term.current.finished = finished;
    const ro = new ResizeObserver(() => {
      // A hidden page has no size; fitting then would shrink the PTY.
      if (!terminalElement.current?.offsetWidth) return;
      try {
        f.fit();
        if (session.current) api.resizeTerminal(session.current, t.cols, t.rows);
      } catch {}
    });
    ro.observe(terminalElement.current);
    return () => {
      commandRevision.current++;
      ro.disconnect();
      input.dispose();
      offData();
      offExit();
      if (session.current) api.stopTerminal(session.current);
      t.dispose();
    };
  }, []);
  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => {
      try {
        fit.current?.fit();
        if (session.current)
          api.resizeTerminal(session.current, term.current.cols, term.current.rows);
        (session.current ? term.current : inputElement.current)?.focus();
      } catch {}
    });
  }, [visible]);
  const execute = async (args) => {
    if (running.current) return;
    const revision = ++commandRevision.current;
    setError("");
    try {
      fit.current.fit();
      term.current.reset();
      early.current = [];
      earlyExit.current.clear();
      running.current = true;
      setBusy(true);
      setStatus(args.length ? "Running" : "Interactive TUI");
      const id = await api.startTerminal({
        args,
        cols: term.current.cols,
        rows: term.current.rows,
      });
      if (revision !== commandRevision.current) {
        await api.stopTerminal(id);
        return;
      }
      session.current = id;
      early.current
        .filter((e) => e.id === id)
        .forEach((e) => term.current.write(e.data));
      early.current = [];
      if (earlyExit.current.has(id)) {
        term.current.finished(earlyExit.current.get(id));
        earlyExit.current.delete(id);
      }
      term.current.focus();
    } catch (e) {
      if (revision !== commandRevision.current) return;
      running.current = false;
      setBusy(false);
      setStatus("Unable to start");
      setError(safeMessage(e.message));
    }
  };
  const run = () => {
    try {
      let args = parseArgs(command);
      if (args.length)
        args = ["--no-spinner", ...args.filter((a) => a !== "--no-spinner")];
      execute(args);
    } catch (e) {
      setError(e.message);
    }
  };
  const stop = async () => {
    commandRevision.current++;
    const id = session.current;
    session.current = null;
    running.current = false;
    setBusy(false);
    setStatus("Stopped");
    if (id) {
      try {
        await api.stopTerminal(id);
      } catch (e) {
        setError(safeMessage(e.message));
      }
    }
  };
  const discovered = Array.from(
    help.matchAll(/^\s{2}([a-z][\w-]+)\s{2,}(.+)$/gm),
  ).map((m) => ({ name: m[1], description: m[2] }));
  const library = (discovered.length ? discovered : FALLBACK_COMMANDS).filter(
    (c) =>
      `${c.name} ${c.description}`
        .toLowerCase()
        .includes(librarySearch.trim().toLowerCase()),
  );
  return (
    <div className="terminal-view">
      <div className="command-line">
        <label className="command-input">
          <span>tokscale</span>
          <input
            ref={inputElement}
            aria-label="Tokscale arguments"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && run()}
            placeholder="models --json --today"
            spellCheck={false}
          />
        </label>
        <Button variant="primary" icon={Play} onClick={run} disabled={busy}>
          Run
        </Button>
        <Button onClick={() => execute([])} disabled={busy}>
          Interactive TUI
        </Button>
        <div className="popover-anchor">
          <Button
            icon={BookOpen}
            aria-expanded={libraryOpen}
            onClick={() => setLibraryOpen(!libraryOpen)}
          >
            Commands
          </Button>
          <Popover
            open={libraryOpen}
            onClose={closeLibrary}
            align="right"
            label="Commands"
            className="command-library"
          >
            <SearchField
              value={librarySearch}
              onChange={setLibrarySearch}
              placeholder="Find a command"
              label="Search commands"
            />
            <ul>
              {library.map((c) => (
                <li key={c.name}>
                  <button
                    type="button"
                    onClick={() => {
                      setCommand(c.name === "help" ? "--help" : `${c.name} --help`);
                      setLibraryOpen(false);
                      inputElement.current?.focus();
                    }}
                  >
                    <b>{c.name}</b>
                    <span>{c.description}</span>
                  </button>
                </li>
              ))}
              {!library.length && <li className="muted">No matching commands</li>}
            </ul>
          </Popover>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="terminal-panel">
        <div className="terminal-top">
          <span>
            <i className={busy ? "live-dot" : "idle-dot"} />
            {status}
          </span>
          <div>
            {busy && (
              <IconButton
                icon={Square}
                size={13}
                label="Stop current command"
                onClick={stop}
              />
            )}
            <IconButton
              icon={Copy}
              label="Copy selection"
              onClick={() => {
                const s = term.current?.getSelection();
                if (s) navigator.clipboard.writeText(s);
              }}
            />
            <IconButton
              icon={Eraser}
              label="Clear terminal"
              onClick={() => term.current?.clear()}
            />
            <IconButton
              icon={ExternalLink}
              label="Open Tokscale in a separate terminal window"
              onClick={() =>
                api.launchNative([]).catch((e) => setError(safeMessage(e.message)))
              }
            />
          </div>
        </div>
        <div className="terminal-body" ref={terminalElement} />
      </div>
      <p className="footnote">
        Commands run the bundled Tokscale engine directly, using your normal home
        folder. Ctrl+C interrupts a running command.
      </p>
    </div>
  );
}
