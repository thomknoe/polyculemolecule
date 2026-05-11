#!/usr/bin/env node
const express = require("express");
const path = require("path");
const os = require("os");
const { WebSocketServer } = require("ws");

const app = express();
const PORT = process.env.PORT || 3847;

const playerMoves = [
  { up: false, down: false, left: false, right: false },
  { up: false, down: false, left: false, right: false },
  { up: false, down: false, left: false, right: false },
  { up: false, down: false, left: false, right: false },
];
const playerActionQueues = [[], [], [], []];
const playerTargetPersona = [-1, -1, -1, -1];
const playerCareQueues = [[], [], [], []];
const playerDisplayNames = ["", "", "", ""];
const playerInstructionsTap = [false, false, false, false];

function sanitizePlayerName(raw) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed.slice(0, 24);
}

function setMoveKey(playerIndex, key, isDown) {
  if (playerIndex < 0 || playerIndex > 3) return;
  const m = playerMoves[playerIndex];
  if (!m || !(key in m)) return;
  m[key] = !!isDown;
}

function pushAction(playerIndex, action) {
  if (playerIndex < 0 || playerIndex > 3) return;
  if (typeof action !== "number" || action < 0 || action > 5) return;
  playerActionQueues[playerIndex].push(action | 0);
  if (playerActionQueues[playerIndex].length > 32)
    playerActionQueues[playerIndex].splice(
      0,
      playerActionQueues[playerIndex].length - 32,
    );
}

function pushCare(playerIndex, personaId) {
  if (playerIndex < 0 || playerIndex > 3) return;
  if (typeof personaId !== "number" || personaId < 0) return;
  playerCareQueues[playerIndex].push(personaId | 0);
  if (playerCareQueues[playerIndex].length > 32)
    playerCareQueues[playerIndex].splice(
      0,
      playerCareQueues[playerIndex].length - 32,
    );
}

function clearPlayerInput(playerIndex) {
  if (playerIndex < 0 || playerIndex > 3) return;
  const m = playerMoves[playerIndex];
  if (m) {
    m.up = m.down = m.left = m.right = false;
  }
  playerActionQueues[playerIndex].length = 0;
  playerCareQueues[playerIndex].length = 0;
  playerTargetPersona[playerIndex] = -1;
}

function snapshotAndDrain() {
  const players = [];
  for (let i = 0; i < 4; i++) {
    const m = playerMoves[i];
    let mx = 0;
    let my = 0;
    if (m.right) mx += 1;
    if (m.left) mx -= 1;
    if (m.up) my += 1;
    if (m.down) my -= 1;
    const taps = playerActionQueues[i].slice();
    playerActionQueues[i].length = 0;
    const careTaps = playerCareQueues[i].slice();
    playerCareQueues[i].length = 0;
    const targetPersonaId =
      typeof playerTargetPersona[i] === "number" ? playerTargetPersona[i] : -1;
    const instructionsOk = !!playerInstructionsTap[i];
    playerInstructionsTap[i] = false;
    players.push({
      moveX: mx,
      moveY: my,
      taps,
      careTaps,
      targetPersonaIdStr: String(targetPersonaId),
      instructionsOk,
    });
  }
  return { players };
}

app.use(express.json());

app.get("/favicon.ico", (req, res) => res.status(204).end());

/** @type {string|null} */
let publicTunnelUrl = null;
/** @type {string|null} */
let publicTunnelSource = null;
/** "off" | "pending" | "ready" — pending => Unity should retry /public-controller-url */
let tunnelStatus = "off";

function normalizeBaseUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  return s.endsWith("/") ? s : s + "/";
}

app.get("/health", (req, res) => {
  const body = { ok: true, mode: publicTunnelUrl ? "internet" : "direct" };
  if (publicTunnelUrl) body.publicUrl = publicTunnelUrl;
  res.json(body);
});

app.get("/public-controller-url", (req, res) => {
  if (tunnelStatus === "pending")
    return res.status(503).json({ ok: false, pending: true });
  if (publicTunnelUrl)
    return res.json({
      ok: true,
      url: publicTunnelUrl,
      source: publicTunnelSource || "unknown",
    });
  res.json({ ok: false, url: "", source: null });
});

