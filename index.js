require("dotenv").config();

const fs = require("fs");
const csv = require("csv-parser");
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const token = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;

if (!token) {
    console.error("BOT_TOKEN missing");
    process.exit(1);
}

const bot = new TelegramBot(token, {
    webHook: true
});

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
    console.log(`Server running on port ${PORT}`);

    if (!RENDER_URL) {
        console.log("RENDER_EXTERNAL_URL missing");
        return;
    }

    const webhookUrl = `${RENDER_URL}/bot${token}`;

    try {
        await bot.setWebHook(webhookUrl);
        console.log("Webhook set:");
        console.log(webhookUrl);
    } catch (err) {
        console.error("Webhook error:", err.message);
    }
});

const offers = [];
const users = new Map();

fs.createReadStream("offers.csv")
    .pipe(csv({ skipLines: 3 }))
    .on("data", (row) => offers.push(row))
    .on("end", () => {
        console.log(`Loaded ${offers.length} offers`);
    });

function getUser(chatId) {
    if (!users.has(chatId)) {
        users.set(chatId, {});
    }

    return users.get(chatId);
}

function resetUser(chatId) {
    users.set(chatId, {});
    return users.get(chatId);
}

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
    const match = String(value || "").match(/^(\d+)/);
    return match ? match[1] : "";
}

function getInstitutionId(value) {
    const match = String(value || "").match(/^(\d+)/);
    return match ? match[1] : "";
}

function getInstitutionName(value) {
    const parts = String(value || "")
        .split("|")
        .map((p) => p.trim())
        .filter(Boolean);

    return parts.length >= 2
        ? parts.slice(1).join(" - ")
        : String(value || "").trim();
}

function getSpecialityName(value) {
    return String(value || "")
        .replace(/^[A-Z0-9_]+\s*-\s*/i, "")
        .split("|")[0]
        .trim();
}

function uniqueBy(array, keyFn) {
    const map = new Map();

    for (const item of array) {
        const key = keyFn(item);

        if (key && !map.has(key)) {
            map.set(key, item);
        }
    }

    return [...map.values()];
}

async function sendLongMessage(chatId, text, options = {}) {
    const limit = 3900;

    if (text.length <= limit) {
        return bot.sendMessage(chatId, text, options);
    }

    for (let i = 0; i < text.length; i += limit) {
        const part = text.slice(i, i + limit);

        if (i + limit >= text.length) {
            await bot.sendMessage(chatId, part, options);
        } else {
            await bot.sendMessage(chatId, part);
        }
    }
}

function createGoogleMapsUrl(institutionName) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(institutionName)}`;
}

function createShareUrl(text) {
    return `https://t.me/share/url?url=${encodeURIComponent("https://takwin.dz/")}&text=${encodeURIComponent(text)}`;
}

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

function getUserLevelRank(user) {
    return levelRank[user.year] || 0;
}

function getOfferLevelRank(offer) {
    const text = clean(`${offer["المستوى المطلوب"] || ""} ${offer["أدنى مستوى"] || ""}`);

    let bestRank = 0;

    for (const [level, rank] of Object.entries(levelRank)) {
        if (text.includes(clean(level))) {
            bestRank = Math.max(bestRank, rank);
        }
    }

    if (bestRank) return bestRank;

    if (text.includes("ثانوي")) return 10;
    if (text.includes("متوسط")) return 6;
    if (text.includes("ابتدائي")) return 1;

    return 0;
}

function isLevelAllowed(offer, user) {
    const userRank = getUserLevelRank(user);
    const offerRank = getOfferLevelRank(offer);

    if (!userRank) return false;
    if (!offerRank) return true;

    return offerRank <= userRank;
}

const educationLevels = {
    "ابتدائي": [
        "السنة الأولى ابتدائي",
        "السنة الثانية ابتدائي",
        "السنة الثالثة ابتدائي",
        "السنة الرابعة ابتدائي",
        "السنة الخامسة ابتدائي"
    ],
    "متوسط": [
        "السنة الأولى متوسط",
        "السنة الثانية متوسط",
        "السنة الثالثة متوسط",
        "السنة الرابعة متوسط"
    ],
    "ثانوي": [
        "السنة الأولى ثانوي",
        "السنة الثانية ثانوي",
        "السنة الثالثة ثانوي"
    ]
};

