import Phaser from "phaser";
import { GameScene } from "../scenes/GameScene";

// 这里控制“相机视口”大小，不等于整张地图大小。
// 地图可以比这个大，相机会跟着玩家在地图里移动。
export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 320;

// Phaser 的全局配置集中放在这里，方便以后继续拆成多场景。
export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  // 这是 canvas 的底色。真正的地图背景还是由 Tilemap 负责绘制。
  backgroundColor: "#9bdc8c",
  // 像素风项目基本都建议打开，避免贴图被浏览器平滑处理。
  pixelArt: true,
  physics: {
    default: "arcade",
    arcade: {
      // 打开后会显示碰撞框，调试地图碰撞时很有用。
      debug: true
    }
  },
  // 当前项目只有一个主场景；以后可以继续加 BootScene、UIScene 等。
  scene: [GameScene],
  // 把 Phaser 挂到 index.html 里的 <div id="game"></div> 下面。
  parent: "game"
};
