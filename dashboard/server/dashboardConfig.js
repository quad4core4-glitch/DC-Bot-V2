const crypto = require("crypto");
const { filePathFor, readState, writeState } = require("./stateStore");

const CONFIG_SCOPE = "dashboardConfig";
const CONFIG_PATH = filePathFor(CONFIG_SCOPE);
const SNOWFLAKE_RE = /^\d{10,25}$/;
const HEX_COLOR_RE = /^#?[0-9a-f]{6}$/i;
const CONFIG_VERSION = 2;

const DEFAULT_RECRUITMENT_QUESTIONS = [
    "Which team do you want to join?",
    "Do you have other accounts, if yes, in which team?",
    "Were you ever flagged/banned, had double VIP?",
    "Do you want to stay long-term or just visit?",
    "How many km's do you usually drive per week?"
].join("\n");

const RECRUITMENT_TEAMS = [
    "Discord",
    "Discord\u00b2",
    "Discord 3\u2122",
    "Nascar DC"
];

const DEFAULT_CONFIG = {
    version: CONFIG_VERSION,
    updatedAt: new Date(0).toISOString(),
    welcome: {
        enabled: true,
        channelId: "916042813425201152",
        message: [
            "Hey {member}! Welcome to the **Discord Alliance server**!",
            "",
            "> 1. **Head to <#839605609027600415>**",
            "> Read the server rules carefully, and once done, press the confirmation reaction to get access.",
            ">",
            "> 2. **Unlock More Channels**",
            "> Go to <#840310137390104627> and select your desired option to access more channels of this server.",
            ">",
            "> 3. **Name Policy**",
            "> Please make sure your in-game name and your Discord display name matches in this server.",
            "> This helps leaders identify you easily.",
            "",
            "If you want access to more channels in the **Discord Drivers** server, just reach out to your team leader or co-leaders.",
            "",
            "**Have fun and enjoy your time here!**"
        ].join("\n")
    },
    leave: {
        enabled: true,
        channelId: "839905184154517597",
        message: "**{tag}** has left the server."
    },
    recruitment: {
        enabled: true,
        panelChannelId: "",
        panelMessageId: "",
        panelTitle: "DCA Team Recruitment",
        panelDescription: "Ready to apply for the DCA teams? Press **Apply!** and follow the private prompts.",
        panelColor: "#0f766e",
        logChannelId: "",
        recruiterAlertChannelId: "",
        privateThreads: true,
        threadAutoArchiveMinutes: 10080,
        questionsIntro: "Great that you want to join us! Please answer the following questions so that we can find out what team fits you the best.",
        questions: DEFAULT_RECRUITMENT_QUESTIONS,
        teams: RECRUITMENT_TEAMS,
        tutorials: [
            {
                id: "license-screenshot",
                label: "License Screenshot",
                description: "How to upload an uncropped driver's license screenshot with coins and gems visible.",
                videoUrl: "",
                enabled: true
            },
            {
                id: "player-stats",
                label: "Player Stats",
                description: "How to show your player stats for recruiters.",
                videoUrl: "",
                enabled: true
            }
        ]
    },
    reactionRoles: [
        {
            id: "language-unlock",
            name: "Other languages",
            enabled: true,
            channelId: "840310137390104627",
            messageId: "",
            message: "If you want to speak in other language choose the confirmation reaction to select that.",
            options: [
                { emoji: "\u2611\uFE0F", roleId: "842089922768797726", label: "Other language" }
            ]
        },
        {
            id: "event-pings",
            name: "Organized event pings",
            enabled: true,
            channelId: "839907517663936612",
            messageId: "",
            message: "React with thumbsup if you want ping everytime there is a organized event.",
            options: [
                { emoji: "\uD83D\uDC4D", roleId: "840250757235212339", label: "PE call" }
            ]
        },
        {
            id: "garage-change-pings",
            name: "Garage change pings",
            enabled: true,
            channelId: "839907517663936612",
            messageId: "",
            message: "React with thumbs up if you want ping in every changes of <#840008978162647071> . If you don't choose it, you will still get an ping on weekly basis when it's done.",
            options: [
                { emoji: "\uD83D\uDC4D", roleId: "1026142060937498685", label: "GC call" }
            ]
        },
        {
            id: "tournament-adventure",
            name: "Tournament and adventure",
            enabled: true,
            channelId: "840310137390104627",
            messageId: "",
            message: [
                "**If you want to participate in tournament or socialise in a competitive way in adventure, choose the one you like.**",
                "",
                "Tournament choose \uD83C\uDFC1",
                "Adventure choose \uD83C\uDFDE\uFE0F"
            ].join("\n"),
            options: [
                { emoji: "\uD83C\uDFC1", roleId: "963429908619616286", label: "Tournament" },
                { emoji: "\uD83C\uDFDE\uFE0F", roleId: "1103695688363159572", label: "Adventure" }
            ]
        },
        {
            id: "rules-confirmation",
            name: "Rules confirmation",
            enabled: true,
            channelId: "1239880290026000385",
            messageId: "",
            message: "If you can confirm you have read the rules, then press the confirmation reaction.",
            options: [
                { emoji: "\u2611\uFE0F", roleId: "1345651591583367168", label: "Read rules" }
            ]
        },
        {
            id: "social-categories",
            name: "Social categories",
            enabled: true,
            channelId: "840310137390104627",
            messageId: "",
            message: [
                "**Select or deselect which category you wanted to be a part of your server.**",
                "",
                "\uD83C\uDDE6 For socialise ingame.",
                "\uD83C\uDDE7 For socialise for everything else."
            ].join("\n"),
            options: [
                { emoji: "\uD83C\uDDE6", roleId: "840250774704488479", label: "Socialise ingame" },
                { emoji: "\uD83C\uDDE7", roleId: "840332933365497877", label: "Socialise outside game" }
            ]
        }
    ]
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function shortId() {
    return crypto.randomBytes(6).toString("hex");
}

function isSnowflake(value) {
    return typeof value === "string" && SNOWFLAKE_RE.test(value.trim());
}

function cleanSnowflake(value, fallback = "") {
    if (isSnowflake(value)) return value.trim();
    return fallback;
}

function cleanBoolean(value, fallback) {
    if (typeof value === "boolean") return value;
    return Boolean(fallback);
}

function cleanText(value, fallback, maxLength) {
    if (typeof value !== "string") return fallback;
    const text = value.trim().length ? value : fallback;
    return text.slice(0, maxLength);
}

function cleanOptionalText(value, fallback, maxLength) {
    if (typeof value !== "string") return fallback;
    return value.slice(0, maxLength);
}

function cleanName(value, fallback, maxLength = 80) {
    if (typeof value !== "string") return fallback;
    const text = value.trim();
    return (text || fallback).slice(0, maxLength);
}

function cleanId(value, fallback) {
    if (typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value)) return value;
    return fallback || `item-${shortId()}`;
}