const wilayas = {
    "1": "أدرار", "2": "الشلف", "3": "الأغواط", "4": "أم البواقي",
    "5": "باتنة", "6": "بجاية", "7": "بسكرة", "8": "بشار",
    "9": "البليدة", "10": "البويرة", "11": "تمنراست", "12": "تبسة",
    "13": "تلمسان", "14": "تيارت", "15": "تيزي وزو", "16": "الجزائر",
    "17": "الجلفة", "18": "جيجل", "19": "سطيف", "20": "سعيدة",
    "21": "سكيكدة", "22": "سيدي بلعباس", "23": "عنابة", "24": "قالمة",
    "25": "قسنطينة", "26": "المدية", "27": "مستغانم", "28": "المسيلة",
    "29": "معسكر", "30": "ورقلة", "31": "وهران", "32": "البيض",
    "33": "إليزي", "34": "برج بوعريريج", "35": "بومرداس", "36": "الطارف",
    "37": "تندوف", "38": "تيسمسيلت", "39": "الوادي", "40": "خنشلة",
    "41": "سوق أهراس", "42": "تيبازة", "43": "ميلة", "44": "عين الدفلى",
    "45": "النعامة", "46": "عين تموشنت", "47": "غرداية", "48": "غليزان",
    "49": "تيميمون", "50": "برج باجي مختار", "51": "أولاد جلال",
    "52": "بني عباس", "53": "عين صالح", "54": "عين قزام", "55": "تقرت",
    "56": "جانت", "57": "المغير", "58": "المنيعة"
};

function findWilaya(input) {
    const value = clean(input);

    if (wilayas[input]) {
        return { code: input, name: wilayas[input] };
    }

    for (const [code, name] of Object.entries(wilayas)) {
        if (clean(name) === value) {
            return { code, name };
        }
    }

    for (const [code, name] of Object.entries(wilayas)) {
        if (clean(name).includes(value)) {
            return { code, name };
        }
    }

    return null;
}

function backKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: "رجوع", callback_data: "back" }]
            ]
        }
    };
}

function stageKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: "ابتدائي", callback_data: "stage_ابتدائي" }],
                [{ text: "متوسط", callback_data: "stage_متوسط" }],
                [{ text: "ثانوي", callback_data: "stage_ثانوي" }]
            ]
        }
    };
}

function yearKeyboard(stage) {
    const rows = educationLevels[stage].map((year) => {
        return [{ text: year, callback_data: `year_${year}` }];
    });

    rows.push([{ text: "رجوع", callback_data: "back" }]);

    return {
        reply_markup: {
            inline_keyboard: rows
        }
    };
}

function finalKeyboard(mapsUrl, shareUrl) {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: "تحديد موقع المؤسسة", url: mapsUrl }],
                [{ text: "موقع التسجيل الرسمي", url: "https://takwin.dz/" }],
                [{ text: "مشاركة", url: shareUrl }],
                [{ text: "ابدأ من جديد", callback_data: "restart" }]
            ]
        }
    };
}

async function showStage(chatId) {
    await bot.sendMessage(chatId, "اختر المرحلة الدراسية:", stageKeyboard());
}

async function showYears(chatId, user) {
    await bot.sendMessage(chatId, "اختر السنة الدراسية:", yearKeyboard(user.stage));
}

async function askWilaya(chatId) {
    await bot.sendMessage(chatId, "اكتب رقم الولاية أو اسمها", backKeyboard());
}

async function showInstitutions(chatId, user) {
    const offersInWilaya = offers.filter((offer) => {
        return getWilayaCode(offer["الولاية"]) === user.wilayaCode;
    });

    const institutions = uniqueBy(
        offersInWilaya,
        (offer) => getInstitutionId(offer["المؤسسة"])
    );

    if (!institutions.length) {
        return bot.sendMessage(chatId, "لا توجد مؤسسات في هذه الولاية", backKeyboard());
    }

    user.offersInWilaya = offersInWilaya;
    user.institutions = institutions;
    user.step = "waiting_institution";

    let message = `المؤسسات في ${user.wilayaName}\n\n`;

    institutions.forEach((offer, index) => {
        message += `${index + 1}. ${getInstitutionName(offer["المؤسسة"])}\n\n`;
    });

    message += "اكتب رقم المؤسسة";

    await sendLongMessage(chatId, message, backKeyboard());
}

