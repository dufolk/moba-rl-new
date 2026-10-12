# 嚎哭深渊 · 1v1 MOBA（LoL-like）+ RL 接口

单线（大乱斗地图风格）1v1 MOBA，按英雄联盟的数值与机制复刻：盖伦 / 诺手 / 青钢影，小兵、防御塔、水晶、泉水、治疗遗物、闪现 / 引燃、商店与合成。
同一份确定性模拟核心同时驱动浏览器 3D 客户端和无头 RL 训练。

```
npm install
npm start            # http://localhost:8080 （端口被占用时：node server/serve.js 8137）
npm test             # 9 组英雄对局 bot vs bot + 回放确定性校验
npm run bench        # 无头吞吐（约 4.7 万 tick/s ≈ 1500 倍实时）
```

## 游戏

主菜单可选己方/对手英雄、AI 强度、画质，以及四种模式：

| 模式 | 说明 |
| --- | --- |
| 对战电脑 | 你 vs 规则 bot |
| 训练模式（木桩） | 对手站在中路不还手，5 秒出第一波兵 |
| 观战 AI 对战 | bot vs bot，`[` `]` 调速度（最高 8x），`1`/`2` 切换跟随 |
| 观看回放 | 列出 `replays/` 与 `runs/` 下的回放（训练脚本会自动写入），也可加载本地文件 |

操作与 LoL 一致：右键移动/攻击，`A`+左键攻击移动，`S` 停止，`QWER` 快捷施法（朝鼠标方向；R 自动选鼠标附近的敌方英雄），`Ctrl+QWER` 升级技能，`D` 闪现、`F` 引燃，`P` 商店（泉水内或阵亡时），`Y`/空格 镜头，滚轮缩放，`H` 帮助，`Esc` 暂停菜单（音量、指示器施法、自动加点、下载回放），`F9` RL 调试面板（实时显示当前观测向量与动作掩码）。

## 目录结构

```
src/sim/            确定性模拟核心（纯 JS，浏览器与 Node 共用，无 Math.random）
  game.js             Game：单位、攻击、技能、投射物、小兵/塔 AI、经济、回放
  combat.js           伤害/护甲/穿甲/护盾/治疗/重伤/CC/韧性/移速软上限
  champions/*.js      英雄定义（数值、技能、被动、obsFeatures）
  bot.js              规则 bot（只通过 game.command() 下指令，与人类/RL 同一接口）
  obs.js              RL 观测/动作/掩码编码
  data.js map.js      常量、小兵/塔/物品/召唤师技能、地图几何
src/client/         Three.js 客户端（场景、程序化模型、特效、HUD、输入、音效）
rl/bridge.js        Node 端 RL 桥：stdin/stdout NDJSON，单进程跑 N 局
python/moba_rl/     Python 封装：MobaVecEnv / gymnasium MobaEnv / RewardConfig
python/examples/    random_agent.py、ppo_vs_bot.py（掩码 PPO 基线）
tests/              sim_test.js、bench.js
tools/              开发辅助：shot.mjs（无头 Edge 截图/脚本化操作）、diag.mjs（bot 对局诊断）
```

模拟以 30 Hz 固定步长运行，所有随机数来自带种子的 `Rng`。回放 = 种子 + 输入日志 `[tick, team, cmd]`，任何一局（包括训练中的）都能在浏览器里逐帧重现。

## RL 接口

### Python

```python
import sys; sys.path.insert(0, "python")
from moba_rl import MobaVecEnv, RewardConfig

env = MobaVecEnv(
    num_envs=16,
    champions=("garen", "darius"),   # 任一项可写 "random"
    opponent="bot",                  # "bot" | "idle" | "self"（双方都由外部控制，自博弈）
    frame_skip=4,                    # 每个 agent step 推进 4 tick（≈0.13s）
    bot_difficulty=0.6,
    config={"maxGameTime": 600},     # 任意 DEFAULT_CONFIG 字段（startLevel、startGold、firstWaveTime…）
    replay_dir="runs/exp1/replays", replay_every=50,
)
obs, masks, info = env.reset()               # obs: (N, agents, 400)  masks: (N, agents, 23)
obs, rew, done, masks, info = env.step(acts) # acts: (N, agents, 3) int；结束的局自动重置
# info[i]["final_obs"], info[i]["episode"] = {return, length, winner}
env.state(0)                                  # 完整 JSON 快照（调试/自定义特征）
env.save_replay("runs/x.json", env=0)
```

