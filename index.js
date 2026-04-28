require("dotenv").config();

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const csv = require("csv-parser");
const { Readable } = require("stream");

const token = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL; // بدل RENDER_EXTERNAL_URL
const CSV_URL = process.env.CSV_URL;

if (!token || !BASE_URL || !CSV_URL) {
    console.error("Missing env variables");
    process.exit(1);
}

const bot = new TelegramBot(token, { webHook: true });
const app = express();
app.use(express.json());

app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

app.get("/", (req, res) => {
    res.send("Bot is running");
});

app.listen(PORT, async () => {
    console.log("Server started");

    try {
        await bot.setWebHook(`${BASE_URL}/bot${token}`);
        console.log("Webhook set");
    } catch (err) {
        console.error("Webhook error:", err.message);
    }

    await loadOffers();
});

/* =========================
   DATA
========================= */

const offers = [];
const users = new Map();

async function loadOffers() {
    try {
        const res = await axios.get(CSV_URL, { responseType: "text" });

        offers.length = 0;

        return new Promise((resolve) => {
            Readable.from(res.data)
                .pipe(csv({ skipLines: 3 }))
                .on("data", (row) => offers.push(row))
                .on("end", () => {
                    console.log(`Loaded ${offers.length} offers`);
                    resolve();
                });
        });

    } catch (err) {
        console.error("CSV load error:", err.message);
    }
}

function getUser(chatId) {
    if (!users.has(chatId)) users.set(chatId, {});
    return users.get(chatId);
}

function resetUser(chatId) {
    users.set(chatId, {});
}

/* =========================
   HELPERS
========================= */

function clean(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي");
}

function firstArabic(value) {
    return String(value || "").split("|")[0].trim();
}

function getWilayaCode(value) {
    const m = String(value || "").match(/^(\d+)/);
    return m ? m[1] : "";
}

function getInstitutionId(value) {
    const m = String(value || "").match(/^(\d+)/);
    return m ? m[1] : "";
}

function getInstitutionName(value) {
    const parts = String(value || "")
        .split("|")
        .map(v => v.trim())
        .filter(Boolean);

    return parts.length >= 2 ? parts.slice(1).join(" - ") : value;
}

function getSpecialityName(value) {
    return String(value || "")
        .replace(/^[A-Z0-9_]+\s*-\s*/i, "")
        .split("|")[0]
        .trim();
}

function uniqueBy(arr, fn) {
    const map = new Map();
    arr.forEach(i => {
        const k = fn(i);
        if (k && !map.has(k)) map.set(k, i);
    });
    return [...map.values()];
}

function mapsUrl(name) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
}

/* =========================
   LEVEL SYSTEM
========================= */

const levelRank = {
    "السنة الأولى ابتدائي": 1,
    "السنة الثانية ابتدائي": 2,
    "السنة الثالثة ابتدائي": 3,
    "السنة الرابعة ابتدائي": 4,
    "السنة الخامسة ابتدائي": 5,
    "السنة الأولى متوسط": 6,
    "السنة الثانية متوسط": 7,
    "السنة الثالثة متوسط": 8,
    "السنة الرابعة متوسط": 9,
    "السنة الأولى ثانوي": 10,
    "السنة الثانية ثانوي": 11,
    "السنة الثالثة ثانوي": 12
};

function getUserRank(user) {
    return levelRank[user.year] || 0;
}

function getOfferRank(offer) {
    const text = clean(
        `${offer["المستوى المطلوب"] || ""} ${offer["أدنى مستوى"] || ""}`
    );

    let r = 0;

    for (const [lvl, val] of Object.entries(levelRank)) {
        if (text.includes(clean(lvl))) r = Math.max(r, val);
    }

    if (!r) {
        if (text.includes("ثانوي")) r = 10;
        if (text.includes("متوسط")) r = 6;
        if (text.includes("ابتدائي")) r = 1;
    }

    return r;
}

function isAllowed(offer, user) {
    const u = getUserRank(user);
    const o = getOfferRank(offer);
    return !o || o <= u;
}

/* =========================
   WILAYAS
========================= */

const wilayas = {
    "27": "مستغانم",
    "16": "الجزائر",
    "31": "وهران",
    "25": "قسنطينة"
};

function findWilaya(input) {
    const v = clean(input);

    if (wilayas[input]) return { code: input, name: wilayas[input] };

    for (const [c, n] of Object.entries(wilayas)) {
        if (clean(n).includes(v)) return { code: c, name: n };
    }

    return null;
}

/* =========================
   BOT FLOW
========================= */

bot.onText(/\/start/, async (msg) => {
    const id = msg.chat.id;
    resetUser(id);

    bot.sendMessage(id, "اختر المرحلة:", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "ثانوي", callback_data: "stage" }]
            ]
        }
    });
});

bot.on("callback_query", async (q) => {
    const id = q.message.chat.id;
    const user = getUser(id);

    if (q.data === "stage") {
        user.stage = "ثانوي";

        bot.sendMessage(id, "اختر السنة:", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "الثالثة ثانوي", callback_data: "year_3" }]
                ]
            }
        });
    }

    if (q.data === "year_3") {
        user.year = "السنة الثالثة ثانوي";
        user.step = "wilaya";

        bot.sendMessage(id, "اكتب اسم الولاية أو رقمها");
    }
});

bot.on("message", async (msg) => {
    const id = msg.chat.id;
    const user = getUser(id);
    const text = msg.text;

    if (user.step === "wilaya") {
        const w = findWilaya(text);

        if (!w) {
            return bot.sendMessage(id, "ولاية غير صحيحة");
        }

        user.wilaya = w;

        const list = offers.filter(o => getWilayaCode(o["الولاية"]) === w.code);

        const inst = uniqueBy(list, o => getInstitutionId(o["المؤسسة"]));

        user.inst = inst;
        user.offers = list;
        user.step = "inst";

        let m = `المؤسسات في ${w.name}\n\n`;

        inst.forEach((i, idx) => {
            m += `${idx + 1}. ${getInstitutionName(i["المؤسسة"])}\n\n`;
        });

        bot.sendMessage(id, m);
    }

    else if (user.step === "inst") {
        const i = user.inst[Number(text) - 1];
        if (!i) return bot.sendMessage(id, "خطأ");

        const idInst = getInstitutionId(i["المؤسسة"]);

        const specs = uniqueBy(
            user.offers.filter(o =>
                getInstitutionId(o["المؤسسة"]) === idInst &&
                isAllowed(o, user)
            ),
            o => clean(o["التخصص"])
        );

        user.specs = specs;
        user.instSel = i;
        user.step = "spec";

        let m = "التخصصات:\n\n";

        specs.forEach((s, idx) => {
            m += `${idx + 1}. ${getSpecialityName(s["التخصص"])}\n`;
        });

        bot.sendMessage(id, m);
    }

    else if (user.step === "spec") {
        const s = user.specs[Number(text) - 1];
        if (!s) return bot.sendMessage(id, "خطأ");

        const name = getInstitutionName(user.instSel["المؤسسة"]);

        const summary =
`الولاية: ${user.wilaya.name}
المؤسسة: ${name}
التخصص: ${getSpecialityName(s["التخصص"])}
الشهادة: ${firstArabic(s["الشهادة"])}`;

        bot.sendMessage(id, summary, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "الموقع", url: mapsUrl(name) }],
                    [{ text: "ابدأ من جديد", callback_data: "restart" }]
                ]
            }
        });
    }
});

bot.on("callback_query", (q) => {
    if (q.data === "restart") {
        resetUser(q.message.chat.id);
        bot.sendMessage(q.message.chat.id, "/start");
    }
});
