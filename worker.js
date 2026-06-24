// ربات کمک‌آموزش زبان آلمانی برای گروه تلگرامی
// روی Cloudflare Workers اجرا می‌شود، از Gemini API کمک می‌گیرد
// و تنظیمات (روشن/خاموش، تعداد کلمات، ساعت ارسال) را در KV ذخیره می‌کند

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("German Tutor Bot is running ✅");
    }

    let update;
    try {
      update = await request.json();
    } catch (e) {
      return new Response("OK");
    }

    const message = update.message;
    if (!message) {
      return new Response("OK");
    }

    const chatId = message.chat.id;
    const messageId = message.message_id;
    const text = (message.text || message.caption || "").trim();

    console.log("INCOMING MESSAGE:", JSON.stringify(message));

    if (!text && !message.photo && !message.document) {
      return new Response("OK");
    }

    let responseText = null;

    try {
      // هر عکس/PDF که وارد می‌شه رو ذخیره کن تا اگه /lesson جدا اومد، بدونیم منظور همینه
      const incomingFileRef = extractFileRef(message);
      if (incomingFileRef) {
        await saveLastFile(env, chatId, incomingFileRef);
      }

      // تشخیص دستور /lesson روی عکس یا PDF (یا ریپلای به آن، یا آخرین فایل فرستاده‌شده)
      let fileRef = null;
      if (text.startsWith("/lesson")) {
        fileRef =
          incomingFileRef ||
          extractFileRef(message.reply_to_message) ||
          (await getLastFile(env, chatId));
      }

      if (fileRef) {
        const extra = text.replace(/^\/lesson(@\w+)?/, "").trim();
        let count = 5;
        if (/^\d+$/.test(extra)) {
          count = Math.max(1, Math.min(20, parseInt(extra, 10)));
        }
        try {
          const { base64, mimeType } = await getTelegramFileBase64(
            env,
            fileRef.fileId,
            fileRef.mimeType
          );
          responseText = await callGeminiVision(env, buildLessonPrompt(count), base64, mimeType);
        } catch (e) {
          console.log("lesson file error:", e.message);
          responseText =
            "نتوانستم فایل رو پردازش کنم. مطمئن شو عکس یا PDF واضح است و دوباره امتحان کن.\n\nجزئیات خطا: " +
            e.message;
        }
      } else if (text.startsWith("/lesson")) {
        const debugParts = [];
        if (message.document) {
          debugParts.push(
            `فایل خود پیام: نوع="${message.document.mime_type}", اسم="${message.document.file_name}"`
          );
        }
        if (message.reply_to_message) {
          const r = message.reply_to_message;
          if (r.document) {
            debugParts.push(
              `فایل پیام ریپلای‌شده: نوع="${r.document.mime_type}", اسم="${r.document.file_name}"`
            );
          } else if (r.photo) {
            debugParts.push("پیام ریپلای‌شده یک عکس دارد");
          } else {
            debugParts.push("پیام ریپلای‌شده فایلی ندارد");
          }
        } else {
          debugParts.push("این پیام ریپلای به چیزی نیست (reply_to_message خالی است)");
        }
        const lastFileDebug = await getLastFile(env, chatId);
        debugParts.push(
          lastFileDebug
            ? `در حافظه (KV) یک فایل پیدا شد: نوع="${lastFileDebug.mimeType}"`
            : "در حافظه (KV) هیچ فایلی برای این چت پیدا نشد"
        );
        const debugInfo = "\n\n(دیباگ: " + debugParts.join(" | ") + ")";
        responseText =
          "این دستور رو باید روی یه عکس یا PDF از مطالب جلسه بزنی:\n— فایل رو با کپشن /lesson بفرست،\nیا\n— روی فایلی که قبلاً فرستادی ریپلای کن و بنویس /lesson" +
          debugInfo;
      } else if (text.startsWith("/check")) {
        const content = text.replace(/^\/check(@\w+)?/, "").trim();
        if (!content) {
          responseText =
            "بعد از دستور /check جمله یا متن آلمانی‌ت رو بنویس.\nمثال:\n/check Ich habe gestern in die Schule gegangen";
        } else {
          responseText = await callGemini(env, buildCheckPrompt(content));
        }
      } else if (text.startsWith("/explain")) {
        const content = text.replace(/^\/explain(@\w+)?/, "").trim();
        if (!content) {
          responseText =
            "بعد از دستور /explain موضوع گرامری یا کلمه‌ای که گیج‌کننده‌ست رو بنویس.\nمثال:\n/explain Akkusativ vs Dativ";
        } else {
          responseText = await callGemini(env, buildExplainPrompt(content));
        }
      } else if (text.startsWith("/practice")) {
        const content = text.replace(/^\/practice(@\w+)?/, "").trim();
        responseText = await callWorkersAI(
          env,
          buildPracticePrompt(content || "سطح مقدماتی-متوسط (A1-A2)، موضوع عمومی")
        );
      } else if (text.startsWith("/vocab")) {
        const arg = text.replace(/^\/vocab(@\w+)?/, "").trim();
        const settings = await getSettings(env);
        let count = settings.vocab_count;
        let topicOverride = null;
        if (/^\d+$/.test(arg)) {
          count = Math.max(1, Math.min(15, parseInt(arg, 10)));
        } else if (arg) {
          topicOverride = arg;
        }
        responseText = await callWorkersAI(env, buildVocabPrompt(topicOverride, count));
      } else if (text.startsWith("/auto")) {
        const arg = text
          .replace(/^\/auto(@\w+)?/, "")
          .trim()
          .toLowerCase();
        const settings = await getSettings(env);
        if (arg === "on") {
          settings.auto_enabled = true;
          settings.chat_id = chatId;
          await saveSettings(env, settings);
          responseText = `✅ ارسال خودکار روزانه فعال شد.\nساعت ارسال: ${settings.send_hour}:00 (به وقت ایران)\nتعداد کلمات: ${settings.vocab_count}\n\nبرای تغییر ساعت: /set time 9\nبرای تغییر تعداد کلمات: /set count 7\nبرای خاموش کردن: /auto off`;
        } else if (arg === "off") {
          settings.auto_enabled = false;
          await saveSettings(env, settings);
          responseText = "⛔️ ارسال خودکار روزانه خاموش شد. هر وقت خواستی با /auto on دوباره روشنش کن.";
        } else {
          responseText = "بنویس:\n/auto on — روشن کردن ارسال خودکار روزانه\n/auto off — خاموش کردن";
        }
      } else if (text.startsWith("/set")) {
        const parts = text
          .replace(/^\/set(@\w+)?/, "")
          .trim()
          .split(/\s+/);
        const key = (parts[0] || "").toLowerCase();
        const value = parts[1];
        const settings = await getSettings(env);

        if (key === "count") {
          const n = parseInt(value, 10);
          if (isNaN(n) || n < 1 || n > 15) {
            responseText = "عدد بین ۱ تا ۱۵ بده.\nمثال: /set count 7";
          } else {
            settings.vocab_count = n;
            await saveSettings(env, settings);
            responseText = `✅ تعداد کلمات روزانه شد: ${n}`;
          }
        } else if (key === "time") {
          const h = parseInt(value, 10);
          if (isNaN(h) || h < 0 || h > 23) {
            responseText = "ساعت رو بین ۰ تا ۲۳ بده (به وقت ایران).\nمثال: /set time 8";
          } else {
            settings.send_hour = h;
            await saveSettings(env, settings);
            responseText = `✅ ساعت ارسال روزانه شد: ${h}:00 (به وقت ایران)`;
          }
        } else {
          responseText =
            "دستورهای قابل تنظیم:\n/set count [1-15] — تعداد کلمات روزانه\n/set time [0-23] — ساعت ارسال به وقت ایران";
        }
      } else if (text.startsWith("/settings")) {
        const settings = await getSettings(env);
        responseText = `⚙️ تنظیمات فعلی:\nارسال خودکار: ${
          settings.auto_enabled ? "روشن ✅" : "خاموش ⛔️"
        }\nتعداد کلمات روزانه: ${settings.vocab_count}\nساعت ارسال: ${
          settings.send_hour
        }:00 (به وقت ایران)`;
      } else if (text.startsWith("/id")) {
        responseText = `آیدی این چت: \`${chatId}\``;
      } else if (text.startsWith("/help") || text.startsWith("/start")) {
        responseText = helpText();
      }

      if (responseText) {
        await sendTelegramMessage(env, chatId, responseText, messageId);
      }
    } catch (e) {
      console.log("Unhandled error:", e.message, e.stack);
      try {
        await sendTelegramMessage(
          env,
          chatId,
          "⚠️ یه خطای غیرمنتظره پیش آمد.\nجزئیات: " + e.message,
          messageId
        );
      } catch (e2) {
        console.log("Failed to even send error message:", e2.message);
      }
    }

    return new Response("OK");
  },

  // هر چند دقیقه (طبق Cron Trigger) اجرا می‌شود
  // و فقط وقتی ساعت ایران با ساعت تنظیم‌شده برابر باشد و auto روشن باشد، پیام می‌فرستد
  async scheduled(event, env, ctx) {
    const settings = await getSettings(env);
    if (!settings.auto_enabled || !settings.chat_id) {
      return;
    }

    const now = new Date();
    const iranTime = new Date(now.getTime() + 3.5 * 60 * 60 * 1000); // UTC+3:30
    const iranHour = iranTime.getUTCHours();
    const todayKey = iranTime.toISOString().slice(0, 10);

    if (iranHour !== settings.send_hour) return;
    if (settings.last_sent_date === todayKey) return; // امروز قبلاً فرستاده شده

    const text = await callWorkersAI(env, buildVocabPrompt(null, settings.vocab_count));
    await sendTelegramMessage(env, settings.chat_id, "📚 کلمات امروز:\n\n" + text, null);

    settings.last_sent_date = todayKey;
    await saveSettings(env, settings);
  },
};

