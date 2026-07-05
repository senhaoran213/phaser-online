import type { VoiceSignalMessage } from "../network/messages";
import { getRuntimeConfig } from "../runtimeConfig";

// 这个模块一旦被 import，就会立刻创建 WebSocket 连接。
// 这里默认去连本机 3001 端口的服务端。
const WS_URL = getWebSocketUrl();
export const socket = WS_URL ? new WebSocket(WS_URL) : null;

if (socket) {
  socket.onopen = () => {
    console.log("connected to server");
  };

  socket.onclose = () => {
    console.log("disconnected from server");
  };

  socket.onerror = (err) => {
    console.error("ws error", err);
  };
} else {
  console.info("websocket server is not configured");
}

// 统一的发送函数：
// 1. 避免每个场景都自己 JSON.stringify
// 2. 在连接还没建立好时直接跳过，减少报错
export function sendSocketMessage(payload: unknown) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

type VoiceStatusListener = (isEnabled: boolean) => void;

let localPlayerId = "";
let localStream: MediaStream | null = null;
let isVoiceEnabled = false;
let knownRemotePlayerIds: string[] = [];
let remoteAudioContext: AudioContext | null = null;

const voiceStatusListeners = new Set<VoiceStatusListener>();
const peerConnections = new Map<string, RTCPeerConnection>();
const remoteAudioElements = new Map<string, HTMLAudioElement>();
const remoteAudioCleanups = new Map<string, () => void>();
const pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

const SAFE_REMOTE_VOLUME = 0.35;
const FALLBACK_REMOTE_VOLUME = 0.25;

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

  return isLocalHost ? `wss://${location.host}/ws` : "";
}

export function isVoiceChatSupported() {
  return !!window.RTCPeerConnection && !!navigator.mediaDevices?.getUserMedia;
}

export function onVoiceStatusChange(listener: VoiceStatusListener) {
  voiceStatusListeners.add(listener);
  listener(isVoiceEnabled);

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

  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true
      },
      video: false
    });
  }

  getRemoteAudioContext();
  await resumeRemoteAudioContext();

  isVoiceEnabled = true;
  emitVoiceStatus();

  sendSocketMessage({
    type: "VOICE_SIGNAL",
    playerId: localPlayerId,
    enabled: true
  } satisfies VoiceSignalMessage);

  updateVoiceParticipants(remotePlayerIds);
  console.log("语音聊天已开启");
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
  emitVoiceStatus();

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
    return;
  }

  if (message.enabled === true) {
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
    await peerConnection.setRemoteDescription(new RTCSessionDescription(message.description));
    await flushPendingIceCandidates(message.playerId, peerConnection);

    if (message.description.type === "offer") {
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      sendVoiceSignal(message.playerId, { description: answer });
    }
  }

  if (message.candidate) {
    if (peerConnection.remoteDescription) {
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

  peerConnection = new RTCPeerConnection(RTC_CONFIG);
  peerConnections.set(remotePlayerId, peerConnection);

  localStream?.getTracks().forEach((track) => {
    peerConnection!.addTrack(track, localStream!);
  });

  peerConnection.ontrack = (event) => {
    const [stream] = event.streams;
    if (!stream) {
      return;
    }

    let audioElement = remoteAudioElements.get(remotePlayerId);
    if (!audioElement) {
      audioElement = new Audio();
      audioElement.autoplay = true;
      audioElement.volume = FALLBACK_REMOTE_VOLUME;
      remoteAudioElements.set(remotePlayerId, audioElement);
    }

    audioElement.srcObject = stream;
    playRemoteStreamSafely(remotePlayerId, stream, audioElement).catch((err) => {
      console.warn("远端语音播放被浏览器限制", err);
    });
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendVoiceSignal(remotePlayerId, { candidate: event.candidate.toJSON() });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    if (
      peerConnection?.connectionState === "failed" ||
      peerConnection?.connectionState === "closed" ||
      peerConnection?.connectionState === "disconnected"
    ) {
      closePeerConnection(remotePlayerId);
    }
  };

  if (shouldOffer) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
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
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
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

function emitVoiceStatus() {
  voiceStatusListeners.forEach((listener) => listener(isVoiceEnabled));
}
