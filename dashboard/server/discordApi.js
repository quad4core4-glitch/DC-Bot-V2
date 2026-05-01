const { loadDashboardConfig, saveDashboardConfig } = require("./dashboardConfig");

const DISCORD_API = "https://discord.com/api/v10";
const CHANNEL_TYPES = {
    GUILD_TEXT: 0,
    GUILD_CATEGORY: 4,
    GUILD_ANNOUNCEMENT: 5
};

function getGuildId() {
    return process.env.DISCORD_GUILD_ID || "";
}

function getBotToken() {
    return process.env.DISCORD_TOKEN || "";
}

function colorToNumber(color) {
    return Number.parseInt(String(color || "#0f766e").replace("#", ""), 16);
}

async function discordBotRequest(path, options = {}) {
    const token = getBotToken();
    if (!token) throw new Error("DISCORD_TOKEN is required for dashboard Discord API calls.");

    const headers = {
        Authorization: `Bot ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
    };

    for (const [key, value] of Object.entries(headers)) {
        if (value === undefined || value === null) delete headers[key];
    }

    const response = await fetch(`${DISCORD_API}${path}`, {
        ...options,
        headers
    });

    const text = await response.text();
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { message: text };
        }
    }

    if (!response.ok) {
        throw new Error(data.message || data.error || `Discord API returned ${response.status}`);
    }

    return data;
}

async function getBotUser() {
    return discordBotRequest("/users/@me");
}

async function getGuildMember(userId) {
    const guildId = getGuildId();
    if (!guildId) throw new Error("DISCORD_GUILD_ID is required.");
    return discordBotRequest(`/guilds/${guildId}/members/${userId}`);
}

async function getGuildLookups() {
    const guildId = getGuildId();
    if (!guildId) {
        return { ready: false, guild: null, channels: [], roles: [] };
    }

    const [guild, channels, roles] = await Promise.all([
        discordBotRequest(`/guilds/${guildId}`),
        discordBotRequest(`/guilds/${guildId}/channels`),
        discordBotRequest(`/guilds/${guildId}/roles`)
    ]);

    const categories = new Map(
        channels
            .filter(channel => channel.type === CHANNEL_TYPES.GUILD_CATEGORY)
            .map(channel => [channel.id, channel.name])
    );

    return {
        ready: true,
        guild: {
            id: guild.id,
            name: guild.name,
            icon: guild.icon
                ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=80`
                : ""
        },
        channels: channels
            .filter(channel => channel.type === CHANNEL_TYPES.GUILD_TEXT || channel.type === CHANNEL_TYPES.GUILD_ANNOUNCEMENT)
            .sort((a, b) => (a.position || 0) - (b.position || 0) || a.name.localeCompare(b.name))
            .map(channel => ({
                id: channel.id,
                name: channel.parent_id && categories.has(channel.parent_id)
                    ? `${categories.get(channel.parent_id)} / #${channel.name}`
                    : `#${channel.name}`,
                type: channel.type
            })),
        roles: roles
            .filter(role => role.id !== guildId && !role.managed)
            .sort((a, b) => (b.position || 0) - (a.position || 0) || a.name.localeCompare(b.name))
            .map(role => ({
                id: role.id,
                name: role.name,
                color: role.color ? `#${role.color.toString(16).padStart(6, "0")}` : "",
                position: role.position || 0
            }))
    };
}

function recruitmentPanelPayload(config) {
    return {
        embeds: [
            {
                title: config.recruitment.panelTitle,
                description: config.recruitment.panelDescription,
                color: colorToNumber(config.recruitment.panelColor),
                timestamp: new Date().toISOString()
            }
        ],
        components: [
            {
                type: 1,
                components: [
                    {
                        type: 2,
                        custom_id: "recruitment:apply",
                        label: "Apply!",
                        style: 1
                    }
                ]
            }
        ]
    };
}

async function fetchMessage(channelId, messageId) {
    if (!channelId || !messageId) return null;

    try {
        return await discordBotRequest(`/channels/${channelId}/messages/${messageId}`);
    } catch {
        return null;
    }
}

