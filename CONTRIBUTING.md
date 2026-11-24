# المساهمة في SPOS Remover | Contributing

شكراً لاهتمامك! | Thank you!

## كيف تساهم | Ways to contribute

- الإبلاغ عن مشكلة (Bug) — [افتح Issue](https://github.com/spos-systems/SPOS-Remover/issues/new?template=bug_report.md)
- اقتراح ميزة — [افتح Issue](https://github.com/spos-systems/SPOS-Remover/issues/new?template=feature_request.md)
- تحسين الترجمة العربية أو الإنجليزية (`assets/js/i18n.js`)
- إضافة صيغ/وسوم EXIF جديدة للمحلل (`assets/js/exif.js`)
- تحسين التصميم والوصولية (`assets/css/style.css`)

## قواعد المشروع | Project rules

1. **بدون خطوة بناء**: المشروع HTML/CSS/JS خالص — لا تضف أدوات بناء أو حزم npm مضمّنة.
2. **بدون اعتماديات مضمّنة**: المكتبة الوحيدة (إزالة الخلفية) تُحمَّل وقت التشغيل من CDN. أي ميزة جديدة يجب أن تعمل بدون مكتبات أو توثّق بوضوح حاجتها لـCDN.
3. **الخصوصية خط أحمر**: لا تجعل الكود يرسل أي بيانات لأي سيرفر، ولا تضف تحليلات أو تتبعاً.
4. **عربي أولاً**: أي نص جديد يُضاف بالعربية والإنجليزية معاً في `i18n.js`.
5. **الأداء**: الصفحة خفيفة عمداً — لا تضف ما يرفع حجمها دون مبرر قوي.

## خطوات الـ PR | Pull request flow

1. اعمل Fork ثم فرعاً باسم وصفي: `feature/batch-mode` أو `fix/exif-webp-loop`
2. تأكد من نجاح فحوص CI (صياغة JS، صلاحية JSON، وجود كل الأصول المحلية)
3. حدّث `CHANGELOG.md` تحت قسم "Unreleased"
4. افتح Pull Request وصف ما قمت به بالعربية أو الإنجليزية

## التشغيل محلياً | Run locally

```bash
git clone https://github.com/spos-systems/SPOS-Remover.git
cd SPOS-Remover
python3 -m http.server 8000
```

## التقارير الأمنية | Security

انظر [SECURITY.md](SECURITY.md) — لا تفتح Issue عاماً للثغرات الأمنية.
