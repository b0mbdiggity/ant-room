"use client";

import dynamic from "next/dynamic";
import { createClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { candles } from "./candles";

const Scene = dynamic(() => import("./scene"), { ssr: false, loading: () => <div className="scene-loading">관측소를 그리는 중…</div> });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const db = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const emojis = ["🔥", "👀", "💎"];

type Room = { ticker: string; title: string; capacity: number };
type Seat = { slot: number; guest: string; expires_at: string };
type Message = { id: number; guest: string; body: string };
type Reaction = { emoji: string; total: number };

function explain(message: string) {
  if (message.includes("ROOM_FULL")) return "방이 가득 찼어요. 잠시 뒤 다시 입장해 주세요.";
  if (message.includes("CHAT_RATE_LIMIT")) return "메시지는 3초 간격으로 보낼 수 있고, 같은 문장은 30초 뒤에 다시 보낼 수 있어요.";
  if (message.includes("REACTION_RATE_LIMIT")) return "반응은 1초에 한 번 남길 수 있어요.";
  if (message.includes("SEAT_EXPIRED")) return "좌석이 만료됐어요. 다시 입장해 주세요.";
  return "관측소 연결에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.";
}

export default function Home() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [ticker, setTicker] = useState("");
  const [slot, setSlot] = useState<number | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [selected, setSelected] = useState(31);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0);
  const token = useRef("");
  const history = useRef<HTMLDivElement>(null);
  const current = rooms.find(room => room.ticker === ticker);
  const active = seats.filter(seat => Date.parse(seat.expires_at) > now);
  const reactionCount = (emoji: string) => reactions.find(reaction => reaction.emoji === emoji)?.total ?? 0;
  const candle = candles[selected];

  useEffect(() => {
    if (!db) return;
    const client = db;
    let alive = true;
    async function catalog() {
      const { data, error } = await client.from("rooms").select("ticker,title,capacity").order("ticker");
      if (!alive) return;
      setReady(true);
      if (error) { setNotice(explain(error.message)); return; }
      setRooms(data);
      setTicker(previous => data.some(room => room.ticker === previous) ? previous : data[0]?.ticker || "");
    }
    const channel = client.channel("catalog")
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, catalog)
      .subscribe(status => { if (status === "SUBSCRIBED") void catalog(); });
    void catalog();
    const fallback = window.setInterval(catalog, 30_000);
    return () => { alive = false; clearInterval(fallback); void client.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!db || !ticker) return;
    const client = db;
    let alive = true;
    let timeout: number | undefined;
    let version = 0;
    const filter = `room=eq.${ticker}`;
    async function snapshot() {
      const requested = ++version;
      const [seatRows, chatRows, reactionRows] = await Promise.all([
        client.from("seats").select("slot,guest,expires_at").eq("room", ticker),
        client.from("messages").select("id,guest,body").eq("room", ticker).order("id", { ascending: false }).limit(50),
        client.rpc("candle_reaction_totals", { ticker, candle_id: selected }),
      ]);
      if (!alive || requested !== version) return;
      if (seatRows.data) setSeats(seatRows.data);
      if (chatRows.data) setMessages(chatRows.data.reverse());
      if (reactionRows.data) setReactions(reactionRows.data);
      setNow(Date.now());
    }
    function queue() {
      if (timeout !== undefined) return;
      timeout = window.setTimeout(() => { timeout = undefined; void snapshot(); }, 500);
    }
    const channel = client.channel(`room:${ticker}:${selected}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "seats", filter }, queue)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter }, queue)
      .on("postgres_changes", { event: "*", schema: "public", table: "reactions", filter }, queue)
      .subscribe(status => {
        if (!alive) return;
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") queue();
      });
    void snapshot();
    const fallback = window.setInterval(snapshot, 25_000);
    const expiry = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      alive = false;
      clearTimeout(timeout); clearInterval(fallback); clearInterval(expiry);
      void client.removeChannel(channel);
    };
  }, [ticker, selected]);

  useEffect(() => {
    if (!db || slot === null) return;
    const client = db;
    let alive = true;
    const guest = token.current;
    async function renew() {
      const { error } = await client.rpc("room_action", { ticker, token: guest, action: "heartbeat" });
      if (alive && error?.message.includes("SEAT_EXPIRED")) {
        setSlot(null);
        setNotice(explain(error.message));
      }
    }
    const timer = window.setInterval(renew, 40_000);
    const visible = () => { if (!document.hidden) void renew(); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [slot, ticker]);

  useEffect(() => { if (history.current) history.current.scrollTop = history.current.scrollHeight; }, [messages]);

  async function act(action: string, extra: Record<string, string | number> = {}) {
    if (!db || !current || busy) return false;
    if (!token.current) {
      token.current = sessionStorage.getItem("ant-room-guest") || crypto.randomUUID();
      sessionStorage.setItem("ant-room-guest", token.current);
    }
    setBusy(true);
    setNotice("");
    try {
      const { data, error } = await db.rpc("room_action", { ticker, token: token.current, action, ...extra });
      if (error) {
        setNotice(explain(error.message));
        if (error.message.includes("SEAT_EXPIRED")) setSlot(null);
        return false;
      }
      if (action === "join") setSlot(data);
      if (action === "leave") setSlot(null);
      return true;
    } catch {
      setNotice(explain(""));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return <main>
    <section className="viewport" aria-label="지하 관측소">
      <Scene seats={active} slot={slot} ticker={ticker || "005930"} selected={selected}
        onSelect={index => { if (index !== selected) { setReactions([]); setSelected(index); } }} />
    </section>
    <header>
      <div className="identity glass"><span className="mark" aria-hidden>✳</span>
        <div><h1>Ant Room</h1><span className="edition">지하 관측소</span></div>
      </div>
      <div className="room-choice glass">
        <label htmlFor="room">관측 종목</label>
        <select id="room" value={ticker} disabled={slot !== null || busy || rooms.length === 0} onChange={event => {
          setTicker(event.target.value); setSeats([]); setMessages([]); setReactions([]); setNotice(""); setConnected(false);
        }}>
          {rooms.length === 0 && <option value="">{ready ? "관측 종목 없음" : "종목 불러오는 중…"}</option>}
          {rooms.map(room => <option value={room.ticker} key={room.ticker}>{room.title} · {room.ticker}</option>)}
        </select>
        <button className={slot === null ? "primary" : "secondary"} disabled={!current || busy}
          onClick={() => void act(slot === null ? "join" : "leave")}>
          {busy ? "처리 중…" : slot === null ? "게스트로 입장 ↗" : "방 나가기"}
        </button>
      </div>
    </header>
    <div className="status glass">
      <span className="connection"><i className={connected ? "live" : ""} />{connected ? "실시간" : "연결 대기"}</span>
      <span>{active.length} / {current?.capacity ?? "—"}석</span>
      <span>데모 차트</span>
    </div>
    <p className="notice" role="status">{!db ? "Supabase 환경 변수를 설정해 주세요." : notice || (slot === null ? "로그인 없이 둘러볼 수 있어요." : `게스트 · 좌석 ${String(slot).padStart(2, "0")}`)}</p>
    <aside>
        <details className="reactions glass">
          <summary>캔들 반응</summary>
          <label className="candle-label" htmlFor="candle">캔들 {String(selected + 1).padStart(2, "0")} / 32</label>
          <input id="candle" type="range" min={0} max={31} value={selected} onChange={event => { setReactions([]); setSelected(Number(event.target.value)); }} />
          <dl className="prices">{([["시가", candle.open], ["고가", candle.high], ["저가", candle.low], ["종가", candle.close]] as const)
            .map(([label, price]) => <div key={label}><dt>{label}</dt><dd>{price.toFixed(2)}</dd></div>)}</dl>
          <div className="emoji">{emojis.map((emoji, i) => <button key={emoji} disabled={slot === null || busy}
            aria-label={`${["불꽃","주목","다이아몬드"][i]} 반응 ${reactionCount(emoji)}개`}
            onClick={() => void act("react", { candle_id: selected, reaction: emoji })}>{emoji} <small>{reactionCount(emoji)}</small></button>)}</div>
        </details>
    </aside>
    <div className="chat">
      {messages.length > 0 && <div ref={history} className="messages glass" role="log" aria-label="방 채팅">
        {messages.map(message => <p key={message.id}><b>개미 {message.guest.slice(0, 4)}</b> {message.body}</p>)}
      </div>}
          <form className="glass" onSubmit={async event => { event.preventDefault(); if (draft.trim() && await act("chat", { message: draft.trim() })) setDraft(""); }}>
            <input aria-label="채팅 메시지" maxLength={180} placeholder={slot === null ? "입장 후 채팅할 수 있어요" : "메시지를 입력하세요"} value={draft} onChange={event => setDraft(event.target.value)} disabled={slot === null} />
            <button aria-label="메시지 전송" disabled={slot === null || !draft.trim() || busy}>↑</button>
          </form>
    </div>
    <p className="controls glass">WASD 이동 <span>·</span> 드래그로 시점 회전</p>
  </main>;
}
