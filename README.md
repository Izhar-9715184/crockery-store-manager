# Crockery Store Manager

Crockery shop ke liye Windows software: **stock, sales (bill), customers, udhar ka hisab, daily reports, backup** aur **khud-ba-khud update**.

- Client ke laptop par install hota hai (`Setup.exe`), internet ke baghair bhi chalta hai.
- Aap apne laptop se naya version bhejte hain, client ka software khud download karke update kar leta hai.
- Client ka data uske laptop ke `AppData` folder mein alag rehta hai, is liye **update se data kabhi nahi jata**.

---

## 1. Software mein kya kya hai

| Screen | Kaam |
|---|---|
| **New Sale** | Product search, bill banana, discount, jitne paise mile utne likhna, baqi **udhar** ban jata hai. Save & Print. |
| **Dashboard** | Aaj ki sale, cash mila, udhar diya, profit, total udhar baqi, kam stock wale items, 7 din ka chart |
| **Sales History** | Purane bills dekhna, dobara print karna, galat bill **cancel** karna (stock aur udhar wapas ho jata hai) |
| **Products & Stock** | Product add/edit, maal aaya (Stock in), toota/gum hua (Adjust), shelf count theek karna, har product ki history |
| **Customers & Udhar** | Customer list, udhar ka ledger, **payment wasool karna**, statement print karna, purana udhar likhna |
| **Reports** | Din-ba-din sale/cash/udhar/profit, best selling items, stock report, udhar list (CSV export aur print) |
| **Settings** | Dukaan ka naam/phone/address, invoice size (A4 ya thermal), backups, update status, **Mobile access** |

### Mobile par istemal (dukaan ke WiFi par)

Phone ke browser mein wahi dukaan ka data: **sale/bill banana, stock dalna (maal aaya, toota, count theek, naya product, price), udhar wasool karna, aaj ki sale dekhna**. Phone ko laptop ke database se seedha jora jata hai, is liye phone aur laptop mein data hamesha aik jaisa rehta hai.

**Aik dafa setup (laptop par):**
1. Software mein **Settings → Mobile access** kholein.
2. Apna **PIN** likhein (kam az kam 6 characters) aur **Save** dabayein. Status **ON** ho jayega.
3. Wahan likhay hue address (jaise `http://192.168.1.5:8765`) note karein.
4. Pehli dafa Windows **Firewall** poochay to **Allow access** dabayein (**Private networks** tick rakhein).

**Phone par:**
1. Phone ko **dukaan ke usi WiFi** se jorein jis par laptop hai.
2. Chrome mein wo address kholein, PIN likhein.
3. Chrome ke menu (⋮) mein **Add to Home screen** dabayein. Ab phone par icon aa jayega.

**Yaad rakhein:**
- Laptop **on** aur software **khula** hona chahiye, warna phone connect nahi hoga.
- Ye sirf dukaan ke WiFi par chalta hai, bahar internet se nahi.
- PIN 5 dafa galat likhne par phone kuch der ke liye band ho jata hai. PIN badalne se sab phones logout ho jate hain.
- Phone se settings, backup/restore ya delete jaisay kaam nahi ho sakte, wo sirf laptop se hote hain.

---

### Bazaar se maal ki entry (Tareeqa 2: bina internet, phone se laptop tak)

Jab aap wholesale market mein hon aur signal na ho:

1. **Aik dafa (internet ke saath):** phone par `https://izhar-9715184.github.io/crockery-store-manager/` kholein, aur browser menu se **Add to Home screen** karein. Is ke baad ye page bina internet ke bhi khulta hai.
2. Market mein page kholein, supplier ka naam likhein, aur har cheez ka naam, quantity aur kharid qeemat daalte jayein. List phone mein save rehti hai.
3. Entry mukammal ho to **Send** dabayein aur WhatsApp (ya SMS/email) se apne aap ko / dukaan ko bhej dein. Ye aik hi message hota hai (`CROCKERY-MAAL:...`). Message poora copy hona chahiye; adha kata hua ho to laptop mana kar deta hai.
4. Laptop software mein **Products → Import from phone** dabayein, message paste karein. Software har line ko maujooda product se milata hai; aap check karke **Import now** dabayein. Stock aur kharid qeemat update ho jati hai.
5. Aik hi message dobara import nahi hota (double entry se bachao).
6. Optional: laptop par **Products → Product list for phone** se list bana kar phone mein load kar lein, to naam likhte waqt suggestions aur dukaan ka rate nazar aata hai.