app.get("/unity/inputs", (req, res) => {
  res.json(snapshotAndDrain());
});

app.use(express.static(path.join(__dirname, "public")));

app.post("/input", (req, res) => {
  res.status(204).end();
  const msg = req.body;
  if (!msg || typeof msg.playerIndex !== "number") return;
  if (msg.type === "instructions_ack") {
    const p = msg.playerIndex | 0;
    if (p >= 0 && p <= 3) playerInstructionsTap[p] = true;
    return;
  }
  applyInputMessage(msg);
});

app.post("/tap", (req, res) => {
  res.status(204).end();
  const msg = req.body;
  if (!msg || typeof msg.playerIndex !== "number") return;
  applyInputMessage({ ...msg, type: "action" });
});

app.get("/controllers/status", (req, res) => {
  res.json({ claimed: getClaimedList(), names: playerDisplayNames });
});

let latestGameState = null;
app.post("/unity/state", (req, res) => {
  res.status(204).end();
  const msg = req.body;
  if (!msg || typeof msg !== "object") return;
  latestGameState = { ...msg, type: "game_state" };
  broadcastToPhones(latestGameState);
});

function releaseAllSessionClaims() {
  claimedByPlayer.clear();
  claimedByWs.clear();
  for (let i = 0; i < 4; i++) {
    playerDisplayNames[i] = "";
    playerInstructionsTap[i] = false;
    clearPlayerInput(i);
  }
  broadcastClaimed();
  broadcastToPhones({ type: "release_claims" });
}

app.post("/unity/release-claims", (req, res) => {
  res.status(204).end();
  releaseAllSessionClaims();
});

async function startPublicTunnel() {
  const envUrl = normalizeBaseUrl(process.env.PUBLIC_CONTROLLER_URL);
  if (envUrl) {
    publicTunnelUrl = envUrl;
    publicTunnelSource = "env";
    tunnelStatus = "ready";
    console.log(`  Internet: ${publicTunnelUrl} (PUBLIC_CONTROLLER_URL)`);
    return;
  }
  if (!process.env.NGROK_AUTHTOKEN) {
    tunnelStatus = "off";
    return;
  }
  tunnelStatus = "pending";
  try {
    const ngrok = require("@ngrok/ngrok");
    const listener = await ngrok.forward({
      addr: PORT,
      authtoken_from_env: true,
    });
    const u = normalizeBaseUrl(listener.url());
    if (u) {
      publicTunnelUrl = u;
      publicTunnelSource = "ngrok";
      tunnelStatus = "ready";
      console.log(`  Internet: ${publicTunnelUrl} (embedded ngrok)`);
    } else tunnelStatus = "off";
  } catch (e) {
    tunnelStatus = "off";
    console.warn(
      "  Embedded ngrok failed (token valid? npm install complete?):",
      e && e.message ? e.message : e,
    );
  }
}

const server = app.listen(PORT, "0.0.0.0", () => {
  let ifaces = [];
  try {
    ifaces = getLocalIPs();
  } catch (e) {}
  console.log("\n  Polyamory Web Controller");
  console.log("  ========================\n");
  console.log(`  Local:   http://localhost:${PORT}`);
  if (ifaces.length) console.log(`  Network: http://${ifaces[0]}:${PORT}`);
  if (ifaces.length > 1)
    ifaces
      .slice(1)
      .forEach((ip) => console.log(`           http://${ip}:${PORT}`));
  console.log(
    "\n  LAN: phones on the same network can open the URL above or scan the in-game QR.\n",
  );
  void (async () => {
    await startPublicTunnel();
    if (publicTunnelUrl) {
      console.log(
        "  Internet: tunnel is active — QR in Unity uses this URL; phones only need Wi‑Fi.\n",
      );
    } else {
      console.log(
        "  Internet: set PUBLIC_CONTROLLER_URL, or NGROK_AUTHTOKEN for embedded ngrok,",
      );
      console.log("            or run `ngrok http " + PORT + "` / cloudflared manually.\n");
    }
  })();
});

server.on("connection", (socket) => {
  socket.setNoDelay(true);
});

const wss = new WebSocketServer({ server, path: "/ws" });

