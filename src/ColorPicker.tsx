import {
  useState,
  useEffect,
  type PointerEvent,
  type CSSProperties,
} from "react";
import { hexRGB, rgbHex } from "./lib/effects";
function hsv(hex: string) {
  const [r, g, b] = hexRGB(hex).map((v) => v / 255),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d)
    h =
      max === r
        ? ((g - b) / d) % 6
        : max === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
function toHex(h: number, s: number, v: number) {
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  const a =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return rgbHex(a.map((n) => (n + m) * 255));
}
export default function ColorPicker({
  color,
  onChange,
}: {
  color: string;
  onChange: (color: string) => void;
}) {
  const selected = hsv(color),
    [lastHue, setLastHue] = useState(85),
    h = selected.s > 0 ? selected.h : lastHue;
  useEffect(() => {
    if (selected.s > 0) setLastHue(selected.h);
  }, [selected.h, selected.s]);
  function change(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    onChange(
      toHex(
        h,
        Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
        1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
      ),
    );
  }
  return (
    <>
      <div
        className="color-field"
        style={{ "--chosen": `hsl(${h} 100% 50%)` } as CSSProperties}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          change(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) change(e);
        }}
      >
        <div className="color-field-shade" />
        <span
          className="color-crosshair"
          style={{
            left: `${selected.s * 100}%`,
            top: `${(1 - selected.v) * 100}%`,
          }}
        />
      </div>
      <div className="hue-strip">
        <input
          aria-label="Hue"
          type="range"
          min="0"
          max="359"
          value={Math.round(h)}
          onChange={(e) => {
            const hue = +e.target.value;
            setLastHue(hue);
            onChange(toHex(hue, selected.s || 1, selected.v || 1));
          }}
        />
      </div>
      <label className="native-color-label">
        Native color picker
        <input
          aria-label="Choose light color"
          type="color"
          value={color}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </>
  );
}