async function ensureRecruitmentPanel() {
    const config = await loadDashboardConfig();
    const recruitment = config.recruitment;

    if (!recruitment.enabled) return { skipped: true, reason: "Recruitment is disabled." };
    if (!recruitment.panelChannelId) return { skipped: true, reason: "Recruitment panel channel is not configured." };

    const payload = recruitmentPanelPayload(config);
    let message = await fetchMessage(recruitment.panelChannelId, recruitment.panelMessageId);
    const bot = await getBotUser();
    if (message?.author?.id !== bot.id) message = null;

    const created = !message;
    if (message) {
        message = await discordBotRequest(`/channels/${recruitment.panelChannelId}/messages/${message.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
        });
    } else {
        message = await discordBotRequest(`/channels/${recruitment.panelChannelId}/messages`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }

    if (message.id !== recruitment.panelMessageId) {
        await saveDashboardConfig({
            ...config,
            recruitment: {
                ...recruitment,
                panelMessageId: message.id
            }
        });
    }

    return {
        created,
        channelId: recruitment.panelChannelId,
        messageId: message.id
    };
}

function normalizeForSearch(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

async function findExistingBotMessage(channelId, botId, content) {
    const messages = await discordBotRequest(`/channels/${channelId}/messages?limit=25`);
    const expected = normalizeForSearch(content);
    const firstLine = normalizeForSearch(String(content || "").split("\n")[0]);

    return messages.find(message => (
        message.author?.id === botId &&
        normalizeForSearch(message.content) === expected
    )) || messages.find(message => (
        message.author?.id === botId &&
        firstLine.length >= 16 &&
        normalizeForSearch(message.content).includes(firstLine)
    )) || null;
}

function reactionEmojiPath(emoji) {
    const custom = String(emoji || "").match(/^<a?:([^:]+):(\d+)>$/) || String(emoji || "").match(/^([^:]+):(\d+)$/);
    if (custom) return encodeURIComponent(`${custom[1]}:${custom[2]}`);
    return encodeURIComponent(String(emoji || ""));
}

async function syncReactionRoles() {
    const config = await loadDashboardConfig();
    const bot = await getBotUser();
    const results = [];
    let changed = false;
    const reactionRoles = [];

    for (const group of config.reactionRoles) {
        if (!group.enabled) {
            results.push({ id: group.id, name: group.name, skipped: true, reason: "disabled" });
            reactionRoles.push(group);
            continue;
        }

        if (!group.channelId || !group.options.length) {
            results.push({ id: group.id, name: group.name, skipped: true, reason: "missing channel or options" });
            reactionRoles.push(group);
            continue;
        }

        try {
            let message = await fetchMessage(group.channelId, group.messageId);
            if (message?.author?.id !== bot.id) message = null;
            if (!message) message = await findExistingBotMessage(group.channelId, bot.id, group.message);

            const created = !message;
            if (message) {
                message = await discordBotRequest(`/channels/${group.channelId}/messages/${message.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ content: group.message })
                });
            } else {
                message = await discordBotRequest(`/channels/${group.channelId}/messages`, {
                    method: "POST",
                    body: JSON.stringify({ content: group.message })
                });
            }

            const reactionErrors = [];
            for (const option of group.options) {
                try {
                    await discordBotRequest(
                        `/channels/${group.channelId}/messages/${message.id}/reactions/${reactionEmojiPath(option.emoji)}/@me`,
                        { method: "PUT", headers: { "Content-Type": undefined } }
                    );
                } catch (error) {
                    reactionErrors.push(`${option.emoji}: ${error.message}`);
                }
            }

            if (message.id !== group.messageId) {
                reactionRoles.push({ ...group, messageId: message.id });
                changed = true;
            } else {
                reactionRoles.push(group);
            }

            results.push({
                id: group.id,
                name: group.name,
                messageId: message.id,
                channelId: group.channelId,
                created,
                reactionErrors
            });
        } catch (error) {
            reactionRoles.push(group);
            results.push({ id: group.id, name: group.name, skipped: true, reason: error.message });
        }
    }

    const nextConfig = changed ? await saveDashboardConfig({ ...config, reactionRoles }) : config;
    return { config: nextConfig, results };
}

module.exports = {
    discordBotRequest,
    ensureRecruitmentPanel,
    getBotUser,
    getGuildLookups,
    getGuildMember,
    syncReactionRoles
};