const claimedByPlayer = new Map();
const claimedByWs = new Map();

function getClaimedList() {
  return Array.from(claimedByPlayer.keys());
}

function broadcastClaimed() {
  const claimed = getClaimedList();
  broadcastToPhones({ type: "claimed", claimed, names: playerDisplayNames });
}

function broadcastToPhones(payload) {
  const msg = typeof payload === "string" ? payload : JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on("connection", (ws) => {
  ws.send(
    JSON.stringify({
      type: "claimed",
      claimed: getClaimedList(),
      names: playerDisplayNames,
    }),
  );
  if (latestGameState) ws.send(JSON.stringify(latestGameState));

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "select" && typeof msg.playerIndex === "number") {
        const p = msg.playerIndex;
        if (p < 0 || p > 3) return;
        const requestedName = sanitizePlayerName(msg.name);
        if (!requestedName) {
          ws.send(
            JSON.stringify({
              type: "select_failed",
              playerIndex: p,
              reason: "name_required",
            }),
          );
          return;
        }
        const currentOwner = claimedByPlayer.get(p);
        if (currentOwner && currentOwner !== ws) {
          ws.send(JSON.stringify({ type: "select_failed", playerIndex: p }));
          return;
        }
        if (claimedByWs.has(ws)) {
          const old = claimedByWs.get(ws);
          claimedByPlayer.delete(old);
          claimedByWs.delete(ws);
        }
        playerDisplayNames[p] = requestedName;
        claimedByPlayer.set(p, ws);
        claimedByWs.set(ws, p);
        ws.send(
          JSON.stringify({
            type: "select_ok",
            playerIndex: p,
            name: playerDisplayNames[p] || "",
          }),
        );
        broadcastClaimed();
        return;
      }
      if (msg.type === "set_name" && typeof msg.playerIndex === "number") {
        const p = msg.playerIndex | 0;
        if (p < 0 || p > 3) return;
        const owner = claimedByPlayer.get(p);
        if (owner && owner !== ws) return;
        playerDisplayNames[p] = sanitizePlayerName(msg.name);
        broadcastClaimed();
        return;
      }
      if (msg.type === "instructions_ack" && typeof msg.playerIndex === "number") {
        const p = msg.playerIndex | 0;
        if (p < 0 || p > 3) return;
        if (claimedByPlayer.get(p) !== ws) return;
        playerInstructionsTap[p] = true;
        return;
      }
      if (!msg || typeof msg.playerIndex !== "number") return;
      const owner = claimedByPlayer.get(msg.playerIndex);
      if (owner && owner !== ws) return;
      if (msg.type === "target" && typeof msg.personaId === "number") {
        const p = msg.playerIndex;
        playerTargetPersona[p] = msg.personaId | 0;
        return;
      }
      if (msg.type === "move" && msg.state !== undefined) {
        applyInputMessage(msg);
      } else if (msg.type === "action") {
        applyInputMessage(msg);
      } else if (msg.type === "care") {
        applyInputMessage(msg);
      }
    } catch (e) {}
  });

  ws.on("close", () => {
    if (claimedByWs.has(ws)) {
      const idx = claimedByWs.get(ws);
      claimedByPlayer.delete(idx);
      claimedByWs.delete(ws);
      clearPlayerInput(idx);
      broadcastClaimed();
    }
  });
});

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

function applyInputMessage(msg) {
  if (!msg) return;
  const { type, playerIndex, key } = msg;
  if (typeof playerIndex !== "number") return;
  if (type === "move" && typeof key === "string") {
    setMoveKey(playerIndex, key, msg.state === "down");
  } else if (type === "action") {
    pushAction(playerIndex, typeof key === "number" ? key : 0);
    if (typeof msg.personaId === "number") {
      playerTargetPersona[playerIndex] = msg.personaId | 0;
    }
  } else if (type === "target" && typeof msg.personaId === "number") {
    playerTargetPersona[playerIndex] = msg.personaId | 0;
  } else if (type === "care" && typeof msg.personaId === "number") {
    pushCare(playerIndex, msg.personaId | 0);
  } else if (type === "set_name") {
    playerDisplayNames[playerIndex] = sanitizePlayerName(msg.name);
    broadcastClaimed();
  }
}
