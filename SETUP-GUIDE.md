# 📖 My Mail Tracker — POORI DETAIL GUIDE (bilkul asaan, step by step)

Salaam Kamran 👋

Ye guide aise likhi hai jaise koi aapke saath baith kar, ungli pakad kar, ek-ek
cheez karwa raha ho. **Jaldi mat karna. Ek step karo, phir agla.** Agar beech
mein kuch samajh na aaye, ghabrana nahi — har step ke saath "ye kyun kar rahe
hain" bhi likha hai.

> **Pehle ye samjho (sirf 1 minute):**
> Hamare system ke **3 hissay** hain. Teeno milke kaam karte hain:
>
> 1. **Backend (server)** — ek computer program jo "sunta" hai. Jab koi aapki
>    email kholta hai, ye chupke se note kar leta hai: "is email ko abhi khola
>    gaya." Ye note ek chhoti file (database) mein save hota hai.
>
> 2. **Chrome Extension** — ye Gmail ke andar lagti hai. Jab aap email bhejte ho,
>    ye email ke andar ek **choti si invisible tasveer (pixel)** laga deti hai.
>    Jab wo tasveer load hoti hai (yaani banday ne email kholi), server ko pata
>    chal jata hai.
>
> 3. **Dashboard** — ek webpage jahan aap dekh sakte ho: kaun si email kholi
>    gayi, kitni dafa, kis waqt.
>
> Bas itna. Ab chalte hain. 🚀

---

# 🧩 HISSA 0 — Pehle ye check karo (zaroori)

Hamare backend ko **Node.js** chahiye, version **22.5 ya us se naya**. Chalo check
karte hain aapke computer par hai ya nahi.

### Step 0.1 — Terminal kholo

- **Windows:** Start button → likho `cmd` → "Command Prompt" khulega.
- **Mac:** `Cmd + Space` → likho `terminal` → Enter.

> Terminal = ek kaali (ya safed) window jahan aap commands likhte ho. Darna nahi,
> hum sirf 3-4 commands likhenge.

### Step 0.2 — Node check karo

Terminal mein ye likho aur Enter dabao:

```
node --version
```

**Do cheezein ho sakti hain:**

- ✅ Agar aisa kuch aaye: `v22.22.0` (ya koi bhi number 22.5 se bara) → **bilkul
  theek! Hissa 1 par jao.**

- ❌ Agar aaye `command not found` ya `v18...` / `v20...` (22 se chhota) → **Node
  install/update karna hai.** Niche dekho.

### Step 0.3 — (Sirf agar Node nahi hai ya purana hai) Node install karo

1. Browser mein kholo: **https://nodejs.org**
2. Bara green button **"LTS"** wala download karo (ye sab se stable hai, aur ab
   22+ hi hoti hai).
3. Jo file download ho use double-click karke install karo — bas **Next → Next →
   Finish** (kuch change mat karna).
4. Install ke baad **terminal band karke dobara kholo** (ye zaroori hai!).
5. Phir se `node --version` likho — ab number aa jana chahiye.

> **Kyun?** Node.js wo cheez hai jo hamare server ko "chalati" hai. Jaise video
> chalane ke liye video player chahiye, waise JS program chalane ke liye Node
> chahiye.

---

# 🖥️ HISSA 1 — Backend (server) chalao

Ab hum server chalayenge. Jab tak ye chal raha hoga, tab tak tracking kaam karegi.

### Step 1.1 — Zip ko extract (unzip) karo

- Jo `email-tracker.zip` main ne diya use **right-click → Extract All** (Windows)
  ya **double-click** (Mac) karo.
- Ek folder banega: `email-tracker`. Use kisi aasaan jagah rakho, jaise Desktop
  par.

### Step 1.2 — Terminal ko us folder ke andar le jao

Terminal mein likho `cd ` (cd ke baad ek space), **phir folder ko terminal par
drag-and-drop karo** aur Enter dabao. Ya khud likho, misaal:

- **Windows:**
  ```
  cd Desktop\email-tracker\backend
  ```
- **Mac:**
  ```
  cd Desktop/email-tracker/backend
  ```

> **cd** ka matlab "change directory" — yaani "is folder ke andar chalo." Hum
> `backend` folder ke andar ja rahe hain kyunki server wahin hai.

Check karne ke liye ke sahi jagah ho, likho:
- Windows: `dir`  → Mac: `ls`

