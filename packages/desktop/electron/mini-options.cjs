"use strict";

// Shared by Settings, the mini window and settings validation.
// Every bubble is decorative only; `renderer/bubbles.jsx` draws each id.
const BUBBLES = [
  { id: "scale", name: "Balance scale" },
  { id: "flower", name: "Flower" },
  { id: "heart", name: "Heart" },
  { id: "star", name: "Star" },
  { id: "cloud", name: "Rain cloud" },
  { id: "moon", name: "Moon" },
  { id: "cherries", name: "Cherries" },
  { id: "planet", name: "Planet" },
];
const DEFAULT_BUBBLE = "scale";
const bubbleId = (value) => (BUBBLES.some((bubble) => bubble.id === value) ? value : DEFAULT_BUBBLE);

const MIN_OPACITY = 30;
// Percent the mini window is drawn at when the pointer is elsewhere.
function opacityPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(MIN_OPACITY, Math.round(number))) : 100;
}

// Limits in the user's saved order; ones they have not placed keep their
// usual order after the placed ones.
function orderLimits(sources, order) {
  const list = Array.isArray(sources) ? sources : [];
  const rank = new Map((Array.isArray(order) ? order : []).map((id, index) => [id, index]));
  return list
    .map((source, index) => ({ source, index, at: rank.has(source?.id) ? rank.get(source.id) : Infinity }))
    .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at - b.at))
    .map((entry) => entry.source);
}

// The saved order after moving one limit to another position in the shown list.
function moveLimit(sources, order, from, to) {
  const ids = orderLimits(sources, order).map((source) => source.id);
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length || from === to) return ids;
  ids.splice(to, 0, ...ids.splice(from, 1));
  return ids;
}

module.exports = { BUBBLES, DEFAULT_BUBBLE, bubbleId, MIN_OPACITY, opacityPercent, orderLimits, moveLimit };
