"use client";

import { useEffect, useRef } from "react";
import type { RemotePeer } from "./useCall";

function VideoTile({
  stream,
  muted,
  label,
  mirror = false,
}: {
  stream: MediaStream;
  muted: boolean;
  label: string;
  mirror?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  const hasVideo = stream.getVideoTracks().length > 0;
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-800 ring-1 ring-white/10">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={`h-full w-full object-cover ${hasVideo ? "" : "invisible"} ${
          mirror ? "-scale-x-100" : ""
        }`}
      />
      {!hasVideo && (
        <div className="absolute inset-0 grid place-items-center text-4xl">
          🎙️
        </div>
      )}
      <span className="absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-xs font-medium text-white">
        {label}
      </span>
    </div>
  );
}

export default function CallPanel({
  remotes,
  localStream,
  micOn,
  myNickname,
  onToggleMic,
  onLeave,
}: {
  remotes: RemotePeer[];
  localStream: MediaStream | null;
  micOn: boolean;
  myNickname: string;
  onToggleMic: () => void;
  onLeave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/97 backdrop-blur">
      <div className="safe-top px-4 py-3 text-center text-sm font-medium text-white/80">
        Panggilan • {remotes.length + 1} peserta
      </div>

      <div className="flex-1 overflow-y-auto px-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {localStream && (
            <VideoTile
              stream={localStream}
              muted
              mirror
              label={`${myNickname || "Kamu"} (kamu)`}
            />
          )}
          {remotes.map((r) => (
            <VideoTile
              key={r.peerId}
              stream={r.stream}
              muted={false}
              label={r.nickname || "Peserta"}
            />
          ))}
        </div>
        {remotes.length === 0 && (
          <p className="mt-8 text-center text-sm text-slate-400">
            Menunggu peserta lain bergabung…
          </p>
        )}
      </div>

      <div className="safe-bottom flex items-center justify-center gap-4 px-4 py-5">
        <button
          onClick={onToggleMic}
          className={`grid h-14 w-14 place-items-center rounded-full text-xl transition ${
            micOn
              ? "bg-white/15 text-white hover:bg-white/25"
              : "bg-white/80 text-slate-900"
          }`}
          title={micOn ? "Matikan mikrofon" : "Nyalakan mikrofon"}
        >
          {micOn ? "🎙️" : "🔇"}
        </button>
        <button
          onClick={onLeave}
          className="grid h-14 w-14 place-items-center rounded-full bg-red-600 text-xl text-white transition hover:bg-red-700"
          title="Akhiri panggilan"
        >
          📞
        </button>
      </div>
    </div>
  );
}
