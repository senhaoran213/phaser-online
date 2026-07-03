import type { PlayerSyncMessage } from "./messages";
import { parseSocketMessage } from "./messages";
import { handleWebRTCMessage, socket } from "../service/network";

// 这个函数负责把“收到服务器消息之后该做什么”交给场景自己定义。
// 好处是：网络层不直接操作 Phaser 对象，职责更清楚。
export function bindGameSocket(playerId: string, onMove: (msg: PlayerSyncMessage) => void) {
  const handleMessage = (ev: MessageEvent<string>) => {
    const msg = parseSocketMessage(ev.data);
    if (!msg) {
      return;
    }

    if (msg.type === "VOICE_SIGNAL") {
      void handleWebRTCMessage(msg);
      return;
    }

    // 自己发给服务器的消息会被广播回来，这里先过滤掉。
    if (msg.playerId === playerId) {
      return;
    }

    onMove(msg);
  };

  socket.addEventListener("message", handleMessage);

  return () => {
    socket.removeEventListener("message", handleMessage);
  };
}