Aapko ye files dikhni chahiye: `server.js`, `db.js`, `package.json`. ✅

### Step 1.3 — Server start karo

Likho aur Enter:

```
npm start
```

**Thodi der baad aisa dikhega:**

```
  Email Tracker backend -> http://localhost:3000
  Dashboard             -> http://localhost:3000/dashboard
  Pixel endpoint        -> http://localhost:3000/p/<id>.png
```

🎉 **Mubarak ho! Server chal raha hai.**

> **BAHUT ZAROORI:** Ye terminal window **band mat karna.** Jab tak server
> chalana hai, ye khuli rehni chahiye. Band karte hi tracking ruk jayegi.
> (Band karna ho to `Ctrl + C` dabao.)

### Step 1.4 — Check karo server zinda hai

Browser (Chrome) kholo aur address bar mein likho:

```
http://localhost:3000/dashboard
```

Ek khaali dashboard khul jana chahiye (abhi koi email nahi, to khaali hoga). ✅

> **Agar error aaye:**
> - `npm: command not found` → Node sahi install nahi hua. Hissa 0 dobara karo.
> - `Cannot find module 'node:sqlite'` → aapka Node 22.5 se purana hai. Update
>   karo (Hissa 0.3).
> - Dashboard nahi khul raha → terminal check karo, server shayad band ho gaya.
>   Dobara `npm start` karo.

---

# 🧩 HISSA 2 — Chrome Extension lagao

Ab wo hissa jo Gmail ke andar kaam karega.

### Step 2.1 — Extensions page kholo

Chrome mein address bar mein likho aur Enter:

```
chrome://extensions
```

### Step 2.2 — Developer mode ON karo

- Page ke **upar dayein (top-right)** kone mein ek switch hai: **"Developer
  mode"**. Use **ON** karo (neela/blue ho jayega).

> **Kyun?** Chrome Web Store ke bahar se extension lagane ke liye ye mode on karna
> parta hai. Ye bilkul mehfooz hai — ye aapki apni banayi extension hai.

### Step 2.3 — Extension load karo

- Ab upar bayein (top-left) 3 button aayenge. **"Load unpacked"** par click karo.
- Ek folder chunne ki window khulegi. `email-tracker` ke andar `extension` folder
  select karo aur **"Select Folder" / "Open"** dabao.

> ⚠️ Dhyan: `extension` **folder** select karna hai, uske andar ki koi file nahi.

- Ho gaya! Ab "My Mail Tracker" extension list mein aa jayegi, ✓✓ icon ke sath.

### Step 2.4 — Extension ko pin karo (taake aasani se mile)

- Chrome ke top-right mein **puzzle-piece (🧩) icon** par click karo.
- "My Mail Tracker" ke aage **pin (📌)** dabao.
- Ab ✓✓ icon hamesha address bar ke paas dikhega.

### Step 2.5 — Settings mein server URL daalo (SAB SE ZAROORI STEP)

- Us ✓✓ icon par click karo → popup khulega → **"⚙ Settings"** par click karo.
- Ek settings page khulega. Yahan bharo:
  - **Server URL:** `http://localhost:3000`
  - **Aapka Gmail:** `kamranalam9853@gmail.com` (aapka email)
  - Dono checkbox ON rehne do.
- **"Save karo"** dabao. "✓ Save ho gaya" aayega.

> **Kyun zaroori?** Extension ko pata hona chahiye ke notes kahan bhejne hain —
> yaani aapka server kahan hai. Ye URL wahi hai jo terminal mein dikha tha.

---

# ✅ HISSA 3 — Test karo (sab sahi chal raha hai?)

Ab mazay ka hissa. Dekhte hain tracking kaam karti hai ya nahi.

### Step 3.1 — Ek test email bhejo

1. Gmail kholo (`mail.google.com`).
2. **"Compose"** (naya email) par click karo.
3. **To** mein apna hi email daalo (`kamranalam9853@gmail.com`) — khud ko bhej
   rahe hain test ke liye.
4. Subject: `Mera pehla tracked email`
5. Niche, Send button ke paas, ek **green "Track" chip** dikhega. Pakka karo wo ON
   (green) hai.
6. **Send** dabao.

> **Agar green "Track" chip nahi dikh raha?**
> - Gmail page ko refresh karo (F5), phir Compose kholo.
> - Pakka karo extension settings save ho chuki hai (Step 2.5).

