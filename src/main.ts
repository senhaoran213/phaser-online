import Phaser from "phaser";
import { MyGame } from "./game";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 300,
  height: 300,
  backgroundColor: "#eeeeee",
  pixelArt: true,
  physics: {
    default: "arcade",
    arcade: { debug: false }
  },
  scene: [MyGame],
  //加载的phaser放到id为game的容器里面
  parent: "game"
};

new Phaser.Game(config);
