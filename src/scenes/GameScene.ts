import Phaser from "phaser";
import { bindGameSocket } from "../network/gameSocket";
import {
  detailData,
  groundData,
  mapHeight,
  mapWidth,
  PLAYER_SPAWN,
  TerrainTile,
  TILE_SIZE,
  worldHeight,
  worldWidth
} from "../maps/emeraldMap";
import {
  isVoiceChatSupported,
  onSocketStatusChange,
  onVoiceStatusChange,
  retrySocketConnection,
  sendSocketMessage,
  startVoiceChat,
  stopVoiceChat,
  updateVoiceParticipants
} from "../service/network";
import type { Direction } from "../network/messages";
import type { SocketStatus, VoiceStatus } from "../service/network";
import { normalizeDirection } from "../network/messages";
import { createTerrainTileset } from "../render/createTerrainTileset";

function createPlayerId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  const randomPart = Math.random().toString(36).slice(2);
  return `player-${Date.now().toString(36)}-${randomPart}`;
}

const REMOTE_PLAYER_TIMEOUT_MS = 10_000;
const REMOTE_PLAYER_CLEANUP_INTERVAL_MS = 1_000;

type RemotePlayerState = {
  sprite: Phaser.Physics.Arcade.Sprite;
  colliders: Phaser.Physics.Arcade.Collider[];
  lastSeenAt: number;
};

/**
 * GameScene 是当前项目的核心场景。
 *
 * 这个文件基本可以理解成“游戏主循环的组织者”，主要负责四件事：
 * 1. preload：把角色动画资源提前加载进内存
 * 2. create：初始化地图、玩家、相机、输入、联机监听
 * 3. update：每一帧根据按键更新本地玩家移动和动画
 * 4. socket 回调：收到其他玩家广播时，把远程角色显示出来
 *
 * 你以后排查问题时，建议先按这个顺序看：
 * - 地图不对：看 createMap()
 * - 玩家动不了：看 update() / registerInput()
 * - 碰撞不对：看 createMap() 和 createPlayer()
 * - 其他玩家不同步：看 bindRemotePlayers() / syncToServer()
 */
export class GameScene extends Phaser.Scene {
  /** 本地玩家，也就是当前浏览器控制的角色。 */
  private player!: Phaser.Physics.Arcade.Sprite;

  /** Phaser 提供的方向键输入对象，内部会维护 up/down/left/right 的按下状态。 */
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  /** 手机端虚拟方向键状态。 */
  private touchInput: Record<Direction, boolean> = {
    up: false,
    down: false,
    left: false,
    right: false
  };

  /** 手机端虚拟按键容器。 */
  private mobileControls?: HTMLElement;

  /**
   * 所有参与碰撞的地图层。
   *
   * 注意：
   * “某个 tile 被 setCollision 标记成会碰撞” 和
   * “玩家真的会被这个 layer 挡住” 不是一回事。
   *
   * 需要同时满足两步：
   * 1. 在 layer 上调用 setCollision(...)
   * 2. 在玩家身上调用 physics.add.collider(player, layer)
   *
   * 少了任意一步，都会表现成“碰撞好像没生效”。
   */
  private collisionLayers: Phaser.Tilemaps.TilemapLayer[] = [];

  /** 远程玩家表：key 是玩家 ID，value 是精灵、碰撞器和最后活跃时间。 */
  private remotePlayers = new Map<string, RemotePlayerState>();

  /** 定时清理长时间没有收到同步消息的远程玩家。 */
  private remotePlayerCleanupTimerId?: number;

  /** 每次刷新页面会生成新的本地玩家 ID，用来和其他玩家区分。 */
  private playerId = createPlayerId();

  /** 玩家名字，进入场景时通过页面内输入框获取。 */
  private playerName = "";

  /**
   * 记录角色最后一次有效移动方向。
   *
   * 用途有两个：
   * 1. 没有按键时，依然知道角色刚才面朝哪个方向
   * 2. 发给服务器时，能告诉别人我最后朝向是什么
   */
  private lastDirection: Direction = "down";

  /** 上一次向服务器同步位置的时间戳，用来做发包节流。 */
  private lastSyncTime = 0;

  /** 页面级语音按钮，必须由用户点击触发麦克风授权。 */
  private voiceButton?: HTMLButtonElement;

