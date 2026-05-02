# C STORE Delivery Dashboard - Firebase Version

## الملفات
- index.html
- styles.css
- app.js
- logo.jpg

## ماذا تغير؟
هذه النسخة مربوطة بـ Firebase بدل localStorage.
- تسجيل الدخول: Firebase Authentication
- الفروع: Cloud Firestore collection = branches
- التسعير: Cloud Firestore collection = pricing / main

## حسابات الدخول
- Admin: admin@cstore.com
- View: view@cstore.com

## مهم
تغيير كلمات المرور يتم من Firebase Authentication Console، وليس من داخل الموقع.

## الرفع
ارفع الملفات الأربعة كما هي إلى Vercel أو GitHub Pages أو أي استضافة ثابتة.

## ملاحظة
مفتاح Firebase ومفتاح ORS موجودان داخل app.js، لذلك النسخة مناسبة للاستخدام الداخلي أو كبداية.

- تم تفعيل التحديث المباشر: أي تعديل في الفروع أو التسعير من الأدمن يظهر تلقائيًا عند الفيو بدون Refresh.
