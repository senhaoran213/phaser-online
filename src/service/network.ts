// 这个地方只要页面加载就会马上执行
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