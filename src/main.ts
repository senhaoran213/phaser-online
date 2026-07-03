// 项目入口：
// 1. 引入 Phaser 本体
// 2. 引入我们整理好的游戏配置
// 3. 引入全局样式，让页面容器能正确显示游戏画布
import Phaser from "phaser";
import { loadRuntimeConfig } from "./runtimeConfig";
import "./style.css";

// 创建 Phaser.Game 之后，Phaser 会自动进入配置里的第一个场景。
await loadRuntimeConfig();
const { GAME_HEIGHT, GAME_WIDTH, gameConfig } = await import("./config/gameConfig");

const game = new Phaser.Game(gameConfig);
const mobileViewportQuery = window.matchMedia("(hover: none), (pointer: coarse), (max-width: 900px)");

function getViewportSize() {
  const viewport = window.visualViewport;

  return {
    width: Math.max(320, Math.round(viewport?.width ?? window.innerWidth)),
    height: Math.max(320, Math.round(viewport?.height ?? window.innerHeight))
  };
}

function resizeGameViewport() {
  if (mobileViewportQuery.matches) {
    const { width, height } = getViewportSize();
    game.scale.resize(width, height);
    return;
  }

  game.scale.resize(GAME_WIDTH, GAME_HEIGHT);
}

resizeGameViewport();
window.addEventListener("resize", resizeGameViewport);
window.visualViewport?.addEventListener("resize", resizeGameViewport);
mobileViewportQuery.addEventListener("change", resizeGameViewport);
