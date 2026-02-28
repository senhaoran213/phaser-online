/**
 * 创建了一个 Phaser 场景 MyGame。
 * 本地玩家是 haruka
 * 每一帧 update 里你根据方向键计算速度
 * 
 * 移动逻辑：
 * 1）本地角色移动
 * 2）播放对应动画
 * 3）每 50ms 把自己的坐标 + 方向通过 WebSocket 发给服务器
 * 
 * phaser概念：
 *   physics：Arcade Physics —— 一个轻量级 2D 物理系统
 */
import Phaser from "phaser";
import { socket } from './service/network'



export class MyGame extends Phaser.Scene {
  //自己的人物
  private haruka!: Phaser.Physics.Arcade.Sprite;
  private playerId = crypto.randomUUID()
  //其他玩家的人物
  private players = new Map<string, Phaser.Physics.Arcade.Sprite>();

  //相当于键盘事件监听器吧
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  constructor() {
    super({ key: "MyGame" });
  }

  preload() {
    this.load.aseprite('haruka', '/player/haruka/Sprite-0002.png', '/player/haruka/Sprite-0002.json');
  }

  create() {
    this.anims.createFromAseprite('haruka');
    this.physics.world.setBounds(0, 0, 300, 300);

    this.haruka = this.physics.add.sprite(100, 100, 'haruka');
    this.haruka.play('stand');
    this.haruka.setCollideWorldBounds(true);

    this.cursors = this.input.keyboard!.createCursorKeys();

    // ✅ 在这里绑定 WebSocket 消息
    socket.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);

      if (msg.type === 'PLAYER_MOVE') {
        //自己发的消息不做改动
        if (msg.playerId === this.playerId) return;

        let player = this.players.get(msg.playerId);

        if (!player) {
          //如果第一次进来本地还没有这个player的话就创建这个玩家到players里面
          //物理引擎physis
          console.log('新玩家加入:', msg.playerId);
          player = this.physics.add.sprite(msg.x, msg.y, 'haruka');
          //默认动作
          player.play('stand');
          this.players.set(msg.playerId, player);
        }

        player.setPosition(msg.x, msg.y);
        player.play(`walk_${msg.dir}`, true);
      }
    };
  }

  update() {
    this.haruka.setVelocity(0);

    const speed = 100;
    let vx = 0;
    let vy = 0;
    let dir = 'stand';

    if (this.cursors.left?.isDown) {
      vx = -speed;
      dir = 'left';
      this.haruka.play('walk_left', true);
    } else if (this.cursors.right?.isDown) {
      vx = speed;
      dir = 'right';
      this.haruka.play('walk_right', true);
    } else if (this.cursors.up?.isDown) {
      vy = -speed;
      dir = 'up';
      this.haruka.play('walk_up', true);
    } else if (this.cursors.down?.isDown) {
      vy = speed;
      dir = 'down';
      this.haruka.play('walk_down', true);
    } else {
      this.haruka.play('stand', true);
    }

    this.haruka.setVelocity(vx, vy);
    this.syncToServer(dir);
  }

  lastSyncTime = 0;

  syncToServer(dir: string) {
    const now = Date.now();

    // 20 次 / 秒，够用了
    if (now - this.lastSyncTime < 50) return;
    this.lastSyncTime = now;

    socket.send(JSON.stringify({
      type: 'PLAYER_MOVE',
      playerId: this.playerId,
      x: this.haruka.x,
      y: this.haruka.y,
      dir,
      t: now
    }));
  }

}