  /** 取消语音状态监听，场景关闭时清理。 */
  private unsubscribeVoiceStatus?: () => void;

  /** 取消 WebSocket 状态监听，场景关闭时清理。 */
  private unsubscribeSocketStatus?: () => void;

  /** 取消 WebSocket 监听，场景关闭时清理。 */
  private unbindGameSocket?: () => void;

  constructor() {
    // key 是 Phaser 内部识别场景的名字。
    super({ key: "GameScene" });
  }

  /**
   * preload 阶段只做“加载资源”，不要在这里创建玩家或地图。
   *
   * Phaser 的生命周期通常是：
   * preload -> create -> update(每帧)
   */
  preload() {
    // 这里直接加载 Aseprite 导出的 png + json，
    // Phaser 会自动根据 json 里的信息生成动画帧。
    const assetBaseUrl = import.meta.env.BASE_URL;
    this.load.aseprite(
      "haruka",
      `${assetBaseUrl}player/haruka/Sprite-0002.png`,
      `${assetBaseUrl}player/haruka/Sprite-0002.json`
    );
    this.load.audio("bgm", `${assetBaseUrl}audio/%E3%83%9F%E3%82%B7%E3%83%AD%E3%82%BF%E3%82%A6%E3%83%B3%20.ogg`);
  }

  /**
   * create 只会在场景启动时执行一次。
   *
   * 这里最重要的是初始化顺序：
   * 1. 先建地图
   * 2. 再建玩家
   * 3. 再挂相机、输入、联机逻辑
   *
   * 原因是：
   * 玩家在创建时就要立刻绑定碰撞层，
   * 所以地图和碰撞层必须先准备好。
   */
  create() {
    this.showPlayerNameDialog((name) => {
      this.playerName = name;
      this.startGame();
    });
  }