**GitHub Pages aik dafa on karein:** repository → Settings → Pages → Branch `main`, folder `/docs` → Save. Kuch minute baad upar wala link chal jata hai.

### Windows 7 / 8 / 8.1 ke liye alag installer

Tag lagane par (misal `v1.0.4`) GitHub aik hi Release mein **do** installer banata hai:

| File | Kis Windows ke liye |
|---|---|
| `Crockery-Store-Manager-Setup-<ver>.exe` | Windows 10 / 11 |
| `Crockery-Store-Manager-Win7-8-64bit-Setup-<ver>.exe` | Windows 7 / 8 / 8.1 (sirf **64-bit**; 32-bit ke liye installer nahi hai) |

64-bit hai ya nahi: Windows 8 mein *PC → Properties* (Windows 7 mein *Computer → Properties*) mein **System type** dekhein; "64-bit Operating System" likha hona chahiye.

Har installer apne hi channel se update hota hai, is liye Windows 8 wale laptop ko Windows 10 wala program kabhi nahi milta. Purane Windows ke liye Electron 22 use hota hai jis ko ab security updates nahi milte; in laptops ko sirf dukaan ke kaam ke liye rakhein.

---

## 2. Data ki hifazat (client ka kaam chalta rahay, data na jaye)

Data yahan hota hai: `C:\Users\<naam>\AppData\Roaming\Crockery Store Manager\data\crockery.db`

- **Power cut / light chali jaye** to bhi data kharab nahi hota (SQLite WAL + full sync).
- **Roz automatic backup**, aur software chalte hue har 15 minute baad aaj ka backup taza hota hai. Pichle 30 din ke backups rakhe jate hain.
- **Har update se pehle** aur **database badalne se pehle** alag backup banta hai.
- Agar data file kharab ho jaye to software khud **sab se naye sahi backup se restore** kar leta hai aur client ko batata hai.
- Settings mein "Save a copy to USB / folder" se client apne pas bhi copy rakh sakta hai, aur "Restore" se wapas la sakta hai.
- Sale save karte waqt stock, bill aur udhar **aik saath** save hote hain, ya phir kuch bhi nahi. Beech mein adhoora data nahi bachta.

> **Zaroori:** `package.json` mein `productName` aur `appId` kabhi mat badalna. Data folder ka naam `productName` se banta hai, badalne se naya software purana data nahi dhoondega.

---

## 3. Pehli baar setup (sirf aik dafa)

1. **GitHub account** banayein (free): github.com
2. Naya repository banayein: naam `crockery-store-manager`, **Public**.
   (Public is liye ke client ke software ko updates wahan se download karne hain. Is mein sirf software hai, koi password/secret nahi.)
3. `package.json` mein `YOUR_GITHUB_USERNAME` ko apne GitHub username se badal dein (do jagah: `repository` aur `build.publish.owner`).
4. Is folder ko GitHub par upload karein (computer par **Git** install ho):

```bash
git init
git add .
git commit -m "first version"
git branch -M main
git remote add origin https://github.com/Izhar-9715184/crockery-store-manager.git
git push -u origin main
```

5. Pehla release banayein:

```bash
git tag v1.0.0
git push origin v1.0.0
```

6. GitHub ke **Actions** tab mein build chalta nazar aayega (5-10 minute). Khatam hone par **Releases** mein `Crockery Store Manager Setup 1.0.0.exe` milega.
   Ye file client ko bhej dein (WhatsApp / USB / link). Client usay double-click karke install kar leta hai.

