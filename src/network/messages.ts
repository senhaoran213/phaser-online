export type Direction = "up" | "down" | "left" | "right";

export type PlayerSyncMessage = {
  type: "PLAYER_JOIN" | "PLAYER_MOVE";
  playerId: string;
  name?: string;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  t?: number;
};

export type VoiceSignalMessage = {
  type: "VOICE_SIGNAL";
  playerId: string;
  targetPlayerId?: string;
  enabled?: boolean;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export type WorldSyncMessage = {
  type: "WORLD_SYNC";
  players: Array<Omit<PlayerSyncMessage, "type">>;
};

export type GameSocketMessage = PlayerSyncMessage | VoiceSignalMessage | WorldSyncMessage;

// 把服务端传来的方向值限制在客户端认识的范围内。
// 这样即使服务端传了奇怪字符串，也不会拼出不存在的动画名。
export function normalizeDirection(value: unknown): Direction {
  if (value === "left" || value === "right" || value === "up" || value === "down") {
    return value;
  }

  return "down";
}

export function parseSocketMessage(data: string): GameSocketMessage | null {
  try {
    const parsed = JSON.parse(data) as Partial<GameSocketMessage>;

    if (parsed.type === "VOICE_SIGNAL" && typeof parsed.playerId === "string") {
      return parsed as VoiceSignalMessage;
    }

    if (parsed.type === "WORLD_SYNC" && Array.isArray((parsed as Partial<WorldSyncMessage>).players)) {
      return {
        type: "WORLD_SYNC",
        players: (parsed as Partial<WorldSyncMessage>).players!
          .filter((player) => typeof player.playerId === "string" && typeof player.x === "number" && typeof player.y === "number")
          .map((player) => ({
            ...player,
            dir: normalizeDirection(player.dir),
            moving: Boolean(player.moving)
          }))
      };
    }

    if (
      (parsed.type === "PLAYER_JOIN" || parsed.type === "PLAYER_MOVE") &&
      typeof parsed.playerId === "string" &&
      typeof parsed.x === "number" &&
      typeof parsed.y === "number"
    ) {
      return {
        ...parsed,
        dir: normalizeDirection(parsed.dir),
        moving: Boolean(parsed.moving)
      } as PlayerSyncMessage;
    }
  } catch (err) {
    console.warn("收到无法解析的 WebSocket 消息", err);
  }

  return null;
}
