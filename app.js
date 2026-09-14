const fs = require("fs");
const path = require("path");
const express = require("express");
const { login } = require("@tas33n/ws3-fca");

// ========== CACHE CONFIGURATION ==========
const messageCache = new Map();
const MAX_CACHE_AGE = 1000 * 60 * 60 * 2; // 2 hours
const MAX_CACHE_SIZE = 1000000;

let botPing = 0; // Updated dynamically from MQTT events
const startTime = Date.now();

// ========== EXPRESS SERVER SETUP ==========
const app = express();
const PORT = process.env.PORT || 3000;

// Serve the external index.html file
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Create an API endpoint for the frontend to fetch real-time stats
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
    uptime: formattedUptime
  });
});

app.listen(PORT, () => {
  console.log("🌐 Express dashboard running at http://localhost:" + PORT);
});

// ========== CACHE CLEANUP TASK ==========
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of messageCache.entries()) {
    if (now - data.cachedAt > MAX_CACHE_AGE) {
      messageCache.delete(id);
    }
  }
  while (messageCache.size > MAX_CACHE_SIZE) {
    messageCache.delete(messageCache.keys().next().value);
  }
}, 1000 * 60 * 5); // Runs every 5 minutes

// ========== BOT LOGIN & LOGIC ==========
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
      return;
    }
    console.log("✅ Bot online — ready and listening!\n");

    api.listenMqtt(async (listenErr, event) => {
      if (listenErr) {
        console.error("❌ Listener error:", listenErr);
        return;
      }

      // CALCULATE REAL-TIME MQTT BOT PING
      if (event.timestamp) {
        const latency = Date.now() - Number(event.timestamp);
        if (latency >= 0 && latency < 60000) {
          botPing = latency;
        }
      }

      // 1. SAVE MESSAGES TO CACHE
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

      // 2. DETECT UNSEND
      if (event.type === "message_unsend") {
        const cachedMsg = messageCache.get(event.messageID);
        
        console.log("\n" + "═".repeat(50));
        console.log("🔴 UNSEND DETECTED");
        console.log("• Sender ID: " + event.senderID);

        if (!cachedMsg) {
          console.log("⚠️ Message not found in cache.");
          console.log("═".repeat(50) + "\n");
          return;
        }

        // Remove from cache once it's unsent
        messageCache.delete(event.messageID);
        console.log("• Content: " + cachedMsg.body);

        try {
          const targetId = String(event.senderID);

          const userInfo = await new Promise((resolve, reject) => {
            api.getUserInfo([targetId], (fetchErr, data) => {
              if (fetchErr) {
                reject(fetchErr);
              } else {
                resolve(data);
              }
            });
          });

          let displayName = "User (" + targetId + ")";

          // Extract name correctly from the Array format
          if (Array.isArray(userInfo)) {
            const user = userInfo.find((u) => String(u.id) === targetId);
            if (user && user.name) {
              displayName = user.name;
            }
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
);      return;
    }
    console.log("✅ Bot online — ready and listening!\n");

    api.listenMqtt(async (listenErr, event) => {
      if (listenErr) {
        console.error("❌ Listener error:", listenErr);
        return;
      }

      // 1. SAVE MESSAGES
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

      // 2. DETECT UNSEND
      if (event.type === "message_unsend") {
        const cachedMsg = messageCache.get(event.messageID);
        
        console.log("\n" + "═".repeat(50));
        console.log("🔴 UNSEND DETECTED");
        console.log("• Sender ID: " + event.senderID);

        if (!cachedMsg) {
          console.log("⚠️ Message not found in cache.");
          console.log("═".repeat(50) + "\n");
          return;
        }

        messageCache.delete(event.messageID);
        console.log("• Content: " + cachedMsg.body);

        try {
          const targetId = String(event.senderID);

          const userInfo = await new Promise((resolve, reject) => {
            api.getUserInfo([targetId], (fetchErr, data) => {
              if (fetchErr) {
                reject(fetchErr);
              } else {
                resolve(data);
              }
            });
          });

          let displayName = "User (" + targetId + ")";

          // ✅ THE FIX: Handle the Array output we saw in your test
          if (Array.isArray(userInfo)) {
            const user = userInfo.find((u) => String(u.id) === targetId);
            if (user && user.name) {
              displayName = user.name;
            }
          }

          console.log("• Name: " + displayName);

          const replyMessage = displayName + " unsent this message:\n\n" + cachedMsg.body;

          await api.sendMessage(replyMessage, event.threadID);
          console.log("✅ Sent reply successfully!");

        } catch (e) {
          console.error("❌ Error fetching name:", e.message);
          const fallbackMessage = "User (" + event.senderID + ") unsent this message:\n\n" + cachedMsg.body;
          
          await api.sendMessage(fallbackMessage, event.threadID).catch(()=>{});
        }

        console.log("═".repeat(50) + "\n");
      }
    });
  }
);
