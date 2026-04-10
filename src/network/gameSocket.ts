import { socket } from "../service/network"

// 这个函数负责把“收到服务器消息之后该做什么”交给场景自己定义。
// 好处是：网络层不直接操作 Phaser 对象，职责更清楚。
export function bindGameSocket(
    playerId: string,
    onMove: (msg: any) => void
  ) {
    socket.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
  
      // 当前只处理玩家加入和玩家移动两类消息。
      if (msg.type === 'PLAYER_MOVE' || msg.type === 'PLAYER_JOIN') {
        // 自己发给服务器的消息会被广播回来，这里先过滤掉。
        if (msg.playerId === playerId) return
        onMove(msg)
      }
    }
  }
