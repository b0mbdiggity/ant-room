"use client";

import { useEffect, useRef, useState } from "react";
import { candles } from "./candles";

type Point = [number, number, number];
type Seat = { slot: number; guest: string };

export default function Scene({ seats, slot, ticker, selected, onSelect }: {
  seats: Seat[]; slot: number | null; ticker: string; selected: number; onSelect: (index: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const data = useRef({ seats, slot, ticker, selected, onSelect });
  const keys = useRef(new Set<string>());
  const [supported, setSupported] = useState(true);

  useEffect(() => { data.current = { seats, slot, ticker, selected, onSelect }; }, [seats, slot, ticker, selected, onSelect]);

  useEffect(() => {
    const element = canvas.current!;
    const context = element.getContext("2d", { alpha: false });
    if (!context) { setSupported(false); return; }
    const ctx = context;
    let width = 0, height = 0, scale = 1;
    let x = 0, y = 3.3, z = 17.5, yaw = 0, pitch = -.20;
    let playerX = 0, playerZ = 12;
    const followDistance = 5.5;

    function followPlayer() {
      x = playerX - Math.sin(yaw) * followDistance;
      y = 3.1;
      z = playerZ + Math.cos(yaw) * followDistance;
    }
    let frame = 0, previous = 0, dirty = true;
    let pointer: { x: number; y: number; moved: boolean } | null = null;
    let lastData = data.current;
    let lastSlot: number | null = null;
    const pressed = keys.current;
    const seatPosition = (seat: number): [number, number] => [
      ((seat - 1) % 10 - 4.5) * 1.75,
      Math.floor((seat - 1) / 10) * 1.33 + 1.7,
    ];
    function resize() {
      width = element.clientWidth;
      height = element.clientHeight;
      scale = Math.min(devicePixelRatio || 1, 1.5);
      element.width = width * scale;
      element.height = height * scale;
      dirty = true;
    }
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();

    function camera([px, py, pz]: Point): Point {
      const dx = px - x, dy = py - y, dz = z - pz;
      const horizontal = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const depth = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      return [horizontal, dy * Math.cos(pitch) - depth * Math.sin(pitch), depth * Math.cos(pitch) + dy * Math.sin(pitch)];
    }
    function project([px, py, depth]: Point) {
      const factor = Math.min(width * .87, height * .93) / depth;
      return { x: width / 2 + px * factor, y: height / 2 - py * factor, factor };
    }
    function polygon(points: Point[], color: string, fill = true) {
      const view = points.map(camera);
      const clipped: Point[] = [];
      for (let i = 0; i < view.length; i++) {
        const a = view[i], b = view[(i + 1) % view.length];
        if (a[2] >= .18) clipped.push(a);
        if ((a[2] >= .18) !== (b[2] >= .18)) {
          const t = (.18 - a[2]) / (b[2] - a[2]);
          clipped.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, .18]);
        }
      }
      if (clipped.length < 2) return [];
      ctx.beginPath();
      clipped.map(project).forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      if (fill) { ctx.fillStyle = color; ctx.fill(); }
      else { ctx.strokeStyle = color; ctx.stroke(); }
      return clipped.map(project);
    }
    function rect(left: number, right: number, bottom: number, top: number, depth: number, color: string) {
      return polygon([[left,bottom,depth],[right,bottom,depth],[right,top,depth],[left,top,depth]], color);
    }
    function label(value: string, point: Point, size: number, color: string) {
      const view = camera(point);
      if (view[2] < .2) return;
      const p = project(view);
      ctx.font = `600 ${Math.min(70, p.factor * size)}px monospace`;
      ctx.fillStyle = color;
      ctx.fillText(value, p.x, p.y);
    }
    function draw() {
      const current = data.current;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = "#f4f8f9";
      ctx.fillRect(0, 0, width, height);
      polygon([[-11,0,-2],[11,0,-2],[11,0,19],[-11,0,19]], "#e5edef");
      polygon([[-11,0,-2],[-11,9,-2],[-11,9,19],[-11,0,19]], "#dce7e9");
      polygon([[11,0,-2],[11,9,-2],[11,9,19],[11,0,19]], "#e8f0f1");
      rect(-11,11,0,9,-2,"#f6f9fa");
      rect(-11,11,0,9,19,"#e4edf0");
      polygon([[-11,9,-2],[11,9,-2],[11,9,19],[-11,9,19]], "#f9fcfc");
      for (let row = 0; row <= 18; row++) polygon([[-11,.008,row],[11,.008,row]], "#cedde1", false);
      for (let col = -10; col <= 10; col++) polygon([[col,.01,-2],[col,.01,19]], "#d2e0e3", false);
      for (const side of [-1, 1]) {
        rect(side * 9.6 - .58, side * 9.6 + .58, 0, 8, -1.85, "#e0ecef");
        rect(side * 9.6 - .17, side * 9.6 + .17, 3, 6.8, -1.8, "#ffffff");
      }
      rect(-8.6,8.6,1.9,8.05,-1.65,"#c9dadd");
      rect(-8.43,8.43,2.05,7.9,-1.6,"#ffffff");
      label(`${current.ticker}   /   DEMO MARKET`, [-7.8,7.23,-1.55], .32, "#314b53");
      for (let row = 0; row < 5; row++) polygon([[-7.8,2.75 + row,-1.54],[7.8,2.75 + row,-1.54]], "#dfebee", false);
      const chartY = (price: number) => 2.72 + (price - 38) * .056;
      if (z > -1.5) candles.forEach((candle, index) => {
        const cx = -7.55 + index * .48;
        if (index === current.selected) rect(cx-.23,cx+.23,2.55,6.85,-1.53,"#e6f3ee");
        const color = candle.close >= candle.open ? "#21806c" : "#cb6e63";
        polygon([[cx,chartY(candle.low),-1.5],[cx,chartY(candle.high),-1.5]], color, false);
        rect(cx-.13,cx+.13,chartY(Math.min(candle.open,candle.close)),chartY(Math.max(candle.open,candle.close))+.022,-1.48,color);
      });
      // Ants use low-cost billboards sorted by camera depth.
      const occupants = new Map(current.seats.map(seat => [seat.slot, seat]));
      const props = Array.from({ length: 100 }, (_, i) => {
        const [sx, sz] = seatPosition(i + 1);
        return { view: camera([sx, .06, sz]), occupant: occupants.has(i + 1) && i + 1 !== current.slot, own: false };
      });
      if (current.slot !== null) props.push({ view: camera([playerX, .06, playerZ]), occupant: true, own: true });
      const visible = props.filter(prop => prop.view[2] > .32).sort((a,b) => b.view[2] - a.view[2]);
      for (const prop of visible) {
        const p = project(prop.view);
        if (p.x < -80 || p.x > width + 80 || p.y < -80 || p.y > height + 100) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(p.factor, p.factor);
        const oval = (cx: number, cy: number, rx: number, ry: number, color: string) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.ellipse(cx,cy,rx,ry,0,0,2*Math.PI);
          ctx.fill();
        };
        oval(0,0,.47,.13,"#ccdadd");
        oval(0,-.09,.41,.12,prop.own ? "#57b09b" : "#d4e2e5");
        if (prop.occupant || prop.own) {
          ctx.strokeStyle = "#243b42";
          ctx.lineWidth = .055;
          ctx.beginPath();
          for (const side of [-1, 1]) {
            for (let i = 0; i < 3; i++) {
              ctx.moveTo(side*.12,-.38-i*.09);
              ctx.lineTo(side*(.32+i*.045),-.30-i*.13);
              ctx.lineTo(side*(.45+i*.035),-.13-i*.095);
            }
            ctx.moveTo(side*.11,-.91);
            ctx.lineTo(side*.25,-1.12);
            ctx.lineTo(side*.34,-1.12);
          }
          ctx.stroke();
          oval(0,-.34,.28,.25,prop.own ? "#17665d" : "#34535c");
          oval(0,-.57,.17,.18,"#4d6d76");
          oval(0,-.79,.245,.2,"#668691");
          if (prop.own) {
            ctx.font = "700 .17px sans-serif";
            ctx.textAlign = "center";
            ctx.fillStyle = "#17665d";
            ctx.fillText("나", 0, -1.29);
          } else {
            oval(-.085,-.82,.032,.044,"#102b33");
            oval(.085,-.82,.032,.044,"#102b33");
          }
        }
        ctx.restore();
      }
    }
    function tick(now: number) {
      const dt = Math.min((now - previous) / 1000, .05);
      previous = now;
      if (data.current.slot !== lastSlot) {
        pressed.clear();
        playerX = 0; playerZ = 12; yaw = 0; pitch = -.20;
        if (data.current.slot !== null) followPlayer();
        else { x = 0; y = 3.3; z = 17.5; }
        dirty = true;
      }
      lastSlot = data.current.slot;
      if (data.current.slot !== null && pressed.size) {
        const forward = Number(pressed.has("w") || pressed.has("ArrowUp")) - Number(pressed.has("s") || pressed.has("ArrowDown"));
        const strafe = Number(pressed.has("d")) - Number(pressed.has("a"));
        yaw += (Number(pressed.has("ArrowRight")) - Number(pressed.has("ArrowLeft"))) * dt * 1.6;
        const speed = dt * 4 / (forward && strafe ? Math.SQRT2 : 1);
        playerX = Math.max(-5.3, Math.min(5.3, playerX + (Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * speed));
        playerZ = Math.max(4.3, Math.min(13.3, playerZ + (-Math.cos(yaw) * forward + Math.sin(yaw) * strafe) * speed));
        followPlayer();
        dirty = true;
      }
      if (dirty || lastData !== data.current) { draw(); dirty = false; lastData = data.current; }
      frame = requestAnimationFrame(tick);
    }
    const key = (event: KeyboardEvent, down: boolean) => {
      const value = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (!["w","a","s","d","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(value)) return;
      if (!down) { pressed.delete(value); return; }
      if (data.current.slot === null || (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable]"))) return;
      event.preventDefault();
      pressed.add(value);
    };
    const down = (event: KeyboardEvent) => key(event, true);
    const up = (event: KeyboardEvent) => key(event, false);
    const blur = () => pressed.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    element.onpointerdown = event => {
      pointer = { x: event.clientX, y: event.clientY, moved: false };
      element.setPointerCapture(event.pointerId);
    };
    element.onpointermove = event => {
      if (!pointer || data.current.slot === null) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      if (!pointer.moved && Math.hypot(dx,dy) < 3) return;
      yaw -= dx * .006;
      pitch = Math.max(-.5, Math.min(-.13, pitch + dy * .004));
      followPlayer();
      pointer = { x: event.clientX, y: event.clientY, moved: true };
      dirty = true;
    };
    element.onpointerup = event => {
      if (pointer && !pointer.moved) {
        const box = element.getBoundingClientRect();
        const focal = Math.min(width * .87, height * .93);
        const horizontal = (event.clientX - box.left - width / 2) / focal;
        const vertical = (height / 2 - event.clientY + box.top) / focal;
        const depth = Math.cos(pitch) - vertical * Math.sin(pitch);
        const rayX = horizontal * Math.cos(yaw) + depth * Math.sin(yaw);
        const rayY = vertical * Math.cos(pitch) + Math.sin(pitch);
        const rayZ = horizontal * Math.sin(yaw) - depth * Math.cos(yaw);
        if (rayZ < -.001) {
          const distance = (-1.48 - z) / rayZ;
          const chartX = x + rayX * distance;
          const chartY = y + rayY * distance;
          const index = Math.floor((chartX + 7.79) / .48);
          if (chartY >= 2.55 && chartY <= 6.85 && index >= 0 && index < candles.length) {
            data.current.onSelect(index);
          }
        }
      }
      pointer = null;
    };
    element.onpointercancel = () => { pointer = null; };
    frame = requestAnimationFrame(tick);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      element.onpointerdown = element.onpointermove = element.onpointerup = element.onpointercancel = null;
    };
  }, []);

  return <>
    <canvas ref={canvas} aria-label="개미 관측소 3D 공간과 캔들 차트" />
    {!supported && <p>이 브라우저에서 3D 공간을 표시할 수 없습니다.</p>}
    {slot !== null && <div className="touch glass" aria-label="이동 조작">
      {["w","a","s","d"].map((key, i) => <button key={key} aria-label={["앞","왼쪽","뒤","오른쪽"][i]}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); keys.current.add(key); }}
        onLostPointerCapture={() => keys.current.delete(key)}>{["↑","←","↓","→"][i]}</button>)}
    </div>}
  </>;
}
