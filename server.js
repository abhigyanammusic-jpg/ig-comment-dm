// server.js — Instagram comment-to-DM bot (single file, deploy-ready).
// All settings are in CONFIG below. Change text/keywords/links there.
// Secrets (token, app secret) come from environment variables, never in code.

const express = require('express');
const crypto = require('crypto');

// ====================== EDIT THIS ======================
const CONFIG = {
  keywords: ['ear', 'ear training', 'swar', 'test', 'tool', 'link', '🎶'],

  step1: {
    text:
      'Namaste! 🙏 Isse pehle main bhejun — @abhigyanam.in ko follow zaroor ' +
      'kar lo, taaki agli practice reel miss na ho. 🙌\n\nFollow ho gaya? ' +
      'Neeche tap karo 👇',
    button: { title: 'Follow kiya ✅ Bhej do', payload: 'SEND_LINKS' },
  },

  step2: {
    text:
      'Perfect! 🎶 Ye raha jo tumne maanga 👇\n\n' +
      '📘 Taal + Alankar practice:\nhttps://abhigyanam.in/taal-me-alankar/\n\n' +
      '🎤 Online Classes: 1:1 personal guidance, surili awaaz banao. ' +
      'Fees ₹3,000/class. Book karne ke liye yahīn "CLASS" reply karo ' +
      'ya call/message +918080532685.\n\n' +
      '🎯 Aur ye lo — apna Swar-Recognition test karo, dekho tumhara kaan ' +
      'kitna strong hai:\nhttps://abhigyanam.in/test-your-swar-recognition/\n\n' +
      'Roz 10 min practice karo, farq khud sunoge. 🙏',
    buttons: [
      { title: 'Taal + Alankar', url: 'https://abhigyanam.in/taal-me-alankar/' },
      { title: 'Swar Test', url: 'https://abhigyanam.in/test-your-swar-recognition/' },
    ],
  },

  publicCommentReply: 'DM check kar lo 📩 bhej diya hai! 🎶',
  onlyMediaId: null, // set a reel's media id to limit the bot to one reel
};
// =======================================================

const GRAPH = 'https://graph.instagram.com/v21.0';
const IG_USER_ID = process.env.IG_USER_ID;
const TOKEN = process.env.IG_ACCESS_TOKEN;
const APP_SECRET = process.env.APP_SECRET || '';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'abhigyanam-verify-123';
const DRY_RUN = process.env.DRY_RUN === '1';
const PORT = process.env.PORT || 3000;

async function igCall(path, body) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] POST ${path}\n`, JSON.stringify(body, null, 2));
    return { dry_run: true };
  }
  const res = await fetch(`${GRAPH}/${path}?access_token=${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('IG API error', res.status, JSON.stringify(json));
    throw new Error(json.error?.message || `IG API ${res.status}`);
  }
  return json;
}

const privateReply = (commentId, message) =>
  igCall(`${IG_USER_ID}/messages`, { recipient: { comment_id: commentId }, message });
const sendMessage = (igsid, message) =>
  igCall(`${IG_USER_ID}/messages`, { recipient: { id: igsid }, message });
const replyToComment = (commentId, text) =>
  igCall(`${commentId}/replies`, { message: text });

const textWithButton = (text, button) => ({
  attachment: {
    type: 'template',
    payload: {
      template_type: 'button',
      text,
      buttons: [{ type: 'postback', title: button.title, payload: button.payload }],
    },
  },
});
const textWithLinks = (text, buttons) =>
  !buttons || !buttons.length
    ? { text }
    : {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text,
            buttons: buttons.slice(0, 3).map((b) => ({ type: 'web_url', title: b.title, url: b.url })),
          },
        },
      };

const app = express();
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

const handled = new Set();

app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

function validSignature(req) {
  if (!APP_SECRET) return true;
  const sig = req.get('x-hub-signature-256');
  if (!sig || !req.rawBody) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}

const matches = (t) => CONFIG.keywords.some((k) => (t || '').toLowerCase().includes(k.toLowerCase()));

async function onComment(change) {
  const v = change.value || {};
  const commentId = v.id;
  const fromMe = v.from && String(v.from.id) === String(IG_USER_ID);
  if (!commentId || fromMe || handled.has(commentId)) return;
  if (CONFIG.onlyMediaId && v.media && v.media.id !== CONFIG.onlyMediaId) return;
  if (!matches(v.text)) return;
  handled.add(commentId);
  await privateReply(commentId, textWithButton(CONFIG.step1.text, CONFIG.step1.button));
  if (CONFIG.publicCommentReply) {
    try { await replyToComment(commentId, CONFIG.publicCommentReply); }
    catch (e) { console.warn('public reply failed:', e.message); }
  }
}

async function onMessaging(event) {
  const igsid = event.sender && event.sender.id;
  const payload =
    (event.postback && event.postback.payload) ||
    (event.message && event.message.quick_reply && event.message.quick_reply.payload);
  if (igsid && payload === CONFIG.step1.button.payload) {
    await sendMessage(igsid, textWithLinks(CONFIG.step2.text, CONFIG.step2.buttons));
  }
}

app.post('/webhook', async (req, res) => {
  if (!validSignature(req)) return res.sendStatus(403);
  res.sendStatus(200);
  try {
    if (req.body.object !== 'instagram') return;
    for (const entry of req.body.entry || []) {
      for (const change of entry.changes || []) if (change.field === 'comments') await onComment(change);
      for (const event of entry.messaging || []) await onMessaging(event);
    }
  } catch (e) { console.error('handler error:', e.message); }
});

app.get('/', (_req, res) => res.send('IG comment-to-DM bot running' + (DRY_RUN ? ' (DRY_RUN)' : '')));
app.listen(PORT, () => console.log(`Listening on :${PORT}${DRY_RUN ? ' [DRY_RUN]' : ''}`));
