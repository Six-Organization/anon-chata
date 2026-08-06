"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Socket } from "socket.io-client";

export type RemotePeer = { peerId: string; nickname: string; stream: MediaStream };

// STUN (deteksi alamat publik) + TURN (relay untuk NAT ketat/jaringan seluler).
// TURN bisa dioverride via env NEXT_PUBLIC_TURN_* (mis. coturn sendiri di VPS);
// kalau tak diset, pakai TURN gratis (Open Relay) sebagai fallback.
function buildIce(): RTCConfiguration {
  const servers: RTCIceServer[] = [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
      ],
    },
  ];
  const turnUrls = (process.env.NEXT_PUBLIC_TURN_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (turnUrls.length) {
    servers.push({
      urls: turnUrls,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME || "",
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || "",
    });
  } else {
    servers.push({
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    });
  }
  return { iceServers: servers };
}

const ICE: RTCConfiguration = buildIce();

// Panggilan suara/video mesh (≤3 orang). Signaling lewat socket yang sudah ada.
export function useCall(
  socketRef: MutableRefObject<Socket | null>,
  connected: boolean
) {
  const [inCall, setInCall] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [callCount, setCallCount] = useState(0);
  const [remotes, setRemotes] = useState<RemotePeer[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const namesRef = useRef<Map<string, string>>(new Map());
  const pendingRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const inCallRef = useRef(false);

  const myId = () => socketRef.current?.id || "";
  const emitSignal = (to: string, data: unknown) =>
    socketRef.current?.emit("webrtc_signal", { to, data });

  function upsertRemote(peerId: string, nickname: string, stream: MediaStream) {
    setRemotes((prev) => [
      ...prev.filter((r) => r.peerId !== peerId),
      { peerId, nickname, stream },
    ]);
  }

  function closePeer(peerId: string) {
    const pc = pcsRef.current.get(peerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      pcsRef.current.delete(peerId);
    }
    pendingRef.current.delete(peerId);
    setRemotes((prev) => prev.filter((r) => r.peerId !== peerId));
  }

  function createPeer(peerId: string, nickname: string, initiator: boolean) {
    const existing = pcsRef.current.get(peerId);
    if (existing) return existing;
    const pc = new RTCPeerConnection(ICE);
    namesRef.current.set(peerId, nickname);
    localStreamRef.current
      ?.getTracks()
      .forEach((t) => pc.addTrack(t, localStreamRef.current!));
    pc.onicecandidate = (e) => {
      if (e.candidate) emitSignal(peerId, { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      upsertRemote(peerId, namesRef.current.get(peerId) || nickname, e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        closePeer(peerId);
      }
    };
    pcsRef.current.set(peerId, pc);
    if (initiator) {
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => emitSignal(peerId, { sdp: pc.localDescription }))
        .catch(() => {});
    }
    return pc;
  }

  async function handleSignal(from: string, data: any) {
    if (!inCallRef.current) return;
    let pc = pcsRef.current.get(from);
    if (data?.sdp) {
      if (!pc) pc = createPeer(from, namesRef.current.get(from) || "", false);
      await pc.setRemoteDescription(data.sdp);
      const pend = pendingRef.current.get(from);
      if (pend) {
        for (const c of pend) {
          try {
            await pc.addIceCandidate(c);
          } catch {
            /* ignore */
          }
        }
        pendingRef.current.delete(from);
      }
      if (data.sdp.type === "offer") {
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        emitSignal(from, { sdp: pc.localDescription });
      }
    } else if (data?.candidate) {
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch {
          /* ignore */
        }
      } else {
        const arr = pendingRef.current.get(from) || [];
        arr.push(data.candidate);
        pendingRef.current.set(from, arr);
      }
    }
  }

  // Pasang listener call saat socket sudah tersambung.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected) return;

    const onPeers = ({
      peers,
    }: {
      peers: { peerId: string; nickname: string }[];
    }) => {
      peers.forEach((p) => {
        namesRef.current.set(p.peerId, p.nickname);
        createPeer(p.peerId, p.nickname, myId() < p.peerId);
      });
    };
    const onPeerJoined = ({
      peerId,
      nickname,
    }: {
      peerId: string;
      nickname: string;
    }) => {
      namesRef.current.set(peerId, nickname);
      if (inCallRef.current) createPeer(peerId, nickname, myId() < peerId);
    };
    const onPeerLeft = ({ peerId }: { peerId: string }) => closePeer(peerId);
    const onSignal = ({ from, data }: { from: string; data: unknown }) =>
      void handleSignal(from, data);
    const onActive = ({ count }: { count: number }) => setCallCount(count);

    socket.on("call_peers", onPeers);
    socket.on("call_peer_joined", onPeerJoined);
    socket.on("call_peer_left", onPeerLeft);
    socket.on("webrtc_signal", onSignal);
    socket.on("call_active", onActive);
    return () => {
      socket.off("call_peers", onPeers);
      socket.off("call_peer_joined", onPeerJoined);
      socket.off("call_peer_left", onPeerLeft);
      socket.off("webrtc_signal", onSignal);
      socket.off("call_active", onActive);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  async function startCall(video: boolean) {
    if (inCallRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      inCallRef.current = true;
      setInCall(true);
      setMicOn(true);
      socketRef.current?.emit("call_join");
    } catch {
      alert("Tidak bisa akses kamera/mikrofon (izin ditolak?)");
    }
  }

  function leaveCall() {
    if (!inCallRef.current) return;
    socketRef.current?.emit("call_leave");
    pcsRef.current.forEach((pc) => {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    });
    pcsRef.current.clear();
    pendingRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemotes([]);
    inCallRef.current = false;
    setInCall(false);
  }

  function toggleMic() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => leaveCall(), []);

  return {
    inCall,
    micOn,
    callCount,
    remotes,
    localStream,
    startCall,
    leaveCall,
    toggleMic,
  };
}