function cleanColor(value, fallback) {
    if (typeof value !== "string") return fallback;
    const text = value.trim();
    if (!HEX_COLOR_RE.test(text)) return fallback;
    return text.startsWith("#") ? text : `#${text}`;
}

function cleanNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeMessageSection(input, fallback) {
    const raw = input && typeof input === "object" ? input : {};

    return {
        enabled: cleanBoolean(raw.enabled, fallback.enabled),
        channelId: cleanSnowflake(raw.channelId, fallback.channelId),
        message: cleanText(raw.message, fallback.message, 2000)
    };
}

function normalizeReactionOption(input) {
    const raw = input && typeof input === "object" ? input : {};
    const emoji = cleanName(raw.emoji, "", 128);
    const roleId = cleanSnowflake(raw.roleId, "");

    if (!emoji || !roleId) return null;

    return {
        emoji,
        roleId,
        label: cleanName(raw.label, "", 80)
    };
}

function normalizeReactionGroup(input, fallback, index) {
    const raw = input && typeof input === "object" ? input : {};
    const base = fallback && typeof fallback === "object" ? fallback : {};
    const options = Array.isArray(raw.options) ? raw.options : base.options;

    return {
        id: cleanId(raw.id, base.id || `reaction-${index + 1}`),
        name: cleanName(raw.name, base.name || `Reaction message ${index + 1}`),
        enabled: cleanBoolean(raw.enabled, base.enabled !== false),
        channelId: cleanSnowflake(raw.channelId, base.channelId || ""),
        messageId: cleanSnowflake(raw.messageId, base.messageId || ""),
        message: cleanText(raw.message, base.message || "React below to choose a role.", 2000),
        options: (Array.isArray(options) ? options : [])
            .slice(0, 20)
            .map(normalizeReactionOption)
            .filter(Boolean)
    };
}

