# سياسة الأمان | Security Policy

## الإبلاغ عن ثغرة | Reporting a vulnerability

وجدت ثغرة أمنية؟ لا تفتح Issue عاماً.

**عربي**: راسلنا مباشرة عبر [واتساب](https://wa.me/218935535606) أو البريد، مع وصف الثغرة وخطوات إعادة إنتاجها. نرد خلال 72 ساعة كحد أقصى ونُصلح الثغرات المؤكدة بأولوية قصوى.

**English**: Please report vulnerabilities privately via [WhatsApp](https://wa.me/218935535606) or email instead of opening a public issue. We respond within 72 hours and patch confirmed issues with priority.

## نطاق الحماية | Scope

- الموقع الرسمي: https://spos-systems.github.io/SPOS-Remover/
- الكود المصدري في هذا المستودع

## نموذج التهديد | Threat model

الموقع ثابت بالكامل ولا يحتوي على أي معالجة على الخادم: لا قواعد بيانات، لا جلسات، لا رفع ملفات للسيرفر. كل المعالجة تجري في متصفح الزائر، والاتصالات الخارجية الوحيدة هي تنزيل نموذج الذكاء الاصطناعي من شبكات CDN عامة (jsDelivr / esm.sh / staticimgly.com) عند أول استخدام لميزة إزالة الخلفية.

## الإصدارات المدعومة | Supported versions

| الإصدار | الدعم |
|---|---|
| 1.0.x | نعم |
| < 1.0 | لا |
