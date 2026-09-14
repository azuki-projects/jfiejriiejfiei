const fs = require("fs");
const { login } = require("@tas33n/ws3-fca");

// ========== CONFIGURATION & CACHE ==========
const messageCache = new Map();
const MAX_CACHE_AGE = 1000 * 60 * 60 * 2;
const MAX_CACHE_SIZE = 1000;

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
}, 1000 * 60 * 5);

// ========== BOT LOGIN ==========
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