async function showSpecialities(chatId, user) {
    const selectedInstitution = user.institution;
    const id = getInstitutionId(selectedInstitution["المؤسسة"]);

    const offersInInstitution = user.offersInWilaya.filter((offer) => {
        return (
            getInstitutionId(offer["المؤسسة"]) === id &&
            isLevelAllowed(offer, user)
        );
    });

    const specialities = uniqueBy(
        offersInInstitution,
        (offer) => clean(offer["التخصص"])
    );

    if (!specialities.length) {
        return bot.sendMessage(
            chatId,
            "لا توجد تخصصات مناسبة لمستواك في هذه المؤسسة",
            backKeyboard()
        );
    }

    user.specialities = specialities;
    user.step = "waiting_speciality";

    let message = `التخصصات في ${getInstitutionName(selectedInstitution["المؤسسة"])}\n\n`;

    specialities.forEach((offer, index) => {
        message += `${index + 1}. ${getSpecialityName(offer["التخصص"])}\n`;
        message += `الشهادة: ${firstArabic(offer["الشهادة"])}\n\n`;
    });

    message += "اكتب رقم التخصص";

    await sendLongMessage(chatId, message, backKeyboard());
}

async function goBack(chatId, user) {
    if (user.step === "waiting_wilaya") {
        user.step = "waiting_year";
        return showYears(chatId, user);
    }

    if (user.step === "waiting_institution") {
        user.step = "waiting_wilaya";
        user.wilayaCode = null;
        user.wilayaName = null;
        return askWilaya(chatId);
    }

    if (user.step === "waiting_speciality") {
        user.step = "waiting_institution";
        user.institution = null;
        user.specialities = null;
        return showInstitutions(chatId, user);
    }

    return showStage(chatId);
}

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    resetUser(chatId);
    await showStage(chatId);
});

bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const user = getUser(chatId);
    const data = query.data;

    await bot.answerCallbackQuery(query.id);

    if (data === "restart") {
        resetUser(chatId);
        return showStage(chatId);
    }

    if (data === "back") {
        return goBack(chatId, user);
    }

    if (data.startsWith("stage_")) {
        const stage = data.replace("stage_", "");

        user.stage = stage;
        user.step = "waiting_year";

        return showYears(chatId, user);
    }

    if (data.startsWith("year_")) {
        const year = data.replace("year_", "");

        user.year = year;
        user.step = "waiting_wilaya";

        return askWilaya(chatId);
    }
});

bot.on("message", async (msg) => {
    if (!msg.text) return;
    if (msg.text.startsWith("/start")) return;

    const chatId = msg.chat.id;
    const user = getUser(chatId);
    const text = msg.text.trim();

    if (user.step === "waiting_wilaya") {
        const wilaya = findWilaya(text);

        if (!wilaya) {
            return bot.sendMessage(chatId, "الولاية غير صحيحة", backKeyboard());
        }

        user.wilayaCode = wilaya.code;
        user.wilayaName = wilaya.name;

        return showInstitutions(chatId, user);
    }

    if (user.step === "waiting_institution") {
        const index = Number(text) - 1;

        if (!user.institutions || !user.institutions[index]) {
            return bot.sendMessage(chatId, "رقم غير صحيح", backKeyboard());
        }

        user.institution = user.institutions[index];

        return showSpecialities(chatId, user);
    }

    if (user.step === "waiting_speciality") {
        const index = Number(text) - 1;

        if (!user.specialities || !user.specialities[index]) {
            return bot.sendMessage(chatId, "رقم غير صحيح", backKeyboard());
        }

        const selected = user.specialities[index];
        const institutionName = getInstitutionName(user.institution["المؤسسة"]);
        const mapsUrl = createGoogleMapsUrl(institutionName);

        user.step = "finished";

        const summary =
`المرحلة: ${user.stage}
السنة: ${user.year}
الولاية: ${user.wilayaName}

المؤسسة:
${institutionName}

التخصص:
${getSpecialityName(selected["التخصص"])}

الشهادة:
${firstArabic(selected["الشهادة"])}

نمط التكوين:
${firstArabic(selected["نمط التكوين"])}

تاريخ البداية:
${selected["تاريخ البداية"] || ""}

تاريخ النهاية:
${selected["تاريخ النهاية"] || ""}`;

        const shareText =
`اختياري في التكوين المهني

الولاية: ${user.wilayaName}
المؤسسة: ${institutionName}
التخصص: ${getSpecialityName(selected["التخصص"])}
الشهادة: ${firstArabic(selected["الشهادة"])}

موقع التسجيل:
https://takwin.dz/`;

        const shareUrl = createShareUrl(shareText);

        return bot.sendMessage(chatId, summary, finalKeyboard(mapsUrl, shareUrl));
    }

    await bot.sendMessage(chatId, "اكتب /start للبدء من جديد");
});