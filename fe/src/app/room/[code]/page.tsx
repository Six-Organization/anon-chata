"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Socket } from "socket.io-client";
import { createSocket } from "@/lib/socket";
import { uploadImage, mediaUrl } from "@/lib/api";
import type {
  Participant,
  Message,
  JoinedPayload,
  ParticipantChangePayload,
  TypingPayload,
  SocketErrorPayload,
  ReadReceiptPayload,
} from "@/lib/types";

// Item yang ditampilkan di daftar: pesan chat atau notifikasi sistem.
type ChatItem =
  | { kind: "chat"; msg: Message }
  | { kind: "system"; id: string; text: string };

export default function RoomPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = (params.code || "").toUpperCase();

  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [myNickname, setMyNickname] = useState<string>("");
  const [myParticipantId, setMyParticipantId] = useState<string>("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitTypingRef = useRef<boolean>(false);

  // ---- Setup socket sekali per room ----
  useEffect(() => {
    const nickname =
      (typeof window !== "undefined" && sessionStorage.getItem("nickname")) || "";

    const socket = createSocket();
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      // (re)join saat konek / reconnect
      socket.emit("join_room", { code, nickname });
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("joined", (p: JoinedPayload) => {
      setMyNickname(p.nickname);
      setMyParticipantId(p.participantId);
      setParticipants(p.participants);
      setItems(p.messages.map((msg) => ({ kind: "chat", msg })));
      markRead(); // sudah lihat history
    });

    socket.on("message", (msg: Message) => {
      setItems((prev) => {
        // hindari duplikasi id
        if (prev.some((it) => it.kind === "chat" && it.msg.id === msg.id)) {
          return prev;
        }
        return [...prev, { kind: "chat", msg }];
      });
      markRead(); // pesan baru masuk saat sedang melihat -> tandai terbaca
    });

    socket.on("read_receipt", (p: ReadReceiptPayload) => {
      setParticipants((prev) =>
        prev.map((pt) =>
          pt.id === p.participantId ? { ...pt, lastReadAt: p.lastReadAt } : pt
        )
      );
    });

    socket.on("participant_joined", (p: ParticipantChangePayload) => {
      setParticipants(p.participants);
      addSystem(`${p.nickname} bergabung`);
    });

    socket.on("participant_left", (p: ParticipantChangePayload) => {
      setParticipants(p.participants);
      addSystem(`${p.nickname} keluar`);
    });

    socket.on("typing", (p: TypingPayload) => {
      setTypingUser(p.isTyping ? p.nickname : null);
    });

    socket.on("error", (p: SocketErrorPayload) => {
      // error saat join (room penuh / tidak ada) bersifat fatal untuk halaman ini
      setFatalError(p.message);
    });

    return () => {
      socket.emit("leave_room");
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // ---- Auto-scroll ke bawah ----
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items, typingUser]);

  // ---- Tandai terbaca saat tab kembali aktif / fokus ----
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") markRead();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Emit mark_read hanya saat tab benar-benar terlihat (biar receipt akurat).
  function markRead() {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    socketRef.current?.emit("mark_read");
  }

  // Siapa saja yang sudah membaca pesan `msg` (kecuali pengirim & diri sendiri).
  function readersFor(msg: Message): Participant[] {
    return participants.filter(
      (p) =>
        p.id !== myParticipantId &&
        p.nickname !== msg.nickname &&
        p.lastReadAt !== null &&
        p.lastReadAt >= msg.createdAt
    );
  }

  function addSystem(text: string) {
    setItems((prev) => [
      ...prev,
      { kind: "system", id: `sys-${Date.now()}-${Math.random()}`, text },
    ]);
  }

  function sendMessage() {
    const content = input.trim();
    if (!content || !socketRef.current) return;
    socketRef.current.emit("send_message", { content });
    setInput("");
    stopTyping();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset agar file yang sama bisa dipilih lagi
    if (!file) return;
    setNotice(null);

    if (!file.type.startsWith("image/")) {
      setNotice("File harus berupa gambar");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setNotice("Gambar maksimal 5MB");
      return;
    }

    setUploading(true);
    try {
      const { imageUrl } = await uploadImage(code, file);
      const caption = input.trim();
      socketRef.current?.emit("send_message", { imageUrl, content: caption });
      setInput("");
      stopTyping();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Gagal mengunggah gambar");
    } finally {
      setUploading(false);
    }
  }

  function handleInputChange(v: string) {
    setInput(v);
    const socket = socketRef.current;
    if (!socket) return;
    if (!emitTypingRef.current) {
      emitTypingRef.current = true;
      socket.emit("typing", { isTyping: true });
    }
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(stopTyping, 1500);
  }

  function stopTyping() {
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    if (emitTypingRef.current && socketRef.current) {
      emitTypingRef.current = false;
      socketRef.current.emit("typing", { isTyping: false });
    }
  }

  function leaveRoom() {
    socketRef.current?.emit("leave_room");
    router.push("/");
  }

  const shareUrl = useMemo(
    () => (typeof window !== "undefined" ? window.location.href : ""),
    []
  );

  function copyCode() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).catch(() => {});
    }
  }

  // ---- Layar error fatal (room penuh / tidak ada) ----
  if (fatalError) {
    return (
      <main className="safe-x mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
          <p className="text-lg font-semibold text-red-600">{fatalError}</p>
          <button
            onClick={() => router.push("/")}
            className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            Kembali ke Beranda
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-[100dvh] max-w-2xl flex-col px-0 sm:px-4">
      {/* Header */}
      <header className="safe-top flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button
              onClick={copyCode}
              title="Salin kode"
              className="rounded-md bg-slate-100 px-2 py-1 font-mono text-sm font-bold tracking-widest text-slate-800 hover:bg-slate-200"
            >
              {code}
            </button>
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                connected ? "bg-emerald-500" : "bg-amber-400"
              }`}
              title={connected ? "Tersambung" : "Menyambungkan…"}
            />
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {participants.length}/3 online
            {myNickname && ` • kamu: ${myNickname}`}
          </p>
        </div>
        <button
          onClick={leaveRoom}
          className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Keluar
        </button>
      </header>

      {/* Peserta */}
      <div className="flex flex-wrap gap-2 border-b border-slate-100 bg-white px-4 py-2">
        {participants.map((p) => (
          <span
            key={p.id}
            className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand-dark"
          >
            {p.nickname}
          </span>
        ))}
      </div>

      {/* Daftar pesan */}
      <div className="chat-scroll flex-1 space-y-2 overflow-y-auto bg-slate-50 px-4 py-4">
        {items.map((it) =>
          it.kind === "system" ? (
            <div key={it.id} className="text-center">
              <span className="rounded-full bg-slate-200 px-3 py-1 text-xs text-slate-500">
                {it.text}
              </span>
            </div>
          ) : (
            <MessageBubble
              key={it.msg.id}
              msg={it.msg}
              mine={it.msg.nickname === myNickname}
              readers={readersFor(it.msg)}
            />
          )
        )}

        {typingUser && (
          <p className="px-1 text-xs italic text-slate-400">
            {typingUser} sedang mengetik…
          </p>
        )}
        <div ref={listEndRef} />
      </div>

      {/* Input */}
      <div className="safe-bottom border-t border-slate-200 bg-white px-4 py-3">
        {notice && (
          <p className="mb-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
            {notice}
          </p>
        )}
        <div className="flex items-center gap-2">
          {/* Tombol lampirkan gambar */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={handleFile}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!connected || uploading}
            aria-label="Kirim gambar"
            title="Kirim gambar"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-300 text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
          >
            {uploading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand" />
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            )}
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            maxLength={1000}
            placeholder={connected ? "Tulis pesan…" : "Menyambungkan…"}
            disabled={!connected}
            enterKeyHint="send"
            autoComplete="off"
            aria-label="Tulis pesan"
            className="w-full rounded-full border border-slate-300 px-4 py-2 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:bg-slate-100"
          />
          <button
            onClick={sendMessage}
            disabled={!connected || input.trim().length === 0}
            className="shrink-0 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
          >
            Kirim
          </button>
        </div>
      </div>
    </main>
  );
}

function MessageBubble({
  msg,
  mine,
  readers,
}: {
  msg: Message;
  mine: boolean;
  readers: Participant[];
}) {
  const time = new Date(msg.createdAt).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          mine
            ? "rounded-br-sm bg-brand text-white"
            : "rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200"
        }`}
      >
        {!mine && (
          <p className="mb-0.5 text-xs font-semibold text-brand-dark">
            {msg.nickname}
          </p>
        )}

        {msg.type === "image" &&
          (msg.imageUrl ? (
            <a
              href={mediaUrl(msg.imageUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mediaUrl(msg.imageUrl)}
                alt="gambar"
                loading="lazy"
                className="max-h-64 w-auto max-w-full rounded-lg object-cover"
              />
            </a>
          ) : (
            <p
              className={`rounded-lg px-2 py-3 text-xs italic ${
                mine ? "bg-white/15 text-white/80" : "bg-slate-100 text-slate-400"
              }`}
            >
              🖼️ Gambar sudah kadaluarsa (24 jam)
            </p>
          ))}

        {msg.content && (
          <p className="mt-1 whitespace-pre-wrap break-words">{msg.content}</p>
        )}
        <div className="mt-1 flex items-center justify-end gap-1.5">
          {readers.length > 0 && (
            <span
              className="flex items-center gap-0.5"
              title={`Dibaca oleh ${readers.map((r) => r.nickname).join(", ")}`}
            >
              {/* ikon centang ganda "dibaca" */}
              <svg
                viewBox="0 0 24 24"
                className={`h-3 w-3 ${mine ? "text-white/80" : "text-brand"}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1 13l4 4L15 7" />
                <path d="M9 13l4 4L23 7" />
              </svg>
              <span className="flex -space-x-1">
                {readers.map((r) => (
                  <span
                    key={r.id}
                    className={`grid h-4 w-4 place-items-center rounded-full text-[8px] font-bold ring-1 ${
                      mine
                        ? "bg-white/25 text-white ring-brand"
                        : "bg-brand/15 text-brand-dark ring-white"
                    }`}
                  >
                    {r.nickname.charAt(0).toUpperCase()}
                  </span>
                ))}
              </span>
            </span>
          )}
          <p
            className={`text-[10px] ${mine ? "text-white/70" : "text-slate-400"}`}
          >
            {time}
          </p>
        </div>
      </div>
    </div>
  );
}