### Step 3.2 — 15 second RUKO, phir email kholo

- Apne inbox mein wo email aa jayegi (khud ko bheji hai na).
- **15 second guzarne do** — phir email kholo.

> **Ye 15 second kyun?** Jab aap khud email bhejte ho aur foran dekhte ho, wo bhi
> "open" count ho jata. To humne rule lagaya: pehle 15 second ke open ignore karo
> (taake aapka apna dekhna count na ho). 15 second baad jo open hoga wo "asli"
> mana jayega.

### Step 3.3 — Natija dekho 🎉

**Teen jagah check kar sakte ho:**

1. **Notification:** Chrome ke corner mein ek notification aana chahiye:
   "📬 Email kholi gayi!"

2. **Extension popup:** ✓✓ icon par click karo → wahan email dikhegi `✓✓ 1×`
   ke sath.

3. **Dashboard:** `http://localhost:3000/dashboard` kholo → stats mein "Kholi
   gayi: 1" aur table mein aapki email ✓✓ Kholi ke sath. Us row par click karo to
   **timeline** khulega (kis waqt khuli, kaun se device se).

**Agar ye sab dikh gaya → MUBARAK HO, sab kaam kar raha hai! ✅**

---

# 🔗 HISSA 4 — Link tracking (ye sab se kaam ki cheez)

Pixel se pata chalta hai "khola," lekin **link click sab se mazboot saboot hai**
ke banday ne sach mein email parhi.

**Ye khud-ba-khud kaam karta hai** — jab bhi aap email mein koi link daloge (jaise
`https://github.com/kamizox`), extension use automatically "wrap" kar degi. Jab
recipient us link par click karega, dashboard mein us email ke niche
**"🔗 Link click"** aur asli URL dikhega.

Kuch extra karne ki zarurat nahi. Bas link daalo aur bhejo.

---

# 🌍 HISSA 5 — Doosron ko email bhejna (localhost se bahar)

Abhi tak hum ne khud ko email bheja. Lekin **ek masla hai:**

`localhost:3000` ka matlab hai "sirf mera computer." Jab aap kisi **doosre** shakhs
ko email bhejenge, uska computer aapke `localhost` tak nahi pohanch sakta — wo to
uske apne computer ka localhost samjhega. To tracking kaam nahi karegi.

**Hal:** server ko ek aisa address do jo internet par sab dekh sakein.

### Sab se aasaan tareeqa — ngrok (5 minute)

1. Kholo: **https://ngrok.com** → free sign up karo.
2. Apne OS ke liye ngrok download karo, extract karo.
3. Website par aapko ek command milegi apna "authtoken" lagane ki — wo ek dafa
   chalao (copy-paste).
4. Ab **naya terminal** kholo (server wala khula rehne do!) aur likho:
   ```
   ngrok http 3000
   ```
5. ngrok ek URL dega, jaise: `https://abcd-1234.ngrok-free.app`
6. Ye URL copy karo → extension **Settings** → Server URL mein **ye wala** daalo
   (localhost ki jagah) → Save.

Ab jo email bhejoge, duniya mein kisi ko bhi, tracking kaam karegi (jab tak ngrok
aur server dono chal rahe hon).

> **Permanent chahiye?** (ngrok har dafa URL badal deta hai free plan par)
> Render.com ya Railway.app par deploy karo — free hai. Us ka tareeqa README ke
> "deploy" hisse mein hai. Chaho to main alag se iski bhi step-by-step guide bana
> doon.

---

# 🆘 HISSA 6 — Masle aur unka hal (troubleshooting)

Har masla jo aa sakta hai, aur seedha hal:

### "npm start" par error aaya
| Error | Matlab | Hal |
|---|---|---|
| `npm: command not found` | Node install nahi | Hissa 0.3 |
| `Cannot find module 'node:sqlite'` | Node purana (22 se chhota) | Node update karo |
| `EADDRINUSE` / port 3000 busy | 3000 pehle se use mein | Purana server band karo, ya `PORT=4000 npm start` chalao (phir settings mein bhi 4000 daalo) |
| `Cannot find module './db.js'` | Ghalat folder mein ho | `cd` se `backend` folder mein jao |

