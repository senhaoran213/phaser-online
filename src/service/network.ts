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

// ======================
// 【新增】兼容 Safari 的语音聊天功能 //未成功
// ======================
let localStream: MediaStream | null = null
let peerConnection: RTCPeerConnection | null = null
const isVoiceSupported = !!window.RTCPeerConnection

// WebRTC 配置（兼容所有浏览器，包括 Safari）
const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
}

/**
 * 【必须用户点击调用】开启语音聊天
 * Safari 强制要求：必须由用户交互（click/touch）触发
 */
export async function startVoiceChat() {
  if (!isVoiceSupported) {
    console.warn('当前浏览器不支持语音通话')
    return
  }

  try {
    // 1. 获取麦克风权限
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false
    })

    // 2. 创建 WebRTC 连接
    peerConnection = new RTCPeerConnection(RTC_CONFIG)

    // 3. 添加本地音频轨道
    localStream.getTracks().forEach(track => {
      peerConnection!.addTrack(track, localStream!)
    })

    // 4. 监听远端音频（播放别人的声音）
    peerConnection.ontrack = (e) => {
      const audioEl = new Audio()
      audioEl.srcObject = e.streams[0]
      audioEl.play().catch(err => console.warn('音频自动播放被限制', err))
    }

    // 5. 发送 ICE 网络信息（必须，否则连不上）
    peerConnection.onicecandidate = (e) => {
      if (e.candidate) {
        sendSocketMessage({
          type: 'webrtc',
          candidate: e.candidate
        })
      }
    }

    // 6. 创建并发送通话邀请
    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)
    sendSocketMessage({
      type: 'webrtc',
      offer: offer
    })

    console.log('✅ 语音聊天已启动（麦克风已开启）')
  } catch (err) {
    console.error('❌ 语音启动失败：', err)
  }
}

/**
 * 关闭语音聊天
 */
export function stopVoiceChat() {
  // 关闭麦克风
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop())
    localStream = null
  }

  // 关闭 WebRTC 连接
  if (peerConnection) {
    peerConnection.close()
    peerConnection = null
  }

  console.log('🛑 语音聊天已关闭')
}

/**
 * 处理服务端发来的 WebRTC 信令（必须调用！）
 * 在你接收消息的地方调用 handleWebRTCMessage(data)
 */
export function handleWebRTCMessage(data: any) {
  if (!peerConnection || !data.type || data.type !== 'webrtc') return

  try {
    // 收到对方的邀请
    if (data.offer) {
      peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer))
        .then(async () => {
          const answer = await peerConnection!.createAnswer()
          await peerConnection!.setLocalDescription(answer)
          sendSocketMessage({
            type: 'webrtc',
            answer: answer
          })
        })
    }

    // 收到对方的应答
    if (data.answer) {
      peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer))
    }

    // 收到网络节点信息
    if (data.candidate) {
      peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
    }
  } catch (err) {
    console.warn('WebRTC 信令处理失败', err)
  }
}