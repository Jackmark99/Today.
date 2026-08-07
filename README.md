# Planning Équipe

اپ برنامه‌ی کاری تیم — یک وب‌اپ مستقل (PWA) با ذخیره‌سازی واقعی و همگام‌سازی زنده بین اعضای تیم، از طریق Firebase (رایگان).

## ساختار فایل‌ها

```
/
├── index.html      ← کل اپ (UI + منطق + استایل) — بدون تغییر بصری
├── manifest.json   ← تنظیمات نصب PWA (نام، آیکون، رنگ)
├── sw.js           ← Service Worker (نصب + کش آفلاین ساده)
├── icon-192.png    ← آیکون اپ (۱۹۲×۱۹۲)
└── icon-512.png    ← آیکون اپ (۵۱۲×۵۱۲)
```

هیچ فایل build یا npm install لازم نیست — همه‌چیز static است، فقط یک تنظیم کوچک قبل از deploy لازم داری (پایین توضیح داده شده).

## قدم ۱ — ساخت پروژه‌ی Firebase (رایگان، ۵ دقیقه)

1. برو به https://console.firebase.google.com و با اکانت گوگل وارد شو
2. **Add project** بزن → یک اسم بده (مثلاً `planning-equipe`) → مراحل رو تایید کن
3. از منوی سمت چپ: **Build → Firestore Database → Create database**
4. حالت را روی **Start in test mode** بگذار (برای شروع کافیه) → منطقه رو انتخاب کن → Enable
5. برگرد به صفحه‌ی اصلی پروژه (آیکون خانه) → روی آیکون چرخ‌دنده (⚙️) → **Project settings**
6. پایین صفحه، بخش **Your apps** → آیکون وب (`</>`) → یک اسم بده و **Register app**
7. یک بلوک کد به‌نام `firebaseConfig` نشونت می‌ده — دقیقاً همون object رو کپی کن

## قدم ۲ — وصل کردن config به پروژه

فایل `index.html` رو باز کن، دنبال این بخش بگرد (نزدیک بالای تگ `<script type="module">`):

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

مقادیر `YOUR_...` رو با چیزی که از Firebase کپی کردی جایگزین کن و فایل رو ذخیره کن.

## قدم ۳ — تنظیم دسترسی (امنیت پایه)

توی Firestore → تب **Rules**، این را جایگزین محتوای فعلی کن (اجازه‌ی خواندن/نوشتن فقط برای سند برنامه، ساده و کافی برای یک تیم کوچک):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /planning/{docId} {
      allow read, write: if true;
    }
  }
}
```

⚠️ این حالت یعنی هر کسی که لینک سایتت رو داشته باشه می‌تونه برنامه رو ببینه و ویرایش کنه (بدون رمز عبور) — برای یک تیم کوچک و داخلی معمولاً کافیه، ولی اگه بعداً خواستی محدودترش کنیم (مثلاً با رمز ساده)، بگو تا اضافه کنم.

## قدم ۴ — تست محلی (اختیاری)

```bash
cd planning-equipe
python3 -m http.server 8000
# در مرورگر باز کن: http://localhost:8000
```

## قدم ۵ — Deploy

### Vercel
1. https://vercel.com → Add New Project → پوشه رو آپلود کن یا از GitHub وصل کن
2. Framework: **Other**، Build Command خالی، Output Directory: `.`
3. Deploy → لینک دائمی مثل `https://planning-equipe.vercel.app`

### Netlify
1. https://netlify.com → Add new site → Deploy manually
2. پوشه رو Drag & Drop کن → همون لحظه لینک می‌گیری

### GitHub Pages
```bash
git init
git add .
git commit -m "Planning Équipe"
git branch -M main
git remote add origin https://github.com/USERNAME/planning-equipe.git
git push -u origin main
```
سپس: Settings → Pages → Source: branch `main`، پوشه `/root` → لینک: `https://USERNAME.github.io/planning-equipe/`

## بعد از deploy

- داده‌ها الان واقعاً بین همه‌ی اعضای تیم که لینک رو دارن **زنده و همگام** ذخیره می‌شن (هرکی آپلود یا ویرایش کنه، بقیه فوراً می‌بینن، بدون رفرش)
- چون دامنه واقعی و مستقله، این بار کروم معیارهای نصب PWA رو کامل تشخیص می‌ده و دکمه‌ی «Install app» طبیعی ظاهر می‌شه
- هویت («من کی‌ام») روی خود گوشی هرکس ذخیره می‌شه (نه در Firebase)، پس هرکی فقط برنامه‌ی خودش رو با رنگ قرمز می‌بینه

اگه در هر قدمی گیر کردی، دقیقاً همون خطا یا اسکرین‌شات رو بفرست تا کمک کنم.