> Build se pehle GitHub khud tests aur "smoke test" (software ko asal mein chala kar dekhna) chalata hai. Agar kuch kharab ho to release **publish nahi hota**, is tarah client tak kharab update nahi pohanchta.

**Windows warning:** pehli install par Windows "Unknown publisher" (SmartScreen) dikha sakta hai: **More info → Run anyway**. Ye is liye ke software par paid "code signing certificate" nahi laga. Baad mein kharid kar lagaya ja sakta hai.

---

## 4. Client ko update bhejna (jab bhi koi change karna ho)

1. Apne laptop par code mein change karein (ya mujhe batayein, main change kar dunga).
2. Test karein: `npm install` (pehli dafa), phir `npm test` aur `npm start`.
3. Naya version number do (pichla `v1.0.0` tha to ab `v1.0.1`) aur bhej dein:

```bash
git add .
git commit -m "kya badla"
git tag v1.0.1
git push origin main
git push origin v1.0.1
```

4. 5-10 minute mein GitHub naya installer publish kar deta hai.
5. Client ka software:
   - start hone par aur phir har 4 ghante baad naya version check karta hai,
   - khud background mein download karta hai (kaam nahi rukta),
   - upar hara banner aata hai **"Restart & update"**; client dabaye to foran, warna jab program band karega tab install ho jata hai,
   - install se pehle data ka backup ban jata hai.

Agar client ke pas internet na ho to software normal chalta rahta hai, internet aate hi update ho jata hai.

---

## 5. Database badalna (naya column / naya table chahiye)

Agar update mein data ka structure badalna ho (misal: product mein barcode column), to **purani migration kabhi edit na karein**. `src/core/db.js` mein `MIGRATIONS` list ke **aakhir mein nayi entry** jorein:

```js
// v2
`ALTER TABLE products ADD COLUMN barcode TEXT;`,
```

Client ka software start hone par khud ye chala deta hai. Pehle backup banta hai, aur agar migration fail ho to sab pehle jaisa rehta hai. Purana software naye data ko nahi kholta (kharab nahi karta), pehle update karne ko kehta hai. Ye cheezein tests mein check ki gayi hain.

---

## 6. Folder ka naqsha

```
main.js            Electron ka main hissa: window, backup dialogs, auto-update
preload.js         Screens aur database ke beech mehfooz pul
src/core/db.js     SQLite, migrations, backups, recovery
src/core/service.js  Saari business logic (stock, sale, udhar, reports)
src/renderer/      Screens (HTML/CSS/JS)
test/              Automatic tests
.github/workflows/release.yml   Tag lagane par installer banata aur publish karta hai
```

Commands: `npm install` · `npm start` (chalana) · `npm test` (tests) · `npm run dist` (apne Windows laptop par installer banana, publish kiye baghair).

---

## 7. Jo cheez abhi verify nahi hui (sach baat)

Windows 7/8 wale installers bhi yahan build ya chala kar nahi dekhe gaye. GitHub par smoke test chalta hai, lekin **asal Windows 7/8 PC par install karke aik sale zaroor test karein**, phir client ko dein.

Is software ka database aur screens poori tarah test hue hain (13 database tests + browser mein poora UI test). Lekin jis environment mein ye bana, wahan Electron aur installer builder download nahi ho sakte the, is liye **ye cheezein pehli dafa asal Windows par chalni hain**: Electron window, installer (`.exe`), aur auto-update.

- Release workflow mein "smoke test" step isi liye hai: agar Electron mein kuch bhi galat hua (misal database module na chale) to release ban hi nahi ga, aur GitHub Actions mein laal nishan nazar aayega.
- Pehle apne laptop par `Setup.exe` install karke aik poora sale test kar lein, phir client ko dein.
- Auto-update ka asal test: pehle `v1.0.0` install karein, phir `v1.0.1` release karein aur dekhein ke software update ho jata hai.

Naye features (kharcha/expenses, supplier ka hisab, Urdu interface, barcode scanner, user login) baad mein isi tareeqe se update ke zariye client tak jaa sakte hain.