// ---------- تنظیمات (KV) ----------

const DEFAULT_SETTINGS = {
  auto_enabled: false,
  vocab_count: 5,
  send_hour: 8,
  chat_id: null,
  last_sent_date: null,
};

async function getSettings(env) {
  if (!env.SETTINGS) return { ...DEFAULT_SETTINGS };
  const raw = await env.SETTINGS.get("config");
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(env, settings) {
  if (!env.SETTINGS) return;
  await env.SETTINGS.put("config", JSON.stringify(settings));
}

// ---------- پرامپت‌ها ----------

function buildCheckPrompt(content) {
  return `تو یک معلم زبان آلمانی باتجربه و دلسوز هستی که برای دانش‌آموز فارسی‌زبان توضیح می‌دهد.
متن یا جمله‌ی زیر را از نظر گرامری، املایی و طبیعی بودن بررسی کن.

اگر اشتباه دارد:
1) نسخه‌ی تصحیح‌شده را بنویس (بدون استفاده از ستاره یا علامت مارک‌داون، فقط متن ساده)
2) به فارسی و خیلی کوتاه توضیح بده هر اشتباه چه بوده و قاعده‌اش چیست

اگر جمله کاملاً درست بود، فقط تایید کن و یک نکته یا واژه‌ی مرتبط جالب اضافه کن تا یادگیری ادامه پیدا کند.
پاسخ را کوتاه، مرتب و بدون مقدمه‌چینی اضافه بنویس.

متن دانش‌آموز:
"""${content}"""`;
}

function buildExplainPrompt(content) {
  return `تو یک معلم زبان آلمانی هستی که برای یک زبان‌آموز فارسی‌زبان مبتدی تا متوسط توضیح می‌دهد.
موضوع/قاعده‌ی گرامری/کلمه‌ی زیر را به زبان ساده و فارسی توضیح بده.
حتماً 2 تا 3 مثال جمله‌ی آلمانی همراه با ترجمه‌ی فارسی بیاور.
از اصطلاحات پیچیده‌ی زبان‌شناسی پرهیز کن، طوری توضیح بده که برای یک نوآموز قابل فهم باشد.

موضوع:
"""${content}"""`;
}

function buildVocabPrompt(topicOverride, count) {
  const n = count || 5;
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const topicLine = topicOverride
    ? `موضوع کلمات این بار: ${topicOverride}`
    : `موضوع کلمات هرروز باید متفاوت باشد (یک موضوع روزمره را خودت انتخاب کن، مثل خانه، غذا، احساسات، کار، سفر، آب‌وهوا و...). امروز ${today} است.`;

  return `تو یک معلم زبان آلمانی هستی.
${n} کلمه‌ی جدید و کاربردی آلمانی برای یک زبان‌آموز فارسی‌زبان در سطح مقدماتی-متوسط (A1-A2) انتخاب کن.
${topicLine}

برای هر کلمه این فرمت را رعایت کن (بدون استفاده از ستاره یا علامت مارک‌داون، فقط متن ساده):
کلمه‌ی آلمانی (der/die/das اگر اسم است) — ترجمه‌ی فارسی
یک جمله‌ی مثال کوتاه با ترجمه‌ی فارسی

در ابتدای پاسخ، نام موضوع را بنویس.`;
}

async function saveLastFile(env, chatId, fileRef) {
  if (!env.SETTINGS) return;
  await env.SETTINGS.put(
    `lastfile:${chatId}`,
    JSON.stringify({ fileId: fileRef.fileId, mimeType: fileRef.mimeType, ts: Date.now() })
  );
}

async function getLastFile(env, chatId) {
  if (!env.SETTINGS) return null;
  const raw = await env.SETTINGS.get(`lastfile:${chatId}`);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (Date.now() - data.ts > 10 * 60 * 1000) return null; // قدیمی‌تر از ۱۰ دقیقه، نادیده بگیر
    return { fileId: data.fileId, mimeType: data.mimeType };
  } catch (e) {
    return null;
  }
}

