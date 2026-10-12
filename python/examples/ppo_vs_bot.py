"""Minimal masked PPO baseline (CleanRL-style, single file).

    py python/examples/ppo_vs_bot.py --champion garen --enemy darius --opponent idle --total-steps 2000000
    py python/examples/ppo_vs_bot.py --opponent bot --bot-difficulty 0.4
    py python/examples/ppo_vs_bot.py --opponent self          # shared-policy self-play

Policy: MLP torso + three heads for MultiDiscrete([type, dir, target]).
The type and target heads are masked with the env's action masks; the direction
head only contributes to log-prob/entropy for action types that use it, and the
target head only for 'attack', so credit is not smeared over unused sub-actions.

Outputs go to runs/<name>/: checkpoints (policy.pt) and periodic replays that show
up in the browser client's replay list (`npm start` -> 观看回放).
"""

from __future__ import annotations

import argparse
import sys
import time
from collections import deque
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.distributions import Categorical

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))
from moba_rl import MobaVecEnv, RewardConfig  # noqa: E402

N_TYPES, N_DIRS, N_TARGETS = 10, 16, 13
USES_DIR = torch.tensor([0, 1, 0, 1, 1, 1, 1, 1, 0, 0], dtype=torch.bool)  # move, Q, W, E, R, Flash
USES_TARGET = torch.tensor([0, 0, 1, 0, 0, 0, 0, 0, 0, 0], dtype=torch.bool)  # attack


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--champion", default="garen")
    p.add_argument("--enemy", default="darius")
    p.add_argument("--opponent", default="idle", choices=["idle", "bot", "self"])
    p.add_argument("--bot-difficulty", type=float, default=0.5)
    p.add_argument("--num-envs", type=int, default=16)
    p.add_argument("--frame-skip", type=int, default=4)
    p.add_argument("--max-game-time", type=float, default=600, help="seconds of game time before truncation")
    p.add_argument("--rollout", type=int, default=128)
    p.add_argument("--total-steps", type=int, default=2_000_000)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--gamma", type=float, default=0.995)
    p.add_argument("--gae-lambda", type=float, default=0.95)
    p.add_argument("--epochs", type=int, default=4)
    p.add_argument("--minibatches", type=int, default=4)
    p.add_argument("--clip", type=float, default=0.2)
    p.add_argument("--ent-coef", type=float, default=0.01)
    p.add_argument("--vf-coef", type=float, default=0.5)
    p.add_argument("--max-grad-norm", type=float, default=0.5)
    p.add_argument("--hidden", type=int, default=256)
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--name", default=None)
    p.add_argument("--replay-every", type=int, default=50, help="save every Nth finished episode of env 0")
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    return p.parse_args()


class RunningNorm:
    def __init__(self, dim, eps=1e-4):
        self.mean = np.zeros(dim, np.float64)
        self.var = np.ones(dim, np.float64)
        self.count = eps

    def update(self, x):
        bm, bv, bc = x.mean(0), x.var(0), x.shape[0]
        d = bm - self.mean
        tot = self.count + bc
        self.mean += d * bc / tot
        self.var = (self.var * self.count + bv * bc + d**2 * self.count * bc / tot) / tot
        self.count = tot

    def __call__(self, x):
        return np.clip((x - self.mean) / np.sqrt(self.var + 1e-8), -10, 10).astype(np.float32)


def layer(i, o, std=np.sqrt(2)):
    m = nn.Linear(i, o)
    nn.init.orthogonal_(m.weight, std)
    nn.init.zeros_(m.bias)
    return m


class Agent(nn.Module):
    def __init__(self, obs_dim, hidden):
        super().__init__()
        self.torso = nn.Sequential(layer(obs_dim, hidden), nn.Tanh(), layer(hidden, hidden), nn.Tanh())
        self.type_head = layer(hidden, N_TYPES, 0.01)
        self.dir_head = layer(hidden, N_DIRS, 0.01)
        self.tgt_head = layer(hidden, N_TARGETS, 0.01)
        self.value = layer(hidden, 1, 1.0)

    def dists(self, obs, mask):
        h = self.torso(obs)
        neg = torch.finfo(h.dtype).min
        tl = self.type_head(h).masked_fill(~mask[:, :N_TYPES], neg)
        tm = mask[:, N_TYPES:]
        gl = self.tgt_head(h).masked_fill(~tm, neg)
        # rows with no valid target (attack is masked anyway): keep the distribution well-defined
        gl = torch.where(tm.any(1, keepdim=True), gl, torch.zeros_like(gl))
        return Categorical(logits=tl), Categorical(logits=self.dir_head(h)), Categorical(logits=gl), self.value(h).squeeze(-1)

    def act(self, obs, mask, action=None):
        dt, dd, dg, v = self.dists(obs, mask)
        if action is None:
            action = torch.stack([dt.sample(), dd.sample(), dg.sample()], -1)
        t = action[:, 0]
        ud, ug = USES_DIR.to(t.device)[t].float(), USES_TARGET.to(t.device)[t].float()
        logp = dt.log_prob(t) + ud * dd.log_prob(action[:, 1]) + ug * dg.log_prob(action[:, 2])
        ent = dt.entropy() + ud * dd.entropy() + ug * dg.entropy()
        return action, logp, ent, v


