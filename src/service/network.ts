import type { VoiceSignalMessage } from "../network/messages";
import { getRuntimeConfig } from "../runtimeConfig";

const PRODUCTION_WS_URL = "wss://phaser-obline-server.senhaoran213.workers.dev";
const WS_URL = getWebSocketUrl();
export let socket: WebSocket | null = null;

export type SocketStatus = "unconfigured" | "connecting" | "open" | "closed";

type SocketStatusListener = (status: SocketStatus, activeSocket: WebSocket | null) => void;

let socketStatus: SocketStatus = WS_URL ? "closed" : "unconfigured";
let reconnectTimerId: number | null = null;
let reconnectAttempt = 0;

const socketStatusListeners = new Set<SocketStatusListener>();

ensureSocketConnection();

// 统一的发送函数：
// 1. 避免每个场景都自己 JSON.stringify
// 2. 在连接还没建立好时直接跳过，减少报错
export function sendSocketMessage(payload: unknown) {
  ensureSocketConnection();

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

export type VoiceStatus = "off" | "starting" | "waiting" | "connected" | "failed";

type VoiceStatusListener = (status: VoiceStatus) => void;

let localPlayerId = "";
let localStream: MediaStream | null = null;
let isVoiceEnabled = false;
let voiceStatus: VoiceStatus = "off";
let knownRemotePlayerIds: string[] = [];
let remoteAudioContext: AudioContext | null = null;

const voiceStatusListeners = new Set<VoiceStatusListener>();
const peerConnections = new Map<string, RTCPeerConnection>();
const remoteAudioElements = new Map<string, HTMLAudioElement>();
const remoteAudioCleanups = new Map<string, () => void>();
const pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();

const SAFE_REMOTE_VOLUME = 0.35;
const FALLBACK_REMOTE_VOLUME = 0.25;

export function getSocketStatus() {
  return socketStatus;
}

export function onSocketStatusChange(listener: SocketStatusListener) {
  socketStatusListeners.add(listener);
  listener(socketStatus, socket);

  return () => {
    socketStatusListeners.delete(listener);
  };
}

export function ensureSocketConnection() {
  if (!WS_URL) {
    setSocketStatus("unconfigured");
    return null;
  }

  if (
    socket &&
    (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
  ) {
    return socket;
  }

  if (reconnectTimerId !== null) {
    window.clearTimeout(reconnectTimerId);
    reconnectTimerId = null;
  }

  socket = new WebSocket(WS_URL);
  setSocketStatus("connecting");

  socket.addEventListener("open", () => {
    reconnectAttempt = 0;
    setSocketStatus("open");
    console.log("connected to server");
  });

  socket.addEventListener("close", () => {
    setSocketStatus("closed");
    console.log("disconnected from server");
    scheduleSocketReconnect();
  });

  socket.addEventListener("error", (err) => {
    console.error("ws error", err);
  });

  return socket;
}

function getWebSocketUrl() {
  const runtimeUrl = getRuntimeConfig().wsUrl?.trim();
  if (runtimeUrl) {
    return runtimeUrl;
  }

  const buildUrl = import.meta.env.VITE_WS_URL?.trim();
  if (buildUrl) {
    return buildUrl;
  }

  if (location.protocol === "http:") {
    return `ws://${location.hostname}:3001`;
  }

  const isLocalHost =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname.startsWith("192.168.") ||
    location.hostname.startsWith("10.") ||
    location.hostname.endsWith(".local");

  return isLocalHost ? `wss://${location.host}/ws` : PRODUCTION_WS_URL;
}

function scheduleSocketReconnect() {
  if (!WS_URL || reconnectTimerId !== null) {
    return;
  }

  const retryDelay = Math.min(1000 * 2 ** reconnectAttempt, 10000);
  reconnectAttempt += 1;

  reconnectTimerId = window.setTimeout(() => {
    reconnectTimerId = null;
    ensureSocketConnection();
  }, retryDelay);
}

function setSocketStatus(status: SocketStatus) {
  if (socketStatus === status) {
    return;
  }

  socketStatus = status;
  socketStatusListeners.forEach((listener) => listener(socketStatus, socket));
}

export function isVoiceChatSupported() {
  return !!window.RTCPeerConnection && !!navigator.mediaDevices?.getUserMedia;
}

export function onVoiceStatusChange(listener: VoiceStatusListener) {
  voiceStatusListeners.add(listener);
  listener(voiceStatus);

  return () => {
    voiceStatusListeners.delete(listener);
  };
}

export function updateVoiceParticipants(playerIds: string[]) {
  knownRemotePlayerIds = [...new Set(playerIds.filter((playerId) => playerId !== localPlayerId))];

  if (!isVoiceEnabled || !localPlayerId) {
    return;
  }

  knownRemotePlayerIds.forEach((remotePlayerId) => {
    if (shouldCreateOffer(localPlayerId, remotePlayerId)) {
      void createPeerConnection(remotePlayerId, true);
    }
  });
}

export async function startVoiceChat(playerId: string, remotePlayerIds: string[] = []) {
  if (!isVoiceChatSupported()) {
    console.warn("当前浏览器不支持语音通话");
    return false;
  }

  localPlayerId = playerId;
  setVoiceStatus("starting");

  const isSocketReady = await waitForSocketOpen();
  if (!isSocketReady) {
    console.warn("[voice] 语音聊天启动失败：WebSocket 信令未连接");
    setVoiceStatus("failed");
    return false;
  }

  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true
      },
      video: false
    });
    console.info("[voice] local microphone stream ready", {
      audioTracks: localStream.getAudioTracks().length
    });
  }

  getRemoteAudioContext();
  await resumeRemoteAudioContext();

  isVoiceEnabled = true;
  setVoiceStatus("waiting");

  sendSocketMessage({
    type: "VOICE_SIGNAL",
    playerId: localPlayerId,
    enabled: true
  } satisfies VoiceSignalMessage);

  updateVoiceParticipants(remotePlayerIds);
  console.info("[voice] 本地语音已启动，等待 WebRTC 连接");
  return true;
}

