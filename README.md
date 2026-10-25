# 📬 My Mail Tracker — apna khud ka email tracker

Mailtrack jaisa **apna** email open + click tracker. Data kisi third-party ke paas nahi jata — sab kuch **aapke apne server** par. Backend, Chrome extension, aur dashboard — teeno included.

GitHub-ready. Bana: **zero npm dependencies** (sirf Node.js built-in modules).

---

## 📂 Folder structure

```
email-tracker/
├── backend/          Node.js server (http + node:sqlite, koi install nahi)
│   ├── server.js     saare endpoints (pixel, redirect, API)
│   ├── db.js         SQLite database
│   └── package.json
├── extension/        Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── content.js    Gmail ke andar — pixel + link inject, badges
│   ├── background.js open hone par notification
│   ├── popup.html/js  toolbar popup (quick stats)
│   ├── options.html/js settings (server URL)
│   ├── content.css
│   └── icons/
└── dashboard/        web dashboard (server serve karta hai)
    ├── index.html
    └── dashboard.js
```

---

## 🚀 Chalane ka tareeqa (3 steps)

### 1. Backend chalao
```bash
cd backend
npm start
```
Bas. **Koi `npm install` nahi chahiye** (Node 22.5+ hona chahiye — `node --version` se check karo).
Server chalega: `http://localhost:3000`
Dashboard: `http://localhost:3000/dashboard`

### 2. Extension install karo
1. Chrome mein kholo: `chrome://extensions`
2. Upar dayein **Developer mode** ON karo.
3. **Load unpacked** par click karo → `extension/` folder select karo.
4. Extension icon par click → **Settings** → Server URL mein `http://localhost:3000` daalo → apna Gmail daalo → Save.

### 3. Test karo
1. Gmail kholo, naya email compose karo.
2. Niche toolbar mein green **"Track"** chip dikhega (ON).
3. Apne aap ko (ya kisi doosre account ko) email bhejo.
4. **15 second** baad wo email kholo (self-open guard isliye hai taake aapka apna turant dekhna count na ho).
5. Extension popup ya dashboard kholo → **✓✓** aur open count aa jayega. Notification bhi aayega.

---

## ✨ Features

| Feature | Status |
|---|---|
| Open tracking (pixel) | ✓ |
| Kitni dafa kholi (open count) | ✓ |
| Open ka time + device/user-agent | ✓ |
| Link click tracking (zyada reliable) | ✓ |
| Gmail sent-list mein ✓ / ✓✓ badge | ✓ |
| Real-time Chrome notification (jab khuli) | ✓ |
| Dashboard: stats, search, filter, timeline | ✓ |
| Self-open guard (apna open ignore) | ✓ |
| Proxy/auto-open detection (Google/Apple) | ✓ |
| Multi-account owner tag | ✓ |

---

## 🌐 Internet par deploy (doosron ko email bhejne ke liye)

`localhost` sirf aapke computer par kaam karta hai. Jab aap kisi **doosre** ko email bhejenge, un ka email client aapke server tak pohanch na payega jab tak server public URL par na ho. Options:

- **Jaldi test:** `npx localtunnel --port 3000` ya `ngrok http 3000` → jo HTTPS URL mile wo extension settings mein daalo.
- **Permanent (free):** Render.com, Railway.app, ya Fly.io par deploy karo. (Node app, start command `npm start`.)
- Apna domain ho to aur professional lagta hai (pixel URL kam suspicious).

HTTPS zaroori hai — bohot se email clients `http://` images block karte hain.

---

## ⚠️ Imaandar limitations (jhoot nahi)

Ye har pixel-based tracker par laagu hain (Mailtrack samet), koi bhi 100% nahi:

1. **Subject dekha par email nahi kholi** → track **nahi** ho sakta. Pixel sirf body khulne par load hota hai.
2. **Apple Mail Privacy Protection** aur kuch clients image pehle se download kar lete hain → "fake open" aa sakta hai. Is liye proxy opens ko dashboard alag (grey) dikhata hai.
3. **Jin logon ne images block ki hain** → unka open count nahi aayega.
4. **Gmail image proxy** recipient ki asli IP/location chhupa deta hai — sirf open ka time milta hai, location nahi.
5. **Delivered/bounced** 100% pakka sirf tab milta hai jab Gmail API use ho (bounce email read kar ke). Is version mein pixel = "open" ka signal hai; agar open aa gaya to email zaroor deliver hui. **Link click** sab se mazboot saboot hai ke banday ne sach mein dekha.

**Sab se behtar:** pixel + link tracking dono use karo (ye already ON hai). Link click = asli "usne dekha" ka proof.

---

## 🔐 Privacy / Legal

- Data sirf aapke server par. Koi third-party nahi.
- EU/UK walon ko email bhejo to GDPR consent ka masla ho sakta hai. Pakistan mein abhi strict rules kam hain, par email ke neeche chhoti disclosure dena acha practice hai.

---

## 🛠️ Aage kya add kar sakte ho (ideas)

- Gmail API se pakka delivered/bounced status.
- Location (IP → city) — apne server par, jahan proxy na ho.
- "Open hone par mujhe WhatsApp/Telegram pe bhejo" webhook.
- Scheduled send + "agar 2 din mein na khuli to remind karo".
- Multi-user login (abhi single-user/self-hosted hai).

Banaya **Kamran Alam** ke liye. GitHub: kamizox
