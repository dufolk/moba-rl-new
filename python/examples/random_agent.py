"""Masked-random agent vs the scripted bot; saves a replay you can watch in the browser.

    py python/examples/random_agent.py
"""

import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from moba_rl import MobaVecEnv  # noqa: E402


def sample_masked(rng, masks, nvec):
    n_env, n_agent, _ = masks.shape
    acts = np.zeros((n_env, n_agent, 3), dtype=np.int64)
    nt = nvec[0]
    for i in range(n_env):
        for a in range(n_agent):
            tmask = masks[i, a, :nt]
            acts[i, a, 0] = rng.choice(np.flatnonzero(tmask))
            acts[i, a, 1] = rng.integers(nvec[1])
            gmask = masks[i, a, nt:]
            valid = np.flatnonzero(gmask)
            acts[i, a, 2] = rng.choice(valid) if len(valid) else 0
    return acts


def main():
    env = MobaVecEnv(num_envs=8, champions=("camille", "garen"), opponent="bot", frame_skip=4, seed=1)
    print("spec:", {k: env.spec[k] for k in ("obs_dim", "mask_dim", "action_nvec", "agent_teams")})
    rng = np.random.default_rng(0)
    obs, masks, _ = env.reset()
    t0 = time.time()
    steps = 2000
    episodes = 0
    for _ in range(steps):
        obs, rew, done, masks, infos = env.step(sample_masked(rng, masks, env.action_nvec))
        for i in np.flatnonzero(done):
            episodes += 1
            print("episode done:", infos[i]["episode"])
    dt = time.time() - t0
    sim_ticks = steps * env.num_envs * env.spec["frame_skip"]
    print(f"{steps * env.num_envs / dt:.0f} agent-steps/s, {sim_ticks / dt / 30:.0f}x real time")
    out = env.save_replay(str(Path(__file__).resolve().parents[2] / "replays" / "random_agent.json"))
    print("replay saved to", out, "- run `npm start`, open http://localhost:8080 and pick it in the replay list")
    env.close()


if __name__ == "__main__":
    main()