export function stopVoiceChat() {
  if (!localPlayerId && !localStream) {
    return;
  }

  if (localPlayerId) {
    sendSocketMessage({
      type: "VOICE_SIGNAL",
      playerId: localPlayerId,
      enabled: false
    } satisfies VoiceSignalMessage);
  }

  peerConnections.forEach((peerConnection) => peerConnection.close());
  peerConnections.clear();
  pendingIceCandidates.clear();

  remoteAudioElements.forEach((audioElement) => audioElement.remove());
  remoteAudioElements.clear();
  remoteAudioCleanups.forEach((cleanup) => cleanup());
  remoteAudioCleanups.clear();

  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  localPlayerId = "";
  knownRemotePlayerIds = [];
  isVoiceEnabled = false;
  setVoiceStatus("off");

  console.log("语音聊天已关闭");
}

export async function handleWebRTCMessage(data: unknown) {
  const message = data as Partial<VoiceSignalMessage>;
  if (message.type !== "VOICE_SIGNAL" || !message.playerId || message.playerId === localPlayerId) {
    return;
  }

  if (message.targetPlayerId && message.targetPlayerId !== localPlayerId) {
    return;
  }

  if (message.enabled === false) {
    closePeerConnection(message.playerId);
    if (isVoiceEnabled && !hasConnectedPeer()) {
      setVoiceStatus("waiting");
    }
    return;
  }

  if (message.enabled === true) {
    console.info("[voice] remote voice enabled", { remotePlayerId: message.playerId });
    if (isVoiceEnabled && shouldCreateOffer(localPlayerId, message.playerId)) {
      await createPeerConnection(message.playerId, true);
    }
    return;
  }

  if (!isVoiceEnabled || !localStream) {
    return;
  }

  const peerConnection = await createPeerConnection(message.playerId, false);

  if (message.description) {
    console.info("[voice] received remote description", {
      remotePlayerId: message.playerId,
      type: message.description.type
    });
    await peerConnection.setRemoteDescription(new RTCSessionDescription(message.description));
    await flushPendingIceCandidates(message.playerId, peerConnection);

    if (message.description.type === "offer") {
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      console.info("[voice] sent answer", { remotePlayerId: message.playerId });
      sendVoiceSignal(message.playerId, { description: answer });
    }
  }

  if (message.candidate) {
    if (peerConnection.remoteDescription) {
      console.info("[voice] received ICE candidate", {
        remotePlayerId: message.playerId,
        candidateType: message.candidate.candidate?.match(/ typ ([a-z]+)/)?.[1]
      });
      await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
    } else {
      const candidates = pendingIceCandidates.get(message.playerId) ?? [];
      candidates.push(message.candidate);
      pendingIceCandidates.set(message.playerId, candidates);
    }
  }
}