function extractFileRef(msg) {
  if (!msg) return null;

  if (msg.photo && msg.photo.length > 0) {
    return { fileId: msg.photo[msg.photo.length - 1].file_id, mimeType: null };
  }

  if (msg.document) {
    const mt = (msg.document.mime_type || "").toLowerCase();
    const name = (msg.document.file_name || "").toLowerCase();

    const isPdf = mt === "application/pdf" || name.endsWith(".pdf");
    const isImage =
      mt.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif)$/.test(name);

    if (isPdf) {
      return { fileId: msg.document.file_id, mimeType: "application/pdf" };
    }
    if (isImage) {
      return {
        fileId: msg.document.file_id,
        mimeType: mt.startsWith("image/") ? mt : "image/jpeg",
      };
    }
  }

  return null;
}

function buildLessonPrompt(count) {
  const n = count || 5;
  return `تو یک معلم زبان آلمانی هستی که برای یک دانش‌آموز فارسی‌زبان درس می‌دهد (دانش‌آموز فارسی‌زبان است و آلمانی یاد می‌گیرد).
این عکس یا PDF، مطالب همین جلسه‌ی کلاس آلمانی است.
محتوای فایل را بخون و بر اساس همون موضوع/قاعده/واژگانی که توشه، دقیقاً ${n} سوال تمرین جدید بساز.

قوانین مهم:
- متن خودِ سوال (دستورالعمل) باید فارسی باشه؛ کلمه/جمله‌ی آلمانی که قراره تمرین شه رو داخل سوال بیار (مثلاً: «جای خالی را با فعل درست پر کن: Ich ___ Lehrer.» یا «این جمله را به آلمانی ترجمه کن: من دانش‌آموز هستم.»)
- فقط سوال‌ها رو شماره‌گذاری‌شده بنویس
- بعد از همه‌ی سوال‌ها، زیر یک خط جداکننده (---) فقط جواب‌های کوتاه رو بنویس (هرکدوم با همون شماره، جواب می‌تونه آلمانی باشه)
- هیچ خلاصه، مقدمه، توضیح گرامری، یا تحلیلی اضافه نکن
- هیچ متن دیگه‌ای غیر از سوال‌ها و جواب‌ها ننویس`;
}