function normalizeTutorial(input, fallback, index) {
    const raw = input && typeof input === "object" ? input : {};
    const base = fallback && typeof fallback === "object" ? fallback : {};

    return {
        id: cleanId(raw.id, base.id || `tutorial-${index + 1}`),
        label: cleanName(raw.label, base.label || `Tutorial ${index + 1}`, 40),
        description: cleanOptionalText(raw.description, base.description || "", 300),
        videoUrl: cleanOptionalText(raw.videoUrl, base.videoUrl || "", 1000),
        enabled: cleanBoolean(raw.enabled, base.enabled !== false)
    };
}

function normalizeRecruitment(input, fallback) {
    const raw = input && typeof input === "object" ? input : {};
    const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_CONFIG.recruitment;
    const rawTutorials = Array.isArray(raw.tutorials) ? raw.tutorials : base.tutorials;
    const rawTeams = Array.isArray(raw.teams) ? raw.teams : base.teams;

    return {
        enabled: cleanBoolean(raw.enabled, base.enabled !== false),
        panelChannelId: cleanSnowflake(raw.panelChannelId, base.panelChannelId || ""),
        panelMessageId: cleanSnowflake(raw.panelMessageId, base.panelMessageId || ""),
        panelTitle: cleanName(raw.panelTitle, base.panelTitle, 120),
        panelDescription: cleanText(raw.panelDescription, base.panelDescription, 2000),
        panelColor: cleanColor(raw.panelColor, base.panelColor || "#0f766e"),
        logChannelId: cleanSnowflake(raw.logChannelId, base.logChannelId || ""),
        recruiterAlertChannelId: cleanSnowflake(raw.recruiterAlertChannelId, base.recruiterAlertChannelId || ""),
        privateThreads: cleanBoolean(raw.privateThreads, base.privateThreads !== false),
        threadAutoArchiveMinutes: cleanNumber(raw.threadAutoArchiveMinutes, base.threadAutoArchiveMinutes || 10080, 60, 10080),
        questionsIntro: cleanText(raw.questionsIntro, base.questionsIntro, 600),
        questions: cleanText(raw.questions, base.questions || DEFAULT_RECRUITMENT_QUESTIONS, 1800),
        teams: rawTeams
            .slice(0, 10)
            .map(team => cleanName(team, "", 40))
            .filter(Boolean),
        tutorials: rawTutorials
            .slice(0, 10)
            .map((tutorial, index) => normalizeTutorial(tutorial, base.tutorials?.[index], index))
    };
}

function normalizeDashboardConfig(input, options = {}) {
    const raw = input && typeof input === "object" ? input : {};
    const defaults = clone(DEFAULT_CONFIG);
    const fallbackRoles = Array.isArray(raw.reactionRoles) ? raw.reactionRoles : defaults.reactionRoles;

    return {
        version: CONFIG_VERSION,
        updatedAt: options.preserveUpdatedAt && typeof raw.updatedAt === "string"
            ? raw.updatedAt
            : new Date().toISOString(),
        welcome: normalizeMessageSection(raw.welcome, defaults.welcome),
        leave: normalizeMessageSection(raw.leave, defaults.leave),
        recruitment: normalizeRecruitment(raw.recruitment, defaults.recruitment),
        reactionRoles: fallbackRoles
            .slice(0, 25)
            .map((group, index) => normalizeReactionGroup(group, defaults.reactionRoles[index], index))
    };
}

async function loadDashboardConfig() {
    const raw = await readState(CONFIG_SCOPE, DEFAULT_CONFIG);
    return normalizeDashboardConfig(raw, { preserveUpdatedAt: true });
}

async function saveDashboardConfig(config) {
    const normalized = normalizeDashboardConfig(config);
    await writeState(CONFIG_SCOPE, normalized);
    return normalized;
}

module.exports = {
    CONFIG_PATH,
    DEFAULT_CONFIG,
    DEFAULT_RECRUITMENT_QUESTIONS,
    RECRUITMENT_TEAMS,
    loadDashboardConfig,
    saveDashboardConfig,
    normalizeDashboardConfig,
    isSnowflake
};