async function createPeerConnection(remotePlayerId: string, shouldOffer: boolean) {
  let peerConnection = peerConnections.get(remotePlayerId);
  if (peerConnection) {
    return peerConnection;
  }

  peerConnection = new RTCPeerConnection(getRtcConfig());
  peerConnections.set(remotePlayerId, peerConnection);
  console.info("[voice] peer connection created", { remotePlayerId, shouldOffer });

  localStream?.getTracks().forEach((track) => {
    peerConnection!.addTrack(track, localStream!);
  });

  peerConnection.ontrack = (event) => {
    const [stream] = event.streams;
    if (!stream) {
      return;
    }
    console.info("[voice] remote audio track received", {
      remotePlayerId,
      audioTracks: stream.getAudioTracks().length
    });

    let audioElement = remoteAudioElements.get(remotePlayerId);
    if (!audioElement) {
      audioElement = new Audio();
      audioElement.autoplay = true;
      audioElement.setAttribute("playsinline", "true");
      audioElement.volume = FALLBACK_REMOTE_VOLUME;
      audioElement.style.display = "none";
      document.body.append(audioElement);
      remoteAudioElements.set(remotePlayerId, audioElement);
    }

    audioElement.srcObject = stream;
    playRemoteStreamSafely(remotePlayerId, stream, audioElement).catch((err) => {
      console.warn("远端语音播放被浏览器限制", err);
    });
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.info("[voice] sent ICE candidate", {
        remotePlayerId,
        candidateType: event.candidate.candidate.match(/ typ ([a-z]+)/)?.[1]
      });
      sendVoiceSignal(remotePlayerId, { candidate: event.candidate.toJSON() });
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.info("[voice] ICE connection state", {
      remotePlayerId,
      state: peerConnection?.iceConnectionState
    });
  };

  peerConnection.onicegatheringstatechange = () => {
    console.info("[voice] ICE gathering state", {
      remotePlayerId,
      state: peerConnection?.iceGatheringState
    });
  };

  peerConnection.onconnectionstatechange = () => {
    console.info("[voice] peer connection state", {
      remotePlayerId,
      state: peerConnection?.connectionState
    });

    if (peerConnection?.connectionState === "connected") {
      setVoiceStatus("connected");
      console.info("[voice] 语音聊天已连接", { remotePlayerId });
      return;
    }

    if (
      peerConnection?.connectionState === "failed" ||
      peerConnection?.connectionState === "closed" ||
      peerConnection?.connectionState === "disconnected"
    ) {
      closePeerConnection(remotePlayerId);
      if (isVoiceEnabled && !hasConnectedPeer()) {
        setVoiceStatus("failed");
      }
    }
  };

  if (shouldOffer) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.info("[voice] sent offer", { remotePlayerId });
    sendVoiceSignal(remotePlayerId, { description: offer });
  }

  return peerConnection;
}

function closePeerConnection(remotePlayerId: string) {
  peerConnections.get(remotePlayerId)?.close();
  peerConnections.delete(remotePlayerId);
  pendingIceCandidates.delete(remotePlayerId);

  const audioElement = remoteAudioElements.get(remotePlayerId);
  audioElement?.remove();
  remoteAudioElements.delete(remotePlayerId);
  remoteAudioCleanups.get(remotePlayerId)?.();
  remoteAudioCleanups.delete(remotePlayerId);
}

function hasConnectedPeer() {
  for (const peerConnection of peerConnections.values()) {
    if (peerConnection.connectionState === "connected") {
      return true;
    }
  }

  return false;
}