function buildPracticePrompt(content) {
  return `تو یک معلم زبان آلمانی هستی. برای موضوع/سطح زیر، 3 تمرین کوتاه برای یک دانش‌آموز فارسی‌زبان طراحی کن (مثلاً پر کردن جای خالی، انتخاب کلمه‌ی درست، یا ترجمه‌ی یک جمله‌ی کوتاه).
تمرین‌ها را شماره‌گذاری کن.
در پایان، زیر یک خط جداکننده (---) و با عنوان "پاسخ‌ها:" جواب صحیح هر تمرین را بنویس تا دانش‌آموز اول خودش امتحان کند و بعد جواب را چک کند.

موضوع/سطح:
"""${content}"""`;
}

function helpText() {
  return `سلام! من ربات کمک‌آموزش زبان آلمانی هستم 🇩🇪

📖 دستورهای یادگیری:
/check [جمله] — تصحیح گرامر و املا
/explain [موضوع] — توضیح یک قاعده‌ی گرامری
/practice [موضوع] — ساختن تمرین جدید با جواب
/vocab [تعداد یا موضوع] — چند کلمه‌ی جدید همین الان
/lesson [تعداد، اختیاری] — روی عکس یا PDF مطالب جلسه (یا ریپلای به آن) بزن تا فقط سوال+جواب بسازم (پیش‌فرض ۵ سوال، مثلاً /lesson 10 برای ۱۰ سوال)

⚙️ تنظیمات (دست خودته، هرجور بخوای تغییرش بده):
/auto on — روشن کردن ارسال خودکار روزانه‌ی کلمات
/auto off — خاموش کردن
/set count [1-15] — چندتا کلمه هرروز بفرستم
/set time [0-23] — ساعت ارسال (به وقت ایران)
/settings — دیدن تنظیمات فعلی

مثال:
/check Ich bin gestern nach Schule gegangen
/vocab 10
/set time 9
/auto on`;
}

