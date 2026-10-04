import React, { useState } from "react";
import { Empty } from "./ui.jsx";
import { pct } from "./format.js";

// Categorical slots are assigned in this fixed order and never cycled.
export const SERIES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--series-${n})`);

function niceTicks(max) {
  if (!(max > 0)) return [0, 1];
  const rough = max / 4,
    power = 10 ** Math.floor(Math.log10(rough)),
    step = [1, 2, 2.5, 5, 10].find((m) => m * power >= rough) * power;
  const ticks = [];
  for (let v = 0; v < max + step - step / 1e6; v += step)
    ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

const OTHER = "__other";
// Colour follows the entity: keys are ranked by chart-wide total, the first
// six take series slots and the rest fold into one "Other" segment.
function stackModel(entries, segments) {
  const per = entries.map((entry) =>
    (segments(entry) || []).filter((s) => Number(s.value) > 0),
  );
  const totals = new Map(),
    labels = new Map();
  for (const list of per)
    for (const s of list) {
      totals.set(s.key, (totals.get(s.key) || 0) + Number(s.value));
      labels.set(s.key, s.label);
    }
  const keys = [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a));
  const legend = keys
    .slice(0, 6)
    .map((key, i) => ({ key, label: labels.get(key), color: SERIES[i] }));
  const slot = new Map(legend.map((item, i) => [item.key, i]));
  if (keys.length > 6)
    legend.push({ key: OTHER, label: "Other", color: "var(--text-3)" });
  const bars = per.map((list) => {
    const out = [];
    let rest = 0;
    for (const s of list) {
      const value = Number(s.value);
      if (slot.has(s.key)) out.push({ ...legend[slot.get(s.key)], value });
      else rest += value;
    }
    out.sort((a, b) => slot.get(a.key) - slot.get(b.key));
    if (rest) out.push({ ...legend.at(-1), value: rest });
    return out;
  });
  return { legend, bars };
}

export function BarChart({
  entries,
  value,
  label,
  format,
  axisFormat = format,
  title,
  height = 220,
  segments,
  onSelect,
  onLegendSelect,
  legendSelectable,
}) {
  const [hover, setHover] = useState(null);
  if (!entries.length) return <Empty />;
  const values = entries.map((entry) => Number(value(entry)) || 0);
  const ticks = niceTicks(Math.max(...values, 0));
  const top = ticks.at(-1);
  const n = entries.length;
  // Aim for at most six date labels; the first and last are always shown.
  const every = Math.max(1, Math.ceil((n - 1) / 5));
  const labelled = entries
    .map((_, i) => i)
    .filter((i) => i === n - 1 || (i % every === 0 && n - 1 - i >= every));
  const active = hover != null && hover < n ? hover : null;
  const at = active == null ? 0 : (active + 0.5) / n;
  const stack = segments ? stackModel(entries, segments) : null;
  const stacked = stack?.legend.length > 0;
  return (
    <figure className="chart" aria-label={title}>
      <div className="chart-body" style={{ height }}>
        <div className="chart-y" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ bottom: `${(tick / top) * 100}%` }}>
              {axisFormat(tick)}
            </span>
          ))}
        </div>
        <div className="chart-plot" onMouseLeave={() => setHover(null)}>
          {ticks.map((tick) => (
            <i
              key={tick}
              className="chart-grid"
              style={{ bottom: `${(tick / top) * 100}%` }}
            />
          ))}
          <div className={n > 60 ? "chart-bars dense" : "chart-bars"}>
            {values.map((v, i) => {
              const select = () => onSelect(entries[i]);
              return (
                <div
                  key={i}
                  {...(onSelect
                    ? {
                        role: "button",
                        tabIndex: 0,
                        onClick: select,
                        onFocus: () => setHover(i),
                        onKeyDown: (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            select();
                          }
                        },
                      }
                    : { role: "img" })}
                  aria-label={`${label(entries[i])}: ${format(v)}`}
                  className={
                    (active === i ? "chart-slot active" : "chart-slot") +
                    (onSelect ? " selectable" : "")
                  }
                  onMouseEnter={() => setHover(i)}
                >
                  <div
                    className={stacked ? "chart-bar stacked" : "chart-bar"}
                    style={{ height: v ? `max(2px, ${(v / top) * 100}%)` : 0 }}
                  >
                    {stacked &&
                      stack.bars[i].map((s) => (
                        <i
                          key={s.key}
                          style={{ flexGrow: s.value, background: s.color }}
                        />
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
          {active != null && (
            <div
              className={stacked ? "chart-tooltip stacked" : "chart-tooltip"}
              style={{
                left: `${at * 100}%`,
                transform: `translateX(${at < 0.18 ? "0" : at > 0.82 ? "-100%" : "-50%"})`,
              }}
            >
              {stacked ? (
                <>
                  <span className="tip-head">{label(entries[active])}</span>
                  {[...stack.bars[active]].reverse().map((s) => (
                    <div className="tip-row" key={s.key}>
                      <i style={{ background: s.color }} />
                      <span>{s.label}</span>
                      <b>{format(s.value)}</b>
                    </div>
                  ))}
                  <div className="tip-row total">
                    <span>Total</span>
                    <b>{format(values[active])}</b>
                  </div>
                </>
              ) : (
                <>
                  <span>{label(entries[active])}</span>
                  <b>{format(values[active])}</b>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="chart-x" aria-hidden="true">
        {labelled.map((i) => (
          <span
            key={i}
            className={n > 20 && i === n - 1 ? "edge" : ""}
            style={{ left: `${((i + 0.5) / n) * 100}%` }}
          >
            {label(entries[i])}
          </span>
        ))}
      </div>
      {stacked && (
        <ul className="chart-legend">
          {stack.legend.map((item) => (
            <li key={item.key}>
              {onLegendSelect &&
              item.key !== OTHER &&
              (!legendSelectable || legendSelectable(item.key)) ? (
                <button
                  type="button"
                  title={`Filter to ${item.label}`}
                  onClick={() => onLegendSelect(item.key)}
                >
                  <i style={{ background: item.color }} />
                  <span>{item.label}</span>
                </button>
              ) : (
                <span className="legend-item">
                  <i style={{ background: item.color }} />
                  <span>{item.label}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

// One stacked bar plus a legend carrying every value, so identity never
// depends on colour alone.
export function ShareBar({ items, format, onSelect }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="share">
      <div className="share-bar" role="img" aria-label="Share of total">
        {items
          .filter((item) => item.value > 0)
          .map((item) => (
            <i
              key={item.label}
              style={{ flexGrow: item.value, background: item.color }}
              title={`${item.label}: ${format(item.value)}`}
            />
          ))}
      </div>
      <ul className="share-legend">
        {items.map((item) => {
          const row = (
            <>
              <i style={{ background: item.color }} />
              <span>{item.label}</span>
              <b>{format(item.value)}</b>
              <small>{total ? pct((item.value / total) * 100) : "—"}</small>
            </>
          );
          return onSelect && item.id ? (
            <li key={item.label} className="clickable">
              <button
                type="button"
                className="share-row"
                title={`Show ${item.label} in Models`}
                onClick={() => onSelect(item)}
              >
                {row}
              </button>
            </li>
          ) : (
            <li key={item.label}>{row}</li>
          );
        })}
      </ul>
    </div>
  );
}

export function Meter({ label, value, detail }) {
  const used = Math.max(0, Math.min(100, Number(value) || 0));
  const tone = used >= 90 ? "critical" : used >= 75 ? "warning" : "";
  return (
    <div className={`meter ${tone}`}>
      <div className="meter-head">
        <span>{label}</span>
        <b>{used.toFixed(1)}% used</b>
      </div>
      <div
        className="meter-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(used)}
      >
        <i style={{ width: `${used}%` }} />
      </div>
      {detail && <small>{detail}</small>}
    </div>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function Heatmap({ cells, valueOf, describe, selected, onSelect }) {
  const max = Math.max(
    1,
    ...cells.map((cell) => (cell?.contribution ? valueOf(cell.contribution) : 0)),
  );
  const level = (v) => (v > 0 ? Math.min(4, Math.ceil((v / max) * 4)) : 0);
  const weeks = Math.ceil(cells.length / 7);
  return (
    <div className={weeks <= 12 ? "heatmap-wrap large" : "heatmap-wrap"}>
      <div className="heatmap-days" aria-hidden="true">
        {WEEKDAYS.map((day, i) => (
          <span key={day}>{i % 2 ? day : ""}</span>
        ))}
      </div>
      <div className="heatmap">
        {cells.map((cell, index) => {
          if (!cell)
            return <span key={`pad-${index}`} className="heatmap-pad" />;
          const active = cell.contribution;
          return (
            <button
              type="button"
              key={cell.date}
              disabled={!active}
              data-level={active ? level(valueOf(active)) : 0}
              className={selected === cell.date ? "selected" : ""}
              title={describe(cell)}
              aria-label={describe(cell)}
              onClick={() => onSelect(selected === cell.date ? null : cell.date)}
            />
          );
        })}
      </div>
      <div className="heatmap-scale" aria-hidden="true">
        Less
        {[0, 1, 2, 3, 4].map((step) => (
          <i key={step} data-level={step} />
        ))}
        More
      </div>
    </div>
  );
}

export function TrendLines({ points, series, label }) {
  const start = points[0].timestamp,
    span = points.at(-1).timestamp - start || 1;
  return (
    <figure className="trend">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={label}>
        {[0, 50, 100].map((y) => (
          <line key={y} x1="0" x2="100" y1={y} y2={y} className="trend-grid" />
        ))}
        {series.map(({ field, color }) => (
          <polyline
            key={field}
            fill="none"
            stroke={color}
            points={points
              .filter((point) => Number.isFinite(point[field]))
              .map(
                (point) =>
                  `${((point.timestamp - start) / span) * 100},${100 - Math.min(100, Math.max(0, point[field]))}`,
              )
              .join(" ")}
          />
        ))}
      </svg>
      <figcaption>
        {series.map(({ field, color, name }) => (
          <span key={field}>
            <i style={{ background: color }} />
            {name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
