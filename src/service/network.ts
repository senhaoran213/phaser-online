// 这个模块一旦被 import，就会立刻创建 WebSocket 连接。
// 这里默认去连本机 3001 端口的服务端。
const WS_URL = `ws://${location.hostname}:3001`
export const socket = new WebSocket(WS_URL)

socket.onopen = () => {
  console.log('connected to server')
}

socket.onclose = () => {
  console.log('disconnected from server')
}

socket.onerror = (err) => {
  console.error('ws error', err)
}

// 统一的发送函数：
// 1. 避免每个场景都自己 JSON.stringify
// 2. 在连接还没建立好时直接跳过，减少报错
export function sendSocketMessage(payload: unknown) {
  if (socket.readyState !== WebSocket.OPEN) {
    return
  }

  socket.send(JSON.stringify(payload))
}
