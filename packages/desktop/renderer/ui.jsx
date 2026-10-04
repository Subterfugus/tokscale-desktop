import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Inbox,
  Search,
  X,
} from "lucide-react";
import { api } from "./use-report.js";
import { money, number, pretty, safeMessage } from "./format.js";
import { filterTableRows } from "./report-data.js";

const cx = (...names) => names.filter(Boolean).join(" ");

export function Button({
  variant,
  small,
  icon: Icon,
  iconEnd: IconEnd,
  spin,
  className,
  children,
  ...props
}) {
  return (
    <button
      type="button"
      className={cx("button", variant, small && "small", className)}
      {...props}
    >
      {Icon && <Icon size={14} className={spin ? "spin" : ""} />}
      {children}
      {IconEnd && <IconEnd size={13} />}
    </button>
  );
}

export function IconButton({ icon: Icon, label, spin, size = 15, ...props }) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon size={size} className={spin ? "spin" : ""} />
    </button>
  );
}

export function Segmented({ options, value, onChange, label, className }) {
  return (
    <div className={cx("segmented", className)} role="group" aria-label={label}>
      {options.map(([id, text, Icon]) => (
        <button
          type="button"
          key={id}
          className={value === id ? "active" : ""}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {Icon && <Icon size={13} />}
          {text}
        </button>
      ))}
    </div>
  );
}

export function Select({ label, prefix, className, children, ...props }) {
  return (
    <label className={cx("select", className)}>
      {prefix && <span>{prefix}</span>}
      <select aria-label={label} {...props}>
        {children}
      </select>
      <ChevronDown size={13} aria-hidden="true" />
    </label>
  );
}

export function SearchField({ value, onChange, placeholder, label }) {
  return (
    <label className="search">
      <Search size={14} aria-hidden="true" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        spellCheck={false}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          <X size={13} />
        </button>
      )}
    </label>
  );
}

