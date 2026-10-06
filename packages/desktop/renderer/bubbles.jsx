import React from "react";
import options from "../electron/mini-options.cjs";

export const { BUBBLES, bubbleId } = options;

// A moving piece. It rests untransformed, eases to `hover` under the pointer
// and to `drag` while the bubble is being moved, so it never jumps.
function Part({ origin = "32px 32px", hover, drag, children }) {
  return (
    <g className="bubble-part" style={{ "--origin": origin, "--hover": hover, "--drag": drag || hover }}>
      {children}
    </g>
  );
}

const STAR = Array.from({ length: 10 }, (_, i) => {
  const radius = i % 2 ? 7.5 : 17,
    angle = (Math.PI / 5) * i - Math.PI / 2;
  return `${(32 + radius * Math.cos(angle)).toFixed(2)},${(33 + radius * Math.sin(angle)).toFixed(2)}`;
}).join(" ");

const ART = {
  scale: (
    <>
      <path className="bubble-line" d="M32 17v30M23 48h18" />
      <Part origin="32px 22px" hover="rotate(-4deg)" drag="rotate(6deg)">
        <path className="bubble-line" d="M15 22h34" />
        <Part origin="15px 22px" hover="rotate(4deg)" drag="rotate(-6deg)">
          <path className="bubble-thread" d="M15 22l-6.5 12m6.5-12l6.5 12" />
          <path className="bubble-fill" d="M7.5 34h15a7.5 7.5 0 0 1-15 0z" />
        </Part>
        <Part origin="49px 22px" hover="rotate(4deg)" drag="rotate(-6deg)">
          <path className="bubble-thread" d="M49 22l-6.5 12m6.5-12l6.5 12" />
          <path className="bubble-fill" d="M41.5 34h15a7.5 7.5 0 0 1-15 0z" />
        </Part>
      </Part>
      <circle className="bubble-fill" cx="32" cy="22" r="3" />
    </>
  ),
  flower: (
    <>
      <Part hover="rotate(30deg)" drag="rotate(-30deg)">
        {[0, 60, 120, 180, 240, 300].map((turn) => (
          <ellipse key={turn} className="bubble-soft" cx="32" cy="18.5" rx="6.5" ry="9" transform={`rotate(${turn} 32 32)`} />
        ))}
      </Part>
      <Part hover="scale(1.2)" drag="scale(0.85)">
        <circle className="bubble-fill" cx="32" cy="32" r="6.5" />
      </Part>
    </>
  ),
  heart: (
    <>
      <Part origin="32px 35px" hover="scale(1.12)" drag="scale(0.9)">
        <path className="bubble-fill" d="M32 49C19 39.5 13 32 13 24.5a9.5 9.5 0 0 1 19-2.5a9.5 9.5 0 0 1 19 2.5C51 32 45 39.5 32 49z" />
      </Part>
      <Part origin="49px 15px" hover="scale(1.5) rotate(12deg)" drag="scale(0.7)">
        <path className="bubble-soft" d="M49 20.5c-4-3-6-5.200-6-7.700a3 3 0 0 1 6-.8a3 3 0 0 1 6 .8c0 2.500-2 4.700-6 7.700z" />
      </Part>
    </>
  ),
  star: (
    <>
      <Part origin="32px 33px" hover="rotate(18deg) scale(1.06)" drag="rotate(-18deg) scale(0.94)">
        <polygon className="bubble-fill bubble-round" points={STAR} />
      </Part>
      <Part origin="50px 15px" hover="scale(1.6)" drag="scale(0.6)">
        <circle className="bubble-soft" cx="50" cy="15" r="2.6" />
      </Part>
      <Part origin="13px 47px" hover="scale(1.6)" drag="scale(0.6)">
        <circle className="bubble-soft" cx="13" cy="47" r="2" />
      </Part>
    </>
  ),
  cloud: (
    <>
      <Part hover="translate(2px, -1px)" drag="translate(-3px, 0)">
        <circle className="bubble-fill" cx="23" cy="30" r="9" />
        <circle className="bubble-fill" cx="34" cy="24" r="11.5" />
        <circle className="bubble-fill" cx="44" cy="31" r="8" />
        <rect className="bubble-fill" x="23" y="29" width="21" height="10" />
      </Part>
      {[
        [24, "translateY(3px)"],
        [33, "translateY(5px)"],
        [42, "translateY(2px)"],
      ].map(([x, fall]) => (
        <Part key={x} hover={fall} drag="translateY(-2px)">
          <path className="bubble-soft-line" d={`M${x} 45l-2 5`} />
        </Part>
      ))}
    </>
  ),
  moon: (
    <>
      <Part origin="34px 32px" hover="rotate(-12deg)" drag="rotate(12deg)">
        <path className="bubble-fill" d="M40 14a19 19 0 1 0 10 30a17 17 0 0 1-10-30z" />
      </Part>
      <Part origin="47px 21px" hover="scale(1.5)" drag="scale(0.6)">
        <circle className="bubble-soft" cx="47" cy="21" r="2.6" />
      </Part>
      <Part origin="53px 31px" hover="scale(1.7)" drag="scale(0.6)">
        <circle className="bubble-soft" cx="53" cy="31" r="1.8" />
      </Part>
    </>
  ),
  cherries: (
    <>
      <Part origin="38px 15px" hover="rotate(6deg)" drag="rotate(-8deg)">
        <path className="bubble-soft-line" d="M38 15C30 21 25 27 23 35" />
        <circle className="bubble-fill" cx="22.5" cy="43" r="9" />
      </Part>
      <Part origin="38px 15px" hover="rotate(-6deg)" drag="rotate(8deg)">
        <path className="bubble-soft-line" d="M38 15C41 22 43 27 43 32" />
        <circle className="bubble-fill" cx="43" cy="40.500" r="9" />
      </Part>
      <Part origin="38px 15px" hover="rotate(14deg)" drag="rotate(-14deg)">
        <path className="bubble-soft" d="M38 15c4-6 10-7 14-4c-3 5-9 7-14 4z" />
      </Part>
    </>
  ),
  planet: (
    <>
      <Part hover="rotate(12deg) scale(1.04)" drag="rotate(-12deg) scale(0.96)">
        <circle className="bubble-fill" cx="32" cy="32" r="12" />
      </Part>
      <Part hover="rotate(-10deg)" drag="rotate(14deg)">
        <ellipse className="bubble-soft-line" cx="32" cy="32" rx="23" ry="6.5" transform="rotate(-20 32 32)" />
      </Part>
    </>
  ),
};

export function BubbleArt({ id }) {
  return (
    <svg className="bubble-art" viewBox="0 0 64 64" aria-hidden="true">
      {ART[bubbleId(id)]}
    </svg>
  );
}