def main():
    a = parse_args()
    torch.manual_seed(a.seed)
    np.random.seed(a.seed)
    name = a.name or f"ppo_{a.champion}_vs_{a.enemy}_{a.opponent}_{int(time.time())}"
    out = ROOT / "runs" / name
    out.mkdir(parents=True, exist_ok=True)

    env = MobaVecEnv(
        num_envs=a.num_envs, champions=(a.champion, a.enemy), opponent=a.opponent, frame_skip=a.frame_skip,
        seed=a.seed, bot_difficulty=a.bot_difficulty, reward=RewardConfig(zero_sum=a.opponent == "self"),
        replay_dir=str(out / "replays"), replay_every=a.replay_every, config={"maxGameTime": a.max_game_time},
    )
    n_env, n_ag, obs_dim, mdim = env.num_envs, env.num_agents, env.obs_dim, env.mask_dim
    B = n_env * n_ag
    dev = torch.device(a.device)
    agent = Agent(obs_dim, a.hidden).to(dev)
    opt = torch.optim.Adam(agent.parameters(), lr=a.lr, eps=1e-5)
    norm = RunningNorm(obs_dim)

    T = a.rollout
    buf_obs = torch.zeros(T, B, obs_dim, device=dev)
    buf_mask = torch.zeros(T, B, mdim, dtype=torch.bool, device=dev)
    buf_act = torch.zeros(T, B, 3, dtype=torch.long, device=dev)
    buf_logp = torch.zeros(T, B, device=dev)
    buf_rew = torch.zeros(T, B, device=dev)
    buf_done = torch.zeros(T, B, device=dev)
    buf_val = torch.zeros(T, B, device=dev)

    raw, masks, _ = env.reset()
    norm.update(raw.reshape(B, obs_dim))
    obs = torch.as_tensor(norm(raw.reshape(B, obs_dim)), device=dev)
    mask = torch.as_tensor(masks.reshape(B, mdim), device=dev)
    done = torch.zeros(B, device=dev)
    ep_ret, ep_win, ep_len = deque(maxlen=100), deque(maxlen=100), deque(maxlen=100)
    steps, it, t0 = 0, 0, time.time()
    n_iter = a.total_steps // (T * B)

    while it < n_iter:
        it += 1
        for g in opt.param_groups:
            g["lr"] = a.lr * (1 - (it - 1) / n_iter)
        for t in range(T):
            buf_obs[t], buf_mask[t], buf_done[t] = obs, mask, done
            with torch.no_grad():
                act, logp, _, v = agent.act(obs, mask)
            buf_act[t], buf_logp[t], buf_val[t] = act, logp, v
            raw, rew, d, masks, infos = env.step(act.cpu().numpy().reshape(n_env, n_ag, 3))
            flat = raw.reshape(B, obs_dim)
            norm.update(flat)
            obs = torch.as_tensor(norm(flat), device=dev)
            mask = torch.as_tensor(masks.reshape(B, mdim), device=dev)
            buf_rew[t] = torch.as_tensor(rew.reshape(B), device=dev)
            done = torch.as_tensor(np.repeat(d, n_ag).astype(np.float32), device=dev)
            steps += B
            for i in np.flatnonzero(d):
                e = infos[i]["episode"]
                ep_ret.append(float(e["return"][0]))
                ep_len.append(e["length"])
                ep_win.append(1.0 if e["winner"] == env.agent_teams[0] else 0.0)

        with torch.no_grad():
            nv = agent.act(obs, mask)[3]
            adv = torch.zeros_like(buf_rew)
            last = 0
            for t in reversed(range(T)):
                nonterm = 1.0 - (done if t == T - 1 else buf_done[t + 1])
                nxt = nv if t == T - 1 else buf_val[t + 1]
                delta = buf_rew[t] + a.gamma * nxt * nonterm - buf_val[t]
                last = delta + a.gamma * a.gae_lambda * nonterm * last
                adv[t] = last
            ret = adv + buf_val

        b_obs, b_mask, b_act = buf_obs.reshape(-1, obs_dim), buf_mask.reshape(-1, mdim), buf_act.reshape(-1, 3)
        b_logp, b_adv, b_ret = buf_logp.reshape(-1), adv.reshape(-1), ret.reshape(-1)
        n = b_obs.shape[0]
        mb = n // a.minibatches
        clipfrac = []
        for _ in range(a.epochs):
            perm = torch.randperm(n, device=dev)
            for s in range(0, n, mb):
                idx = perm[s : s + mb]
                _, logp, ent, v = agent.act(b_obs[idx], b_mask[idx], b_act[idx])
                ratio = (logp - b_logp[idx]).exp()
                ad = b_adv[idx]
                ad = (ad - ad.mean()) / (ad.std() + 1e-8)
                pg = torch.max(-ad * ratio, -ad * ratio.clamp(1 - a.clip, 1 + a.clip)).mean()
                vl = 0.5 * (v - b_ret[idx]).pow(2).mean()
                loss = pg + a.vf_coef * vl - a.ent_coef * ent.mean()
                opt.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(agent.parameters(), a.max_grad_norm)
                opt.step()
                clipfrac.append(((ratio - 1).abs() > a.clip).float().mean().item())

        sps = steps / (time.time() - t0)
        if ep_ret:
            print(
                f"it {it:4d}/{n_iter} steps {steps:9d} sps {sps:6.0f} | ep_ret {np.mean(ep_ret):8.2f} "
                f"win {np.mean(ep_win):.2f} len {np.mean(ep_len):6.0f} | pg {pg.item():+.3f} v {vl.item():.3f} "
                f"ent {ent.mean().item():.2f} clip {np.mean(clipfrac):.2f}",
                flush=True,
            )
        else:
            print(f"it {it:4d}/{n_iter} steps {steps:9d} sps {sps:6.0f} | (no finished episodes yet)", flush=True)
        if it % 20 == 0 or it == n_iter:
            torch.save({"agent": agent.state_dict(), "norm_mean": norm.mean, "norm_var": norm.var, "args": vars(a)}, out / "policy.pt")

    env.close()
    print("done; outputs in", out)


if __name__ == "__main__":
    main()