export function Card({ title, description, action, children, className }) {
  return (
    <section className={cx("panel", className)}>
      {(title || action) && (
        <div className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {action && <div className="panel-action">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, detail }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export function Badge({ tone, children }) {
  return (
    <span className={cx("badge", tone)}>
      {tone && <i aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Notice({ tone, children, action }) {
  return (
    <div className={cx("notice", tone)} role={tone === "error" ? "alert" : undefined}>
      {tone === "error" && <AlertCircle size={15} />}
      <span>{children}</span>
      {action}
    </div>
  );
}

export function Empty({
  title = "No activity in this period",
  text = "Choose a different date range or client.",
  icon: Icon = Inbox,
  action,
}) {
  return (
    <div className="empty">
      <Icon size={22} strokeWidth={1.5} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function ReportState({ state, children, onRetry }) {
  const error = state.error && (
    <div className="error-state" role="alert">
      <AlertCircle size={18} />
      <div>
        <h3>
          {state.data
            ? "Refresh failed. Showing the last successful report."
            : "This report could not be loaded"}
        </h3>
        <p>{state.error}</p>
      </div>
      {onRetry && (
        <Button small onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
  if (state.error && !state.data) return error;
  if (state.loading && !state.data)
    return (
      <div className="loading-state" role="status" aria-label="Loading report">
        <div className="skeleton-row">
          <i />
          <i />
          <i />
          <i />
        </div>
        <i className="skeleton-block" />
        <i className="skeleton-block short" />
      </div>
    );
  return (
    <div className={state.loading ? "report refreshing" : "report"}>
      {state.loading && <div className="refresh-indicator" role="status" aria-label="Refreshing" />}
      {error}
      {children}
      {state.data?.warnings?.length > 0 && (
        <details className="disclosure">
          <summary>
            {state.data.warnings.length} report notice
            {state.data.warnings.length === 1 ? "" : "s"}
          </summary>
          {state.data.warnings.map((w, i) => (
            <p key={i}>{safeMessage(w)}</p>
          ))}
        </details>
      )}
      {state.data?.diagnostics?.length > 0 && (
        <details className="disclosure">
          <summary>Client diagnostics</summary>
          <pre>{safeMessage(JSON.stringify(state.data.diagnostics, null, 2))}</pre>
        </details>
      )}
    </div>
  );
}

// Toasts replace blocking alert() dialogs for export and action failures.
let toasts = [];
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());
export function toast(message, tone = "info") {
  const id = Date.now() + Math.random();
  toasts = [...toasts.slice(-2), { id, message: safeMessage(message), tone }];
  emit();
  setTimeout(
    () => {
      toasts = toasts.filter((entry) => entry.id !== id);
      emit();
    },
    tone === "error" ? 6000 : 2500,
  );
}
export function Toaster() {
  const list = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => toasts,
  );
  return (
    <div className="toaster" aria-live="polite">
      {list.map((entry) => (
        <div key={entry.id} className={cx("toast", entry.tone)}>
          {entry.tone === "error" ? <AlertCircle size={15} /> : <Check size={15} />}
          {entry.message}
        </div>
      ))}
    </div>
  );
}

export function ExportButton({ data, name = "tokscale-report" }) {
  return (
    <Button
      small
      icon={Download}
      disabled={!data}
      onClick={async () => {
        try {
          const saved = await api.exportFile({
            name: `${name}.json`,
            content: JSON.stringify(data, null, 2),
          });
          if (saved) toast("Report exported");
        } catch (e) {
          toast(e.message, "error");
        }
      }}
    >
      Export
    </Button>
  );
}

export function Popover({
  open,
  onClose,
  label,
  align = "left",
  className,
  children,
}) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement;
    ref.current?.querySelector("input, select, button")?.focus();
    const outside = (event) => {
      // The trigger lives in the same wrapper and toggles the popover itself.
      if (!ref.current?.parentElement?.contains(event.target)) onClose();
    };
    const escape = (event) => event.key === "Escape" && onClose();
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
      // Hand focus back unless the user has already moved it elsewhere.
      if (!document.activeElement || document.activeElement === document.body)
        trigger?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className={cx("popover", align, className)}
      role="dialog"
      aria-label={label}
    >
      {children}
    </div>
  );
}

const MONEY_KEYS = /cost|spent|price/i;
function detailValue(key, value) {
  if (value == null || value === "") return "—";
  if (typeof value === "number")
    return MONEY_KEYS.test(key) ? money(value) : number(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return <code>{JSON.stringify(value)}</code>;
  return String(value);
}
export function RowDetails({ row }) {
  return (
    <dl className="row-details">
      {Object.entries(row).map(([key, value]) => (
        <div key={key}>
          <dt>{pretty(key)}</dt>
          <dd>{detailValue(key, value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DataTable({
  rows,
  columns,
  defaultSort = "cost",
  defaultDirection,
  emptyText,
  summary,
  searchPlaceholder = "Search",
  renderDetails,
  tools,
  initialSearch = "",
}) {
  const [search, setSearch] = useState(initialSearch),
    [sort, setSort] = useState(defaultSort),
    [direction, setDirection] = useState(
      defaultDirection ??
        (columns.find((c) => c.key === defaultSort)?.numeric ? -1 : 1),
    ),
    [expanded, setExpanded] = useState(null),
    [page, setPage] = useState(0);
  const pageSize = 50;
  const filtered = useMemo(
    () => filterTableRows(rows, columns, search, sort, direction),
    [rows, columns, search, sort, direction],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visibleRows = filtered.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  // Rows are often rebuilt on each render, so identity is tracked by content.
  const keyOf = (row) => JSON.stringify(row);
  useEffect(() => {
    if (initialSearch) setSearch(initialSearch);
  }, [initialSearch]);
  useEffect(() => {
    setPage(0);
  }, [rows.length, search]);
  return (
    <>
      <div className="table-tools">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={searchPlaceholder}
          label="Search report"
        />
        {tools}
        <span className="table-summary">
          {number(filtered.length)}
          {search.trim() ? ` of ${number(rows.length)}` : ""}{" "}
          {filtered.length === 1 ? "row" : "rows"}
          {summary ? ` · ${summary}` : ""}
        </span>
      </div>
      {!filtered.length ? (
        <Empty
          title={search ? "No matching rows" : "Nothing recorded"}
          text={
            search
              ? "Try a different search."
              : emptyText || "Choose a different date range or client."
          }
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={c.numeric ? "numeric" : ""}
                    aria-sort={
                      sort === c.key
                        ? direction < 0
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSort(c.key);
                        setDirection(
                          sort === c.key ? -direction : c.numeric ? -1 : 1,
                        );
                        setPage(0);
                      }}
                    >
                      {c.label}
                      {sort === c.key &&
                        (direction < 0 ? (
                          <ArrowDown size={11} />
                        ) : (
                          <ArrowUp size={11} />
                        ))}
                    </button>
                  </th>
                ))}
                <th className="expander">
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const key = keyOf(r),
                  open = expanded === key;
                return (
                  <React.Fragment key={key}>
                    <tr
                      onClick={() => setExpanded(open ? null : key)}
                      className={open ? "selected-row" : ""}
                    >
                      {columns.map((c) => (
                        <td key={c.key} className={c.numeric ? "numeric" : ""}>
                          {c.render ? c.render(r) : (r[c.key] ?? "—")}
                        </td>
                      ))}
                      <td className="expander">
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`${open ? "Hide" : "Show"} row details`}
                          aria-expanded={open}
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpanded(open ? null : key);
                          }}
                        >
                          <ChevronRight
                            size={14}
                            className={open ? "rotate" : ""}
                          />
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="detail-row">
                        <td colSpan={columns.length + 1}>
                          {renderDetails ? renderDetails(r) : <RowDetails row={r} />}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > pageSize && (
        <div className="table-pagination">
          <span>
            {number(currentPage * pageSize + 1)}–
            {number(Math.min((currentPage + 1) * pageSize, filtered.length))} of{" "}
            {number(filtered.length)}
          </span>
          <Button
            small
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </Button>
          <Button
            small
            disabled={currentPage >= pages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </>
  );
}
