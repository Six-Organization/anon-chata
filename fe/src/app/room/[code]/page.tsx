"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Socket } from "socket.io-client";
import { createSocket } from "@/lib/socket";
import { uploadMedia, mediaUrl } from "@/lib/api";
import {
  getClientId,
  getSavedNickname,
  saveNickname,
  saveSession,
  clearSession,
  addRecentRoom,
} from "@/lib/identity";
import type {
  Participant,
  Message,
  JoinedPayload,
  ParticipantChangePayload,
  TypingPayload,
  SocketErrorPayload,
  ReadReceiptPayload,
  PinRequiredPayload,
  RoomPinChangedPayload,
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
  const [myClientId, setMyClientId] = useState<string>("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [hasPin, setHasPin] = useState(false);
  const [pinRequired, setPinRequired] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [showPinPanel, setShowPinPanel] = useState(false);
  const [pinSetInput, setPinSetInput] = useState("");
  const pinRef = useRef<string>(""); // PIN yang dipakai sesi ini (memori saja)

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitTypingRef = useRef<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recCancelRef = useRef<boolean>(false);

  // Bersihkan mic kalau komponen dilepas saat sedang merekam.
  useEffect(
    () => () => {
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    },
    []
  );

  // ---- Setup socket sekali per room ----
  useEffect(() => {
    const clientId = getClientId();
    setMyClientId(clientId);
    const nickname = getSavedNickname();

    const socket = createSocket();
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      // (re)join saat konek / reconnect. pinRef diisi kalau room ber-PIN
      // (diingat sementara agar reconnect tidak minta PIN lagi).
      socket.emit("join_room", {
        code,
        nickname,
        clientId,
        pin: pinRef.current || undefined,
      });
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("joined", (p: JoinedPayload) => {
      setMyNickname(p.nickname);
      setMyParticipantId(p.participantId);
      setParticipants(p.participants);
      setItems(p.messages.map((msg) => ({ kind: "chat", msg })));
      setHasPin(p.hasPin);
      setPinRequired(false);
      setPinError(null);
      saveNickname(p.nickname); // pertahankan nama utk sesi berikutnya
      saveSession(code); // ingat room ini (auto-rejoin < 5 jam)
      addRecentRoom(code); // catat di riwayat room (shortcut di home)
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

    socket.on("pin_required", (p: PinRequiredPayload) => {
      setPinRequired(true);
      setPinError(p?.message ?? null);
      setPinInput("");
    });

    socket.on("room_pin_changed", (p: RoomPinChangedPayload) => {
      setHasPin(p.hasPin);
      addSystem(p.hasPin ? "🔒 PIN room diaktifkan" : "🔓 PIN room dihapus");
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

  // Pesan ini milik saya? Utamakan clientId (stabil lintas sesi), fallback nickname.
  function isMine(msg: Message): boolean {
    if (msg.clientId) return msg.clientId === myClientId;
    return msg.nickname === myNickname;
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
    socketRef.current.emit("send_message", {
      content,
      replyToId: replyingTo?.id,
    });
    setInput("");
    setReplyingTo(null);
    stopTyping();
  }

  // Upload + kirim satu media (dipakai tombol lampir file & voice note).
  async function sendMedia(file: File) {
    if (!socketRef.current) return;
    setNotice(null);
    setUploading(true);
    try {
      const { url, kind } = await uploadMedia(code, file);
      const caption = input.trim();
      socketRef.current.emit("send_message", {
        imageUrl: url,
        mediaType: kind,
        content: caption,
        replyToId: replyingTo?.id,
      });
      setInput("");
      setReplyingTo(null);
      stopTyping();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Gagal mengunggah media");
    } finally {
      setUploading(false);
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset agar file yang sama bisa dipilih lagi
    if (!file) return;
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setNotice("Hanya bisa gambar atau video");
      return;
    }
    void sendMedia(file);
  }

  // ---- Voice note (rekam mikrofon) ----
  async function startRecording() {
    if (recording) return;
    setNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recStreamRef.current = stream;
      recCancelRef.current = false;
      const mr = new MediaRecorder(stream);
      recChunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) recChunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        recStreamRef.current?.getTracks().forEach((t) => t.stop());
        recStreamRef.current = null;
        if (recTimerRef.current) {
          clearInterval(recTimerRef.current);
          recTimerRef.current = null;
        }
        setRecording(false);
        setRecSeconds(0);
        if (recCancelRef.current) return;
        const blob = new Blob(recChunksRef.current, {
          type: mr.mimeType || "audio/webm",
        });
        if (blob.size === 0) return;
        const ext = (mr.mimeType || "").includes("mp4") ? "m4a" : "webm";
        await sendMedia(new File([blob], `voice.${ext}`, { type: blob.type }));
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current = setInterval(
        () => setRecSeconds((s) => s + 1),
        1000
      );
    } catch {
      setNotice("Tidak bisa akses mikrofon (izin ditolak?)");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  function cancelRecording() {
    recCancelRef.current = true;
    mediaRecorderRef.current?.stop();
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
    clearSession(); // keluar sungguhan -> jangan auto-rejoin lagi
    socketRef.current?.emit("leave_room");
    router.push("/");
  }

  // Submit PIN untuk masuk room ber-PIN.
  function submitPin() {
    const pin = pinInput.trim();
    if (!/^\d{4}$/.test(pin)) {
      setPinError("PIN harus 4 angka");
      return;
    }
    pinRef.current = pin;
    setPinError(null);
    socketRef.current?.emit("join_room", {
      code,
      nickname: getSavedNickname(),
      clientId: getClientId(),
      pin,
    });
  }

  // Set/hapus PIN room (dari dalam room).
  function saveRoomPin() {
    const pin = pinSetInput.trim();
    if (!/^\d{4}$/.test(pin)) {
      setNotice("PIN harus 4 angka");
      return;
    }
    socketRef.current?.emit("set_room_pin", { pin });
    pinRef.current = pin; // biar reconnect tetap bisa masuk
    setPinSetInput("");
    setShowPinPanel(false);
  }

  function removeRoomPin() {
    socketRef.current?.emit("set_room_pin", { pin: null });
    pinRef.current = "";
    setPinSetInput("");
    setShowPinPanel(false);
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

  // Layar input PIN (room terkunci)
  if (pinRequired) {
    return (
      <main className="safe-x mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="w-full rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
          <div className="mb-2 text-4xl">🔒</div>
          <h2 className="text-lg font-semibold text-slate-800">Room terkunci</h2>
          <p className="mt-1 text-sm text-slate-500">
            Masukkan PIN 4 digit untuk masuk.
          </p>
          <input
            type="tel"
            inputMode="numeric"
            maxLength={4}
            value={pinInput}
            onChange={(e) =>
              setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            onKeyDown={(e) => e.key === "Enter" && submitPin()}
            placeholder="••••"
            autoFocus
            className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-3 text-center text-2xl tracking-[0.5em] outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          {pinError && <p className="mt-2 text-sm text-red-600">{pinError}</p>}
          <button
            onClick={submitPin}
            disabled={pinInput.length !== 4 || !connected}
            className="mt-4 w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
          >
            Masuk
          </button>
          <button
            onClick={() => router.push("/")}
            className="mt-2 text-xs text-slate-400 hover:text-slate-600"
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
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => {
              setShowPinPanel((v) => !v);
              setPinSetInput("");
            }}
            aria-label="PIN room"
            title={hasPin ? "Room terkunci PIN" : "Kunci room dengan PIN"}
            className={`grid h-9 w-9 place-items-center rounded-lg border text-base transition ${
              hasPin
                ? "border-brand/40 bg-brand/10"
                : "border-slate-300 hover:bg-slate-100"
            }`}
          >
            {hasPin ? "🔒" : "🔓"}
          </button>
          <button
            onClick={leaveRoom}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Keluar
          </button>
        </div>
      </header>

      {/* Panel set PIN */}
      {showPinPanel && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
          <p className="mb-1.5 text-xs font-medium text-slate-600">
            {hasPin
              ? "Room terkunci PIN. Ganti atau hapus di bawah."
              : "Kunci room dengan PIN 4 digit (wajib diisi tiap masuk)."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="tel"
              inputMode="numeric"
              maxLength={4}
              value={pinSetInput}
              onChange={(e) =>
                setPinSetInput(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="4 digit"
              className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-center tracking-[0.3em] outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
            <button
              onClick={saveRoomPin}
              disabled={pinSetInput.length !== 4}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {hasPin ? "Ganti" : "Kunci"}
            </button>
            {hasPin && (
              <button
                onClick={removeRoomPin}
                className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Hapus PIN
              </button>
            )}
            <button
              onClick={() => setShowPinPanel(false)}
              className="ml-auto text-sm text-slate-400 hover:text-slate-600"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

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
              mine={isMine(it.msg)}
              readers={readersFor(it.msg)}
              onReply={() => setReplyingTo(it.msg)}
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

        {/* Bar "membalas" */}
        {replyingTo && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-brand bg-slate-50 px-3 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-brand-dark">
                Membalas {replyingTo.nickname}
              </p>
              <p className="truncate text-xs text-slate-500">
                {replyPreviewText(replyingTo)}
              </p>
            </div>
            <button
              onClick={() => setReplyingTo(null)}
              aria-label="Batal balas"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600"
            >
              ×
            </button>
          </div>
        )}

        {recording ? (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-sm font-medium text-red-600">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
              Merekam {fmtDur(recSeconds)}
            </span>
            <div className="ml-auto flex gap-2">
              <button
                onClick={cancelRecording}
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Batal
              </button>
              <button
                onClick={stopRecording}
                className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
              >
                Kirim
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {/* Lampir gambar / video */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={handleFile}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!connected || uploading}
              aria-label="Kirim gambar atau video"
              title="Gambar / video"
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

            {/* Voice note */}
            <button
              type="button"
              onClick={startRecording}
              disabled={!connected || uploading}
              aria-label="Rekam pesan suara"
              title="Pesan suara"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-300 text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <path d="M12 19v3" />
              </svg>
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
        )}
      </div>
    </main>
  );
}

// ---- Helper media/reply ----
function fmtDur(s: number): string {
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
}

function mediaLabel(type: string): string {
  if (type === "image") return "📷 Foto";
  if (type === "audio") return "🎤 Pesan suara";
  if (type === "video") return "🎬 Video";
  return "";
}

function replyPreviewText(m: { content: string; type: string }): string {
  return m.content && m.content.trim() ? m.content : mediaLabel(m.type);
}

function MessageBubble({
  msg,
  mine,
  readers,
  onReply,
}: {
  msg: Message;
  mine: boolean;
  readers: Participant[];
  onReply: () => void;
}) {
  const time = new Date(msg.createdAt).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const src = msg.imageUrl ? mediaUrl(msg.imageUrl) : null;
  const expired = msg.type !== "text" && !msg.imageUrl;

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
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

        {/* Kutipan pesan yang dibalas */}
        {msg.replyTo && (
          <div
            className={`mb-1 rounded-md border-l-2 px-2 py-1 text-xs ${
              mine ? "border-white/60 bg-white/15" : "border-brand bg-slate-100"
            }`}
          >
            <p
              className={`font-semibold ${
                mine ? "text-white/90" : "text-brand-dark"
              }`}
            >
              {msg.replyTo.nickname}
            </p>
            <p
              className={`truncate ${mine ? "text-white/80" : "text-slate-500"}`}
            >
              {replyPreviewText(msg.replyTo)}
            </p>
          </div>
        )}

        {/* Media: gambar / video / audio */}
        {expired ? (
          <p
            className={`rounded-lg px-2 py-3 text-xs italic ${
              mine ? "bg-white/15 text-white/80" : "bg-slate-100 text-slate-400"
            }`}
          >
            {mediaLabel(msg.type)} sudah kadaluarsa (24 jam)
          </p>
        ) : msg.type === "image" && src ? (
          <a href={src} target="_blank" rel="noopener noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt="gambar"
              loading="lazy"
              className="max-h-64 w-auto max-w-full rounded-lg object-cover"
            />
          </a>
        ) : msg.type === "video" && src ? (
          <video
            controls
            preload="metadata"
            src={src}
            className="max-h-64 max-w-full rounded-lg"
          />
        ) : msg.type === "audio" && src ? (
          <audio
            controls
            preload="metadata"
            src={src}
            className="w-56 max-w-full"
          />
        ) : null}

        {msg.content && (
          <p className="mt-1 whitespace-pre-wrap break-words">{msg.content}</p>
        )}
        <div className="mt-1 flex items-center justify-end gap-1.5">
          {/* Tombol balas */}
          <button
            onClick={onReply}
            aria-label="Balas"
            title="Balas"
            className={`mr-auto opacity-70 transition hover:opacity-100 ${
              mine ? "text-white/80" : "text-slate-400 hover:text-brand"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 17l-5-5 5-5" />
              <path d="M4 12h11a5 5 0 0 1 5 5v1" />
            </svg>
          </button>

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
