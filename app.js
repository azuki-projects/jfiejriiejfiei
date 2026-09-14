const fs = require("fs");
const path = require("path");
const express = require("express");
const { login } = require("@tas33n/ws3-fca");

// ========== SYSTEM STATE & CACHE ==========
const messageCache = new Map();
const MAX_CACHE_AGE = 1000 * 60 * 60 * 2; // 2 hours
const MAX_CACHE_SIZE = 1000;

let botPing = 0;
let isBotOnline = false; // Tracks if bot successfully logged in
const startTime = Date.now();

// ========== EXPRESS DASHBOARD ==========
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/stats", (req, res) => {
  const uptimeMs = Date.now() - startTime;
  const seconds = Math.floor((uptimeMs / 1000) % 60);
  const minutes = Math.floor((uptimeMs / (1000 * 60)) % 60);
  const hours = Math.floor((uptimeMs / (1000 * 60 * 60)) % 24);
  const days = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
  
  const formattedUptime = days + "d " + hours + "h " + minutes + "m " + seconds + "s";

  res.json({
    cacheSize: messageCache.size,
    maxCacheSize: MAX_CACHE_SIZE,
    botPing: botPing,
    uptime: formattedUptime,
    isOnline: isBotOnline // Expose online status to HTML
  });
});

app.listen(PORT, () => {
  console.log("🌐 Express server running on port " + PORT);
});

// ========== CACHE CLEANUP TASK ==========
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of messageCache.entries()) {
    if (now - data.cachedAt > MAX_CACHE_AGE) messageCache.delete(id);
  }
  while (messageCache.size > MAX_CACHE_SIZE) {
    messageCache.delete(messageCache.keys().next().value);
  }
}, 1000 * 60 * 5);

// ========== BOT LOGIN & LOGIC ==========
try {
  const appState = JSON.parse(fs.readFileSync("appstate.json", "utf8"));

  login(
    { appState: appState },
    {
      forceLogin: false,
      autoMarkRead: false,
      autoReconnect: true,
      listenEvents: true,
      selfListen: true,
      online: false
    },
    async (err, api) => {
      if (err) {
        console.error("❌ Login failed:", err);
        isBotOnline = false; // Mark as offline on failure
        return;
      }
      
      isBotOnline = true; // Mark as online on success
      console.log("✅ Bot online — ready and listening!\n");

      api.listenMqtt(async (listenErr, event) => {
        if (listenErr) {
          console.error("❌ Listener error:", listenErr);
          return;
        }

        // CALCULATE MQTT PING
        if (event.timestamp) {
          const latency = Date.now() - Number(event.timestamp);
          if (latency >= 0 && latency < 60000) botPing = latency;
        }

        // SAVE MESSAGES TO CACHE
        if (event.type === "message" || event.type === "message_reply") {
          if (event.messageID) {
            let content = event.body || "";
            if (event.attachments && event.attachments.length > 0) {
              if (content.length > 0) {
                content = content + "\n[+ Media/Attachment]";
              } else {
                content = "[Media/Attachment]";
              }
            }
            if (!content) content = "(Empty message)";

            messageCache.set(event.messageID, {
              body: content,
              senderID: event.senderID,
              threadID: event.threadID,
              cachedAt: Date.now()
            });
          }
        }

        // DETECT UNSEND
        if (event.type === "message_unsend") {
          const cachedMsg = messageCache.get(event.messageID);
          
          if (!cachedMsg) return;

          console.log("\n" + "═".repeat(50));
          console.log("🔴 UNSEND DETECTED");
          console.log("• Sender ID: " + event.senderID);

          messageCache.delete(event.messageID);
          console.log("• Content: " + cachedMsg.body);

          try {
            const targetId = String(event.senderID);
            const userInfo = await new Promise((resolve, reject) => {
              api.getUserInfo([targetId], (fetchErr, data) => {
                if (fetchErr) reject(fetchErr);
                else resolve(data);
              });
            });

            let displayName = "User (" + targetId + ")";
            if (Array.isArray(userInfo)) {
              const user = userInfo.find((u) => String(u.id) === targetId);
              if (user && user.name) displayName = user.name;
            }

            console.log("• Name: " + displayName);
            const replyMessage = displayName + " unsent this message:\n\n" + cachedMsg.body;
            
            await api.sendMessage(replyMessage, event.threadID);
            console.log("✅ Sent reply successfully!");

          } catch (e) {
            console.error("❌ Error fetching name:", e.message);
            const fallbackMessage = "User (" + event.senderID + ") unsent this message:\n\n" + cachedMsg.body;
            await api.sendMessage(fallbackMessage, event.threadID).catch(() => {});
          }
          console.log("═".repeat(50) + "\n");
        }
      });
    }
  );
} catch (error) {
  console.error("❌ Initialization Error (Is appstate.json missing or invalid?):", error.message);
  isBotOnline = false; // Mark offline if file read fails
              }