### Green "Track" chip nahi dikh raha
- Gmail refresh karo (F5), phir Compose kholo.
- Extension settings save ki? (Step 2.5)
- `chrome://extensions` par ja kar extension ke neeche **"Errors"** dekho — agar
  laal error ho to mujhe bata dena.

### Email kholi par ✓✓ nahi aaya
- **15 second** ruke the na? Us se pehle ka open ignore hota hai. Dobara, naye
  email se test karo, 20 second ruk kar kholo.
- Server chal raha hai? (terminal khula hai?)
- Gmail images block to nahi? (Settings → "Images" → "Always display" on karo —
  ye recipient ki taraf ka masla hai, aapke test ke liye apne Gmail mein on rakho.)

### Dashboard khaali / connect nahi ho raha
- Server band to nahi? Terminal check karo, `npm start` dobara.
- URL sahi likha? `http://localhost:3000/dashboard` (https nahi, http).

### Notification nahi aaya
- Chrome ki settings mein notifications allowed hain?
- Windows/Mac ke system notifications on hain?
- (Open to phir bhi dashboard/popup mein dikhega, notification sirf extra hai.)

---

# 📁 HISSA 7 — Konsi file kya karti hai (jab aap khud change karna chaho)

Jab himmat ho aur khud kuch badalna chaho, ye naqsha kaam aayega:

```
email-tracker/
│
├── backend/                 ← SERVER (notes rakhta hai)
│   ├── server.js            ← dimagh: saare "raaste" (jab pixel load ho kya karo, etc.)
│   │                           Yahan 15-second wala rule bhi hai (SELF_OPEN_GUARD_MS)
│   ├── db.js                ← database: emails, opens, clicks — 3 tables
│   └── package.json         ← project ka naam + "npm start" ka matlab
│
├── extension/               ← GMAIL ke andar wali cheez
│   ├── manifest.json        ← extension ka "shanakhti card" (naam, permissions)
│   ├── content.js           ← ASAL KAAM: pixel lagana, link wrap karna, badge dikhana
│   │                           Gmail ke andar ye chalti hai
│   ├── background.js        ← chupke se poll karke notification bhejti hai
│   ├── popup.html / popup.js← wo chhota box jo icon click par khulta hai
│   ├── options.html/.js     ← settings page (server URL)
│   └── content.css          ← rang/design (green chip, badges)
│
├── dashboard/               ← WEBPAGE (stats dekhne ke liye)
│   ├── index.html           ← dashboard ka design
│   └── dashboard.js         ← server se data la kar table banata hai
│
├── README.md                ← chhota overview
└── SETUP-GUIDE.md           ← YE FILE (poori detail)
```

**Agar ek cheez badalni ho — misalein:**

- **15 second ki jagah 30 second** karna? → `backend/server.js` kholo, dhoondo
  `SELF_OPEN_GUARD_MS = 15 * 1000`, use `30 * 1000` kar do. Server band karke
  dobara `npm start`.

- **Badge ka rang** badalna? → `extension/content.css` mein `.mt-opened` ka color
  badlo.

- **Notification ka text** badalna? → `extension/background.js` mein jahan
  "📬 Email kholi gayi!" likha hai, wahan badlo. Phir `chrome://extensions` par
  extension ko **refresh (↻)** karo.

> **Tip:** jab bhi `extension/` ki koi file badlo, `chrome://extensions` par ja
> kar us extension par **↻ (reload)** dabana zaroori hai, warna purana chalta
> rahega. `backend/` badlo to terminal mein server band (`Ctrl+C`) karke `npm
> start` dobara.

---

# 🎯 Rozana istemal (jab sab set ho jaye)

Har dafa jab tracking chahiye:

1. Terminal kholo → `cd .../email-tracker/backend` → `npm start` (server on)
2. (Doosron ko bhejna ho to) `ngrok http 3000` aur URL settings mein update
3. Gmail mein normal email bhejo (Track chip ON)
4. ✓✓ icon ya dashboard par natija dekho

Bas. Jab kaam khatam, terminal mein `Ctrl + C` se server band kar do.

---

# 💬 Aakhri baat

Kamran, koi bhi step atke, ya koi error samajh na aaye — **us error ka screenshot
ya text mujhe bhej dena.** Main usi waqt bata dunga kya karna hai. Jaldi karne ki
zarurat nahi, ek-ek step aaram se karo. Aap ye kar loge. 💪

— Banaya aapke liye.