`MobaEnv`（gymnasium，单 agent 蓝方）的 `info["action_mask"]` / `action_masks()` 可直接给 sb3-contrib 的 MaskablePPO 用。动作也可以直接传原始指令 dict，例如 `{"type": "move", "x": 5000, "y": 0}`、`{"type": "cast", "slot": "E", "x": ..., "y": ...}`。

### 动作空间 `MultiDiscrete([10, 16, 13])`

- 类型：0 noop、1 move、2 attack、3 Q、4 W、5 E、6 R、7 闪现、8 引燃、9 stop
- 方向：16 个方向（agent 自身坐标系），用于移动（350 距离）、指向性技能、闪现
- 目标槽：0 敌方英雄、1–8 最近的 8 个敌方小兵、9–11 敌方三座塔、12 敌方水晶（用于 attack）

掩码前 10 位对应类型（冷却、蓝量、沉默、眩晕、R 的施法距离等），后 13 位对应可攻击目标。

### 观测（400 维 float32）

| 段 | 维度 | 内容 |
| --- | --- | --- |
| 自己 / 敌方英雄 | 69 × 2 | 位置、相对位置、血蓝、等级、金币、属性、状态（眩晕/沉默/击飞/减速…）、每个技能的等级/就绪/冷却/可再次施放、英雄 one-hot、英雄专属特征（盖伦旋转、诺手出血层数、青钢影 Q 阶段/钩索…）、朝向、KDA、补刀 |
| 敌方 / 友方小兵 | 12 × 8 × 2 | 按距离排序：相对位置、血量、类型、是否在打我、**是否可补刀**、是否在攻击范围 |
| 建筑 | 8 × 8 | 双方 3 塔 + 水晶：存活、可被攻击、相对位置、血量、塔目标是否为我/敌方 |
| 全局 | 6 | 游戏时间、下一波兵倒计时、4 个治疗遗物是否可用 |

红方的观测做了点对称（x→L−x, y→−y，角度+π），一个策略可以同时打两边，自博弈直接共享参数。

### 奖励

`RewardConfig` 在 Python 侧用模拟器每步上报的计数器计算，权重可自由改：
`dmgToChamp, dmgTakenChamp, dmgTakenOther, dmgToStructure, gold, xp, lastHits, kills, deaths, towerKills, towersLost, healed`，外加胜负 ±10、`zero_sum`（自博弈）和 `time_penalty`。超时按双方建筑剩余血量判胜负。

### PPO 基线

```
py python/examples/ppo_vs_bot.py --champion garen --enemy darius --opponent idle
py python/examples/ppo_vs_bot.py --opponent bot --bot-difficulty 0.4 --num-envs 32
py python/examples/ppo_vs_bot.py --opponent self
```

单文件、CleanRL 风格：三头策略（类型/目标头使用掩码；方向头只在用到方向的动作上计入 log-prob，目标头只在 attack 上计入）、运行时观测归一化、GAE、线性学习率衰减。输出 `runs/<name>/policy.pt` 和周期性回放，回放直接出现在主菜单"观看回放"列表里。CPU 上含训练约 2000 agent-step/s。

### 直接用 Node 桥

`node rl/bridge.js` 读 stdin 的 NDJSON：`init / reset / step / command / state / save_replay / spec / close`，观测以 base64 的 float32 返回。其他语言（或别的 RL 框架）可以照 `python/moba_rl/bridge.py` 写一个几十行的客户端。

## 扩展

- 新英雄：在 `src/sim/champions/` 加一个定义文件（参考 `garen.js`），注册到 `champions/index.js`；客户端在 `src/client/models/champions.js` 加模型和动作姿态。观测里的英雄 one-hot 会随 `CHAMPION_KEYS` 自动增长（OBS_DIM 随之变化）。
- 规则 bot 与 RL 智能体走同一个 `game.command()` 接口，可以把 bot 当作对手、教师或行为克隆数据源。

## 已知不足

- 规则 bot 的青钢影明显偏弱（对盖伦/诺手大多以 1–4 杀输掉对线）；盖伦和诺手之间基本平衡。这只影响 bot 对手的强度，不影响模拟本身。
- 角色模型是程序化生成的低多边形风格，不是 LoL 原版资源。