async function playRemoteStreamSafely(
  remotePlayerId: string,
  stream: MediaStream,
  audioElement: HTMLAudioElement
) {
  remoteAudioCleanups.get(remotePlayerId)?.();
  remoteAudioCleanups.delete(remotePlayerId);

  try {
    const audioContext = getRemoteAudioContext();
    await resumeRemoteAudioContext();

    const source = audioContext.createMediaStreamSource(stream);
    const limiter = audioContext.createDynamicsCompressor();
    const gain = audioContext.createGain();

    limiter.threshold.value = -24;
    limiter.knee.value = 18;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    gain.gain.value = SAFE_REMOTE_VOLUME;

    source.connect(limiter);
    limiter.connect(gain);
    gain.connect(audioContext.destination);
    audioElement.muted = true;
    await audioElement.play().catch(() => undefined);

    remoteAudioCleanups.set(remotePlayerId, () => {
      source.disconnect();
      limiter.disconnect();
      gain.disconnect();
    });
    return;
  } catch (err) {
    console.warn("安全音频处理不可用，使用低音量播放", err);
  }

  audioElement.muted = false;
  audioElement.volume = FALLBACK_REMOTE_VOLUME;
  await audioElement.play();
}

function getRemoteAudioContext() {
  remoteAudioContext ??= new AudioContext();
  return remoteAudioContext;
}

async function resumeRemoteAudioContext() {
  if (remoteAudioContext?.state === "suspended") {
    await remoteAudioContext.resume();
  }
}

async function flushPendingIceCandidates(remotePlayerId: string, peerConnection: RTCPeerConnection) {
  const candidates = pendingIceCandidates.get(remotePlayerId) ?? [];
  pendingIceCandidates.delete(remotePlayerId);

  for (const candidate of candidates) {
    console.info("[voice] flushed pending ICE candidate", {
      remotePlayerId,
      candidateType: candidate.candidate?.match(/ typ ([a-z]+)/)?.[1]
    });
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

function getRtcConfig(): RTCConfiguration {
  const configuredIceServers = getRuntimeConfig().iceServers;
  if (configuredIceServers?.length) {
    return { iceServers: configuredIceServers };
  }

  const buildIceServers = parseBuildIceServers();
  if (buildIceServers?.length) {
    return { iceServers: buildIceServers };
  }

  return {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  };
}

function parseBuildIceServers() {
  const value = import.meta.env.VITE_ICE_SERVERS?.trim();
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as RTCIceServer[];
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    console.warn("[voice] VITE_ICE_SERVERS is not valid JSON", err);
    return null;
  }
}

function sendVoiceSignal(
  targetPlayerId: string,
  payload: Pick<VoiceSignalMessage, "description" | "candidate">
) {
  sendSocketMessage({
    type: "VOICE_SIGNAL",
    playerId: localPlayerId,
    targetPlayerId,
    ...payload
  } satisfies VoiceSignalMessage);
}

function shouldCreateOffer(playerId: string, remotePlayerId: string) {
  return !!playerId && playerId > remotePlayerId;
}

function setVoiceStatus(status: VoiceStatus) {
  if (voiceStatus === status) {
    return;
  }

  voiceStatus = status;
  voiceStatusListeners.forEach((listener) => listener(voiceStatus));
}

function waitForSocketOpen(timeoutMs = 5000) {
  const activeSocket = ensureSocketConnection();

  if (!activeSocket) {
    return Promise.resolve(false);
  }

  if (activeSocket.readyState === WebSocket.OPEN) {
    return Promise.resolve(true);
  }

  if (activeSocket.readyState === WebSocket.CLOSED || activeSocket.readyState === WebSocket.CLOSING) {
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    const handleOpen = () => {
      cleanup();
      resolve(true);
    };

    const handleClose = () => {
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      activeSocket.removeEventListener("open", handleOpen);
      activeSocket.removeEventListener("close", handleClose);
      activeSocket.removeEventListener("error", handleClose);
    };

    activeSocket.addEventListener("open", handleOpen);
    activeSocket.addEventListener("close", handleClose);
    activeSocket.addEventListener("error", handleClose);
  });
}