  private startGame() {
    // 先创建地图和碰撞层。
    this.createMap();
    // 再注册角色动画。
    this.createPlayerAnimations();
    // 然后创建本地玩家。
    this.createPlayer();
    // 监听其他玩家的联机消息。
    this.bindRemotePlayers();
    // 相机要在玩家创建完成后才能跟随玩家。
    this.registerCamera();
    // 输入监听也放在创建完成后注册。
    this.registerInput();
    // 手机端虚拟按键独立于 Phaser canvas，桌面端通过 CSS 隐藏。
    this.createMobileControls();
    // 创建语音开关按钮，点击后再请求麦克风权限。
    this.createVoiceControls();
    // 背景音乐先暂停自动播放，避免影响语音聊天测试。

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.voiceButton?.remove();
      this.voiceButton = undefined;
      this.unsubscribeVoiceStatus?.();
      this.unsubscribeVoiceStatus = undefined;
      this.unsubscribeSocketStatus?.();
      this.unsubscribeSocketStatus = undefined;
      this.unbindGameSocket?.();
      this.unbindGameSocket = undefined;
      this.stopRemotePlayerCleanup();
      this.removeAllRemotePlayers();
      stopVoiceChat();
    });
  }

  /**
   * update 会在每一帧被 Phaser 调用。
   *
   * 这个函数不直接“移动地图”，而是：
   * 1. 读取键盘输入
   * 2. 计算角色速度
   * 3. 设置角色速度和动画
   * 4. 把当前位置定时同步给服务器
   */
  update() {
    // 防御式判断，避免场景初始化失败时继续访问空对象。
    if (!this.player || !this.cursors) {
      return;
    }

    // Arcade Physics 中 velocity 的单位是“像素 / 秒”。
    const speed = 85;
    let velocityX = 0;
    let velocityY = 0;

    // 默认沿用上一次方向。
    // 这样当玩家松开按键时，我们仍然知道“最后一次朝哪里移动过”。
    let direction: Direction = this.lastDirection;

    // 当前是传统宝可梦式四方向移动：
    // 使用 else-if 保证同一时刻只响应一个方向，不会出现斜着走。
    if (this.cursors.left?.isDown || this.touchInput.left) {
      velocityX = -speed;
      direction = "left";
    } else if (this.cursors.right?.isDown || this.touchInput.right) {
      velocityX = speed;
      direction = "right";
    } else if (this.cursors.up?.isDown || this.touchInput.up) {
      velocityY = -speed;
      direction = "up";
    } else if (this.cursors.down?.isDown || this.touchInput.down) {
      velocityY = speed;
      direction = "down";
    }

    // 真正把速度交给 Phaser 物理系统。
    // 后续的碰撞检测也是基于这个物理系统完成的。
    this.player.setVelocity(velocityX, velocityY);

    // 只要某个方向有速度，就说明角色正在移动。
    const isMoving = velocityX !== 0 || velocityY !== 0;

    // 动画切换逻辑：
    // - 移动中：播放 walk_方向
    // - 停下时：播放最后移动方向对应的静止帧
    this.player.play(isMoving ? `walk_${direction}` : this.getIdleAnimation(direction), true);

    // 只有判断出新的方向后，才更新 lastDirection。
    this.lastDirection = direction;

    // 每帧都会尝试同步，但 syncToServer 内部有节流，不会真的每帧发。
    this.syncToServer(direction, isMoving);
  }

  /**
   * 显示页面内姓名输入框。
   * iPhone Safari 对页面加载时自动触发的 prompt 支持不稳定，
   * 用真实 DOM 输入框会更适合手机端。
   */
  private showPlayerNameDialog(onSubmit: (name: string) => void) {
    const existingOverlay = document.querySelector(".player-name-overlay");
    existingOverlay?.remove();

    const overlay = document.createElement("div");
    overlay.className = "player-name-overlay";

    const panel = document.createElement("form");
    panel.className = "player-name-panel";

    const title = document.createElement("h1");
    title.textContent = "输入你的游戏名";

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 12;
    input.placeholder = `玩家-${this.playerId.slice(0, 4)}`;
    input.autocomplete = "off";
    input.autocapitalize = "none";

    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "进入游戏";

    panel.append(title, input, button);
    overlay.append(panel);
    document.body.append(overlay);

    panel.addEventListener("submit", (event) => {
      event.preventDefault();

      const name = input.value.trim() || `玩家-${this.playerId.slice(0, 4)}`;
      overlay.remove();
      onSubmit(name);
    });

    window.setTimeout(() => {
      input.focus();
    }, 100);
  }

  /**
   * 创建地图和碰撞层。
   *
   * 这是当前文件里和“碰撞问题”最相关的函数。
   *
   * 当前碰撞的整体流程是：
   * 1. 用 createTerrainTileset 生成一个临时地块图集
   * 2. 创建 tilemap
   * 3. 创建 ground / detail 两个 layer
   * 4. 把二维数组铺到 layer 上
   * 5. 对特定 tile 编号调用 setCollision
   * 6. 把这些 layer 存到 collisionLayers，供玩家创建时绑定 collider
   */
  private createMap() {
    // 先创建一张名字叫 terrain 的纹理，
    // 后面 addTilesetImage("terrain", "terrain") 会用到它。
    createTerrainTileset(this, "terrain");

    // 创建一个空的 tilemap 容器。
    // 注意这里的 width/height 是“地图有多少格”，不是像素。
    const map = this.make.tilemap({
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      width: mapWidth,
      height: mapHeight
    });

    // 把上面创建的 terrain 纹理注册成 tileset。
    // 前一个 terrain 是 tileset 名字，后一个 terrain 是纹理 key。
    const tileset = map.addTilesetImage("terrain", "terrain", TILE_SIZE, TILE_SIZE, 0, 0);
    if (!tileset) {
      throw new Error("Failed to create terrain tileset");
    }

    // 创建两层地图：
    // ground：基础地面层，负责草地、道路、水、树
    // detail：装饰层，负责草丛、石头
    //
    // 为什么分层？
    // 因为地图通常不是所有东西都在同一层上，分层后更容易控制渲染和碰撞。
    const groundLayer = map.createBlankLayer("ground", tileset, 0, 0);
    const detailLayer = map.createBlankLayer("detail", tileset, 0, 0);
    if (!groundLayer || !detailLayer) {
      throw new Error("Failed to create tilemap layers");
    }

    // 把二维数组里的 tile 编号真正铺到 layer 上。
    // 到这一步为止，地图只是“画出来了”，碰撞还没有生效。
    groundLayer.putTilesAt(groundData, 0, 0);
    detailLayer.putTilesAt(detailData, 0, 0);

    // 给 layer 中的特定 tile 编号打上“会碰撞”的标记。
    //
    // 这里的意思是：
    // - groundLayer 里的水和树不可通过
    // - detailLayer 里的草丛和石头不可通过
    //
    // 但请注意：
    // 这里只是告诉 layer“这些 tile 该碰撞”，
    // 还没有告诉玩家“你要和这个 layer 发生碰撞”。
    groundLayer.setCollision([TerrainTile.Water, TerrainTile.Tree]);
    detailLayer.setCollision([TerrainTile.Bush, TerrainTile.Rock]);

    // 把所有碰撞层收集起来，后面玩家和远程玩家创建时都会循环绑定。
    this.collisionLayers = [groundLayer, detailLayer];

    // 设置整个物理世界的边界，让玩家不会跑出地图外。
    this.physics.world.setBounds(0, 0, worldWidth, worldHeight);
  }

  /**
   * 创建角色动画。
   *
   * createFromAseprite 会读取 haruka 对应 json 里的动画定义，
   * 比如 stand / walk_up / walk_down 等。
   */
  private createPlayerAnimations() {
    // 动画是全局共享的，所以只创建一次即可。
    if (this.anims.exists("stand")) {
      return;
    }

    this.anims.createFromAseprite("haruka");
  }

  /**
   * 创建本地玩家。
   *
   * 这个函数里最重要的是两件事：
   * 1. 设置角色碰撞箱
   * 2. 让角色和所有 collisionLayers 建立 collider
   */
  private createPlayer() {
    // 根据地图里配置好的出生点生成玩家。
    this.player = this.physics.add.sprite(PLAYER_SPAWN.x, PLAYER_SPAWN.y, "haruka");

    // 防止角色跑出整个地图边界。
    this.player.setCollideWorldBounds(true);

    // 角色整张图比“真正占地面积”大，所以碰撞箱通常不能和整张精灵一样大。
    // 这里把碰撞箱缩到角色脚底区域，效果更接近 RPG 地图移动。
    //
    // 如果你感觉“明明没碰到树却被挡住了”，
    // 优先调这两个值：
    // - setSize(width, height)
    // - setOffset(x, y)右，下
    this.player.setSize(12, 8);
    this.player.setOffset(2, 13);

    // 默认播放站立动画。
    this.player.play("stand");

    // 真正把本地玩家和地图碰撞层连接起来。
    // 这一步缺了的话，即使 layer 设置了 collision，玩家也还是能穿过去。
    this.collisionLayers.forEach((layer) => {
      this.physics.add.collider(this.player, layer);
    });
  }

  /**
   * 绑定远程玩家逻辑。
   *
   * 当服务器广播别人的 PLAYER_JOIN / PLAYER_MOVE 时：
   * 1. 如果本地还没有这个玩家，就先创建一个远程精灵
   * 2. 把它的位置更新到服务器给的坐标
   * 3. 根据方向播放相应动画
   */
  private bindRemotePlayers() {
    this.unbindGameSocket?.();
    this.startRemotePlayerCleanup();
    this.unbindGameSocket = bindGameSocket(this.playerId, (msg) => {
      // 先把服务器发来的方向字符串做一次兜底处理。
      const direction = normalizeDirection(msg.dir);
      let remote = this.remotePlayers.get(msg.playerId);

      if (!remote) {
        // 第一次收到这个玩家的消息，说明需要在本地生成他的角色。
        const sprite = this.physics.add.sprite(msg.x ?? PLAYER_SPAWN.x, msg.y ?? PLAYER_SPAWN.y, "haruka");
        sprite.setCollideWorldBounds(true);

        // 远程玩家也使用同样的碰撞箱，否则视觉和本地玩家会不一致。
        sprite.setSize(12, 8);
        sprite.setOffset(2, 13);

        // 远程玩家也挂到同样的地图碰撞层上。
        // 这样别人移动到树或水附近时，本地画面也更一致。
        const colliders = this.collisionLayers.map((layer) => this.physics.add.collider(sprite, layer));

        remote = {
          sprite,
          colliders,
          lastSeenAt: Date.now()
        };
        this.remotePlayers.set(msg.playerId, remote);
      }

      remote.lastSeenAt = Date.now();
      updateVoiceParticipants([...this.remotePlayers.keys()]);

      // 当前联机同步方案比较简单：
      // 服务端广播“最终位置”，本地直接瞬移到那个位置。
      // 后面如果想更丝滑，可以改成 tween 或插值。
      remote.sprite.setPosition(msg.x, msg.y);
      remote.sprite.play(msg.moving ? `walk_${direction}` : this.getIdleAnimation(direction), true);
    }, (remotePlayerIds) => {
      const activeRemotePlayerIds = new Set(remotePlayerIds);

      this.remotePlayers.forEach((_remote, remotePlayerId) => {
        if (!activeRemotePlayerIds.has(remotePlayerId)) {
          this.removeRemotePlayer(remotePlayerId);
        }
      });
    });
  }

  private startRemotePlayerCleanup() {
    this.stopRemotePlayerCleanup();

    this.remotePlayerCleanupTimerId = window.setInterval(() => {
      this.removeStaleRemotePlayers();
    }, REMOTE_PLAYER_CLEANUP_INTERVAL_MS);
  }

  private stopRemotePlayerCleanup() {
    if (this.remotePlayerCleanupTimerId === undefined) {
      return;
    }

    window.clearInterval(this.remotePlayerCleanupTimerId);
    this.remotePlayerCleanupTimerId = undefined;
  }

  private removeStaleRemotePlayers() {
    const now = Date.now();

    this.remotePlayers.forEach((remote, remotePlayerId) => {
      if (now - remote.lastSeenAt >= REMOTE_PLAYER_TIMEOUT_MS) {
        this.removeRemotePlayer(remotePlayerId);
      }
    });
  }

  private removeRemotePlayer(playerId: string) {
    const remote = this.remotePlayers.get(playerId);
    if (!remote) {
      return;
    }

    remote.colliders.forEach((collider) => collider.destroy());
    remote.sprite.destroy();
    this.remotePlayers.delete(playerId);
    updateVoiceParticipants([...this.remotePlayers.keys()]);
  }

  private removeAllRemotePlayers() {
    [...this.remotePlayers.keys()].forEach((playerId) => {
      this.removeRemotePlayer(playerId);
    });
  }

  /**
   * 注册相机设置。
   *
   * 主相机会：
   * 1. 限制在地图范围内
   * 2. 跟随本地玩家
   * 3. 放大 2 倍，强化像素风表现
   */
  private registerCamera() {
    // 不让相机看到地图外的空白区域。
    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);

    // 让相机跟随玩家。
    // 后面的 0.15, 0.15 是跟随平滑系数，值越小越“慢慢跟上”。
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

    // 放大画面，让 16x16 的 tile 更容易观察。
    this.cameras.main.setZoom(2);

    // roundPixels 有助于减少像素风在移动时的模糊/抖动感。
    this.cameras.main.roundPixels = true;
  }

  /**
   * 注册键盘输入。
   *
   * createCursorKeys 会返回一个包含 up/down/left/right 的对象，
   * 后面 update 里直接读 isDown 即可。
   */
  private registerInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
  }

  private createMobileControls() {
    this.mobileControls?.remove();

    const controls = document.createElement("div");
    controls.className = "mobile-controls";

    const dpad = document.createElement("div");
    dpad.className = "mobile-dpad";
    dpad.append(
      this.createControlButton("up", ""),
      this.createControlButton("left", ""),
      this.createControlButton("right", ""),
      this.createControlButton("down", "")
    );

    const actions = document.createElement("div");
    actions.className = "mobile-actions";
    actions.append(this.createActionButton("B"), this.createActionButton("A"));
    controls.append(dpad, actions);

    document.body.append(controls);
    this.mobileControls = controls;
  }

  private createControlButton(direction: Direction, label: string) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mobile-control-button mobile-control-${direction}`;
    button.textContent = label;
    button.setAttribute("aria-label", direction);

    const setPressed = (isPressed: boolean) => {
      this.touchInput[direction] = isPressed;
    };

    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      setPressed(true);
    });

    button.addEventListener("pointerup", () => setPressed(false));
    button.addEventListener("pointercancel", () => setPressed(false));
    button.addEventListener("pointerleave", () => setPressed(false));
    button.addEventListener("lostpointercapture", () => setPressed(false));

    return button;
  }

  private createActionButton(label: string) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mobile-action-button";
    button.textContent = label;
    button.setAttribute("aria-label", label);
    return button;
  }

  private createVoiceControls() {
    this.voiceButton?.remove();
    this.unsubscribeVoiceStatus?.();
    this.unsubscribeSocketStatus?.();

    const button = document.createElement("button");
    button.type = "button";
    button.className = "voice-chat-button";

    document.body.append(button);
    this.voiceButton = button;

    let currentVoiceStatus: VoiceStatus = "off";
    let currentSocketStatus: SocketStatus = "closed";

    const updateButtonState = () => {
      const isSocketOpen = currentSocketStatus === "open";
      const isVoiceUnavailable = !isVoiceChatSupported();

      if (!isSocketOpen) {
        button.textContent = currentSocketStatus === "connecting" ? "连接中" : "单机模式";
        button.disabled = currentSocketStatus === "connecting";
        button.classList.remove("voice-chat-button-active");
        return;
      }

      if (isVoiceUnavailable) {
        button.textContent = "不支持语音";
        button.disabled = true;
        button.classList.remove("voice-chat-button-active");
        return;
      }

      button.textContent = this.getVoiceButtonText(currentVoiceStatus);
      button.classList.toggle("voice-chat-button-active", currentVoiceStatus === "connected");
      button.disabled = currentVoiceStatus === "starting";
    };

    this.unsubscribeSocketStatus = onSocketStatusChange((status) => {
      const wasOffline = currentSocketStatus !== "open";
      currentSocketStatus = status;
      updateButtonState();

      if (status === "open" && wasOffline) {
        this.announcePlayerJoin();
      }
    });

    this.unsubscribeVoiceStatus = onVoiceStatusChange((status) => {
      currentVoiceStatus = status;
      updateButtonState();
    });

    button.addEventListener("click", async () => {
      if (currentSocketStatus !== "open") {
        retrySocketConnection();
        return;
      }

      if (currentVoiceStatus === "starting") {
        return;
      }

      if (currentVoiceStatus === "waiting" || currentVoiceStatus === "connected") {
        stopVoiceChat();
        return;
      }

      button.disabled = true;
      button.textContent = "开启中";

      try {
        const started = await startVoiceChat(this.playerId, [...this.remotePlayers.keys()]);
        if (!started) {
          currentVoiceStatus = "failed";
          updateButtonState();
        }
      } catch (err) {
        console.error("语音聊天启动失败", err);
        currentVoiceStatus = "failed";
        updateButtonState();
      }
    });
  }

  private getVoiceButtonText(status: VoiceStatus) {
    if (status === "starting") {
      return "开启中";
    }

    if (status === "waiting") {
      return "连接中";
    }

    if (status === "connected") {
      return "语音开";
    }

    if (status === "failed") {
      return "重试语音";
    }

    return "开启语音";
  }

  private announcePlayerJoin() {
    if (!this.player) {
      return;
    }

    sendSocketMessage({
      type: "PLAYER_JOIN",
      playerId: this.playerId,
      name: this.playerName,
      x: this.player.x,
      y: this.player.y,
      dir: this.lastDirection,
      moving: false
    });
  }

  /**
   * 根据最后朝向选择静止动画。
   *
   * Aseprite 里当前静止帧命名是：
   * - stand：朝下
   * - back：朝上
   * - left/right：左右
   */
  private getIdleAnimation(direction: Direction) {
    if (direction === "up") {
      return "back";
    }

    if (direction === "left" || direction === "right") {
      return direction;
    }

    return "stand";
  }

  /**
   * 把本地玩家的位置和方向同步给服务器。
   *
   * 这里做了一个很简单的节流：
   * 至多每 50ms 发一次，也就是大约 20 次 / 秒。
   *
   * 这样做的原因：
   * 1. 减少 WebSocket 压力
   * 2. 避免每一帧都发包
   * 3. 对简单 2D 联机演示已经足够
   */
  private syncToServer(dir: Direction, isMoving: boolean) {
    const now = Date.now();

    // 距离上次发送太近，就直接跳过。
    if (now - this.lastSyncTime < 50) {
      return;
    }

    this.lastSyncTime = now;

    // 发给服务端的数据包括：
    // - 我是谁
    // - 我现在在哪
    // - 我当前朝向是什么
    // - 时间戳是多少
    sendSocketMessage({
      type: "PLAYER_MOVE",
      playerId: this.playerId,
      x: this.player.x,
      y: this.player.y,
      dir,
      moving: isMoving,
      t: now
    });
  }
}