// ---------- ارتباط با Gemini ----------

async function callWorkersAI(env, prompt) {
  if (!env.AI) {
    console.log("Workers AI binding (env.AI) not found, falling back to Gemini");
    return await callGemini(env, prompt);
  }

  try {
    const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [{ role: "user", content: prompt }],
    });

    const text = result?.response;

    if (!text) {
      console.log("Workers AI response without text:", JSON.stringify(result));
      return "نتوانستم از هوش مصنوعی Cloudflare جواب بگیرم. چند لحظه دیگه دوباره امتحان کن.";
    }

    return text;
  } catch (e) {
    console.log("Workers AI error:", e.message);
    return "خطا در ارتباط با هوش مصنوعی Cloudflare. دوباره امتحان کن.";
  }
}

async function callGemini(env, prompt) {
  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (res.status === 503 && attempt < 2) {
        await sleep(2000);
        continue;
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        console.log("Gemini response without text:", JSON.stringify(data));
        return "نتوانستم از هوش مصنوعی جواب بگیرم (سرور موقتاً شلوغ بود). چند لحظه دیگه دوباره امتحان کن.";
      }

      return text;
    } catch (e) {
      console.log("Gemini error:", e.message);
      if (attempt === 2) {
        return "خطایی در ارتباط با هوش مصنوعی پیش آمد. دوباره امتحان کن.";
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiVision(env, prompt, base64, mimeType) {
  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const body = JSON.stringify({
    contents: [
      {
        parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }],
      },
    ],
  });

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (res.status === 503 && attempt < 2) {
        await sleep(2000);
        continue;
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        console.log("Gemini vision response without text:", JSON.stringify(data));
        const reason =
          data?.promptFeedback?.blockReason ||
          data?.candidates?.[0]?.finishReason ||
          data?.error?.message ||
          "نامشخص";
        return (
          "نتوانستم عکس/فایل رو تحلیل کنم (سرور Gemini موقتاً شلوغ بود یا خطایی داشت).\n\n(دیباگ: status=" +
          res.status +
          ", reason=" +
          reason +
          ", mimeType=" +
          mimeType +
          ")"
        );
      }

      return text;
    } catch (e) {
      console.log("Gemini vision error:", e.message);
      if (attempt === 2) {
        return "خطا در پردازش فایل.\n\n(دیباگ: " + e.message + ")";
      }
    }
  }
}

// ---------- ارتباط با تلگرام ----------

async function sendTelegramMessage(env, chatId, text, replyToMessageId) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const MAX_LEN = 3500; // کمی پایین‌تر از محدودیت واقعی تلگرام (۴۰۹۶) برای اطمینان

  const chunks = [];
  let remaining = text;
  while (remaining.length > MAX_LEN) {
    let cutAt = remaining.lastIndexOf("\n", MAX_LEN);
    if (cutAt <= 0) cutAt = MAX_LEN;
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt);
  }
  chunks.push(remaining);

  for (let i = 0; i < chunks.length; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunks[i],
        reply_to_message_id: i === 0 ? replyToMessageId : undefined,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.log("sendTelegramMessage failed:", res.status, errBody);
    }
  }
}

async function getTelegramFileBase64(env, fileId, mimeHint) {
  const getFileUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
  const fileRes = await fetch(getFileUrl);
  const fileData = await fileRes.json();

  if (!fileData.ok) {
    throw new Error("getFile failed: " + JSON.stringify(fileData));
  }

  const filePath = fileData.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const imgRes = await fetch(fileUrl);
  const buffer = await imgRes.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);

  let mimeType = mimeHint;
  if (!mimeType) {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".png")) mimeType = "image/png";
    else if (lower.endsWith(".pdf")) mimeType = "application/pdf";
    else mimeType = "image/jpeg";
  }

  return { base64, mimeType };
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}