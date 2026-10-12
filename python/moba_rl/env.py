"""RL environments on top of the headless JS simulator.

- MobaVecEnv: N games in one Node process, 1 or 2 learning agents per game
  (opponent='bot' | 'idle' | 'self'). Auto-resets finished games.
- MobaEnv:    gymnasium.Env, single agent (blue side) vs the scripted bot.

Action = MultiDiscrete([10 action types, 16 directions, 13 target slots]):
    type:   0 noop, 1 move, 2 attack, 3 Q, 4 W, 5 E, 6 R, 7 Flash, 8 Ignite, 9 stop
    dir:    direction in the agent's frame (move / point-cast / flash)
    target: 0 enemy champion, 1-8 nearest enemy minions, 9-11 enemy towers
            (nexus, inner, outer), 12 enemy nexus — used by 'attack'
Raw dict commands (e.g. {"type": "move", "x": 5000, "y": 0}) are accepted too.

Action masks: first 10 entries mask action types, the remaining 13 mask targets.
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np

from .bridge import NodeBridge, decode_f32, decode_u8
from .rewards import RewardConfig

try:
    import gymnasium as gym
    from gymnasium import spaces
except ImportError:  # gymnasium is optional for MobaVecEnv
    gym = None
    spaces = None


class MobaVecEnv:
    def __init__(
        self,
        num_envs: int = 8,
        champions: Sequence[str] = ("garen", "darius"),
        opponent: str = "bot",
        frame_skip: int = 4,
        reward: RewardConfig | None = None,
        seed: int = 0,
        config: dict | None = None,
        bot_difficulty: float = 1.0,
        replay_dir: str | None = None,
        replay_every: int = 0,
        node: str | None = None,
    ):
        controllers = {
            "bot": ["external", "bot"],
            "idle": ["external", "idle"],
            "self": ["external", "external"],
        }[opponent]
        cfg = {
            "champions": list(champions),
            "controllers": controllers,
            "botDifficulty": bot_difficulty,
            **(config or {}),
        }
        self.reward_fn = reward or RewardConfig(zero_sum=opponent == "self")
        self.bridge = NodeBridge(node=node)
        msg = self.bridge.call(
            "init",
            num_envs=num_envs,
            config=cfg,
            frame_skip=frame_skip,
            seed=seed,
            replay_dir=replay_dir,
            replay_every=replay_every,
        )
        s = msg["spec"]
        self.spec = s
        self.num_envs = num_envs
        self.agent_teams: list[int] = s["agent_teams"]
        self.num_agents = len(self.agent_teams)
        self.obs_dim: int = s["obs_dim"]
        self.mask_dim: int = s["mask_dim"]
        self.action_nvec: list[int] = s["action_nvec"]
        self._episode_returns = np.zeros((num_envs, self.num_agents), dtype=np.float64)
        self._episode_lengths = np.zeros(num_envs, dtype=np.int64)
        self._next_seed = seed + 10_000

    def _unpack(self, msg, n):
        obs = decode_f32(msg["obs"], (n, self.num_agents, self.obs_dim)).copy()
        masks = decode_u8(msg["masks"], (n, self.num_agents, self.mask_dim)).astype(bool)
        return obs, masks

    def reset(self, seeds: Sequence[int] | None = None):
        msg = self.bridge.call("reset", seeds=list(seeds) if seeds is not None else None)
        self._episode_returns[:] = 0
        self._episode_lengths[:] = 0
        obs, masks = self._unpack(msg, self.num_envs)
        return obs, masks, msg["info"]

    def step(self, actions):
        """actions: int array (num_envs, num_agents, 3) or nested lists with raw dict commands."""
        if isinstance(actions, np.ndarray):
            actions = actions.astype(int).tolist()
        msg = self.bridge.call("step", actions=actions)
        obs, masks = self._unpack(msg, self.num_envs)
        infos = msg["info"]
        dones = np.array(msg["done"], dtype=bool)
        rewards = np.zeros((self.num_envs, self.num_agents), dtype=np.float32)
        for i in range(self.num_envs):
            for a, team in enumerate(self.agent_teams):
                rewards[i, a] = self.reward_fn(msg["stats"][i], team, bool(dones[i]), infos[i]["winner"])
        self._episode_returns += rewards
        self._episode_lengths += 1

        done_ids = [i for i in range(self.num_envs) if dones[i]]
        if done_ids:
            for i in done_ids:
                infos[i] = {
                    **infos[i],
                    "final_obs": obs[i].copy(),
                    "episode": {
                        "return": self._episode_returns[i].copy(),
                        "length": int(self._episode_lengths[i]),
                        "winner": infos[i]["winner"],
                    },
                }
                self._episode_returns[i] = 0
                self._episode_lengths[i] = 0
            seeds = []
            for _ in done_ids:
                seeds.append(self._next_seed)
                self._next_seed += 1
            rmsg = self.bridge.call("reset", env_ids=done_ids, seeds=seeds)
            robs, rmasks = self._unpack(rmsg, len(done_ids))
            for j, i in enumerate(done_ids):
                obs[i] = robs[j]
                masks[i] = rmasks[j]
        return obs, rewards, dones, masks, infos

    def state(self, env: int = 0) -> dict:
        return self.bridge.call("state", env=env)["state"]

    def save_replay(self, path: str, env: int = 0) -> str:
        return self.bridge.call("save_replay", env=env, path=str(path))["path"]

    def close(self):
        self.bridge.close()


if gym is not None:

    class MobaEnv(gym.Env):
        """Single-agent gymnasium env (blue side). Action mask is in info['action_mask']."""

        metadata = {"render_modes": []}

        def __init__(self, champion: str = "garen", enemy: str = "darius", opponent: str = "bot", **kwargs: Any):
            assert opponent in ("bot", "idle")
            self.vec = MobaVecEnv(num_envs=1, champions=(champion, enemy), opponent=opponent, **kwargs)
            self.observation_space = spaces.Box(-np.inf, np.inf, (self.vec.obs_dim,), np.float32)
            self.action_space = spaces.MultiDiscrete(self.vec.action_nvec)
            self._mask = None

        def reset(self, *, seed: int | None = None, options: dict | None = None):
            super().reset(seed=seed)
            obs, masks, info = self.vec.reset(seeds=[seed] if seed is not None else None)
            self._mask = masks[0, 0]
            return obs[0, 0], {**info[0], "action_mask": self._mask}

        def step(self, action):
            obs, rew, done, masks, infos = self.vec.step(np.asarray(action).reshape(1, 1, 3))
            info = infos[0]
            terminal_obs = info.get("final_obs")
            o = terminal_obs[0] if done[0] else obs[0, 0]
            self._mask = masks[0, 0]
            truncated = bool(done[0] and info.get("timeout"))
            terminated = bool(done[0] and not truncated)
            return o, float(rew[0, 0]), terminated, truncated, {**info, "action_mask": self._mask}

        def action_masks(self):
            return self._mask

        def close(self):
            self.vec.close()
