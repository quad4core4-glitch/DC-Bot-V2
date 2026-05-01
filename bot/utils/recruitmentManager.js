const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    PermissionFlagsBits
} = require("discord.js");
const { loadDashboardConfig, saveDashboardConfig } = require("./dashboardConfig");
const {
    appendRecruitmentLog,
    getTicket,
    saveTicket,
    updateTicket
} = require("./recruitmentStore");

const APPLY_BUTTON_ID = "recruitment:apply";
const EVENT_YES_ID = "recruitment:event:yes";
const EVENT_NO_ID = "recruitment:event:no";
const CLAIM_ID = "recruitment:claim";
const CLOSE_ID = "recruitment:close";
const CLOSE_TEAM_PREFIX = "recruitment:close-team:";
const TUTORIAL_PREFIX = "recruitment:tutorial:";
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;
const activeSessions = new Map();

const TEAM_BUTTONS = [
    { id: "discord", label: "Discord", team: "Discord", style: ButtonStyle.Success },
    { id: "discord2", label: "Discord\u00b2", team: "Discord\u00b2", style: ButtonStyle.Success },
    { id: "discord3", label: "Discord 3\u2122", team: "Discord 3\u2122", style: ButtonStyle.Success },
    { id: "nascar-dc", label: "Nascar DC", team: "Nascar DC", style: ButtonStyle.Success },
    { id: "rejected", label: "Rejected", team: "", style: ButtonStyle.Danger }
];

function sessionKey(interaction) {
    return `${interaction.guildId}:${interaction.channelId}:${interaction.user.id}`;
}

function recruiterRoleId() {
    return process.env.RECRUITER_ROLE_ID || process.env.RECRUITMENT_RECRUITER_ROLE_ID || "";
}

function isImageAttachment(attachment) {
    const contentType = String(attachment.contentType || "");
    return contentType.startsWith("image/") || IMAGE_EXT_RE.test(attachment.name || attachment.url || "");
}

function extractImageAttachments(message) {
    return [...message.attachments.values()]
        .filter(isImageAttachment)
        .slice(0, 10)
        .map(attachment => ({
            id: attachment.id,
            name: attachment.name || "screenshot",
            url: attachment.url,
            proxyUrl: attachment.proxyURL || "",
            contentType: attachment.contentType || "",
            size: attachment.size || 0
        }));
}

function displayTag(user) {
    return user.tag || user.username || user.id;
}

function safeThreadName(user) {
    const base = (user.globalName || user.username || "applicant")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 34);

    return `apply-${base || "applicant"}-${user.id.slice(-4)}`;
}

function colorToNumber(color) {
    return Number.parseInt(String(color || "#0f766e").replace("#", ""), 16);
}

function buildPanelPayload(config) {
    const recruitment = config.recruitment;
    const embed = new EmbedBuilder()
        .setTitle(recruitment.panelTitle)
        .setDescription(recruitment.panelDescription)
        .setColor(colorToNumber(recruitment.panelColor))
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(APPLY_BUTTON_ID)
            .setLabel("Apply!")
            .setStyle(ButtonStyle.Primary)
    );

    return { embeds: [embed], components: [row] };
}

async function fetchPanelMessage(channel, messageId) {
    if (!messageId || !channel.messages?.fetch) return null;

    try {
        return await channel.messages.fetch(messageId);
    } catch {
        return null;
    }
}

async function ensureRecruitmentPanel(client) {
    const config = await loadDashboardConfig();
    const recruitment = config.recruitment;

    if (!recruitment.enabled) {
        return { skipped: true, reason: "Recruitment is disabled." };
    }

    if (!recruitment.panelChannelId) {
        return { skipped: true, reason: "Recruitment panel channel is not configured." };
    }

    const channel = await client.channels.fetch(recruitment.panelChannelId).catch(() => null);
    if (!channel?.isTextBased?.() || !channel.messages?.fetch) {
        return { skipped: true, reason: "Recruitment panel channel is not text based." };
    }

    const payload = buildPanelPayload(config);
    let message = await fetchPanelMessage(channel, recruitment.panelMessageId);
    const created = !message;

    if (message?.author?.id !== client.user.id) message = null;

    if (message) {
        await message.edit(payload);
    } else {
        message = await channel.send(payload);
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
        channelId: channel.id,
        messageId: message.id
    };
}

function buildEventDecisionRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(EVENT_YES_ID)
            .setLabel("Yes")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(EVENT_NO_ID)
            .setLabel("No")
            .setStyle(ButtonStyle.Secondary)
    );
}

function buildCloseOutcomeRows() {
    const row = new ActionRowBuilder();
    for (const team of TEAM_BUTTONS) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${CLOSE_TEAM_PREFIX}${team.id}`)
                .setLabel(team.label)
                .setStyle(team.style)
        );
    }

    return [row];
}

function buildTicketControls(config) {
    const rows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(CLAIM_ID)
                .setLabel("Claim Ticket")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(CLOSE_ID)
                .setLabel("Close Ticket")
                .setStyle(ButtonStyle.Danger)
        )
    ];

    const tutorialButtons = config.recruitment.tutorials
        .filter(tutorial => tutorial.enabled)
        .slice(0, 5)
        .map(tutorial =>
            new ButtonBuilder()
                .setCustomId(`${TUTORIAL_PREFIX}${tutorial.id}`)
                .setLabel(`Send ${tutorial.label}`.slice(0, 80))
                .setStyle(ButtonStyle.Primary)
        );

    if (tutorialButtons.length) {
        rows.push(new ActionRowBuilder().addComponents(...tutorialButtons));
    }

    return rows;
}

function buildApplicationEmbeds(config, session) {
    const screenshots = [
        ...session.licenseAttachments,
        ...session.eventAttachments
    ];

    const firstScreenshot = screenshots[0];
    const links = screenshots
        .map((attachment, index) => `[${attachment.name || `Screenshot ${index + 1}`}](${attachment.url})`)
        .join("\n")
        .slice(0, 1000);

    const intro = config.recruitment.questionsIntro;
    const questions = config.recruitment.questions;
    const embed = new EmbedBuilder()
        .setTitle("Recruitment Application")
        .setDescription(`${intro}\n\n**Questions:**\n\n${questions}`)
        .setColor(colorToNumber(config.recruitment.panelColor))
        .addFields(
            { name: "Applicant", value: `<@${session.userId}>`, inline: true },
            { name: "Team Event Screenshots", value: session.eventAttachments.length ? "Provided" : "Not provided", inline: true },
            { name: "Screenshots", value: links || "No screenshots captured." }
        )
        .setTimestamp();

    if (firstScreenshot?.url) {
        embed.setImage(firstScreenshot.url);
    }

    const imageEmbeds = screenshots
        .slice(1, 9)
        .map((attachment, index) =>
            new EmbedBuilder()
                .setTitle(`Screenshot ${index + 2}`)
                .setURL(attachment.url)
                .setImage(attachment.url)
                .setColor(colorToNumber(config.recruitment.panelColor))
        );

    return [embed, ...imageEmbeds];
}

function threadTypeFor(channel, privateThreads) {
    if (channel.type === ChannelType.GuildAnnouncement) return ChannelType.AnnouncementThread;
    return privateThreads ? ChannelType.PrivateThread : ChannelType.PublicThread;
}

async function waitForImageMessage(channel, userId) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const collector = channel.createMessageCollector({
            filter: message => message.author.id === userId && !message.author.bot,
            time: SESSION_TIMEOUT_MS
        });

        collector.on("collect", async message => {
            const attachments = extractImageAttachments(message);
            if (!attachments.length) {
                const warning = await message.reply("Please upload an image file for the screenshot.").catch(() => null);
                if (warning?.deletable) {
                    setTimeout(() => warning.delete().catch(() => null), 8000);
                }
                return;
            }

            settled = true;
            collector.stop("found");
            resolve({ message, attachments });
        });

        collector.on("end", () => {
            if (!settled) reject(new Error("Timed out waiting for screenshots."));
        });
    });
}

async function collectLicense(interaction) {
    const key = sessionKey(interaction);
    const existing = activeSessions.get(key);
    if (existing) {
        await interaction.reply({
            content: "You already have an application prompt open in this channel. Please finish that upload first.",
            ephemeral: true
        });
        return;
    }

    const session = {
        key,
        userId: interaction.user.id,
        userTag: displayTag(interaction.user),
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        licenseAttachments: [],
        eventAttachments: [],
        startedAt: new Date().toISOString()
    };

    activeSessions.set(key, session);

    await interaction.reply({
        content: "Please upload an uncropped screenshot of your in-game driver's license in this channel. Make sure your coins and gems are visible too.",
        ephemeral: true
    });

    try {
        const upload = await waitForImageMessage(interaction.channel, interaction.user.id);
        session.licenseAttachments = upload.attachments;
        if (upload.message.deletable) await upload.message.delete().catch(() => null);

        await interaction.followUp({
            content: "Do you have any recent team event score screenshots with your name highlighted and the team event name visible?",
            components: [buildEventDecisionRow()],
            ephemeral: true
        });
    } catch (error) {
        activeSessions.delete(key);
        await interaction.followUp({
            content: "Application timed out because no screenshot was uploaded in time. Press **Apply!** again when you are ready.",
            ephemeral: true
        }).catch(() => null);
    }
}

async function createApplicationThread(interaction, session) {
    const config = await loadDashboardConfig();
    const channel = await interaction.client.channels.fetch(session.channelId).catch(() => null);
    if (!channel?.threads?.create) {
        throw new Error("This channel does not support threads.");
    }

    const threadType = threadTypeFor(channel, config.recruitment.privateThreads);
    const threadOptions = {
        name: safeThreadName(interaction.user),
        autoArchiveDuration: config.recruitment.threadAutoArchiveMinutes,
        type: threadType,
        reason: `Recruitment application from ${displayTag(interaction.user)}`
    };

    if (threadType === ChannelType.PrivateThread) {
        threadOptions.invitable = false;
    }

    const thread = await channel.threads.create(threadOptions);

    await thread.members.add(interaction.user.id).catch(() => null);

    const roleId = recruiterRoleId();
    const intro = roleId
        ? `<@&${roleId}> New recruitment application from <@${interaction.user.id}>.`
        : `New recruitment application from <@${interaction.user.id}>. Configure RECRUITER_ROLE_ID to ping recruiters.`;

    await thread.send({
        content: intro,
        embeds: buildApplicationEmbeds(config, session),
        components: buildTicketControls(config)
    });

    const ticket = await saveTicket({
        threadId: thread.id,
        channelId: channel.id,
        guildId: interaction.guildId,
        applicantId: interaction.user.id,
        applicantTag: displayTag(interaction.user),
        status: "open",
        claimedById: "",
        claimedByTag: "",
        licenseAttachments: session.licenseAttachments,
        eventAttachments: session.eventAttachments,
        createdAt: new Date().toISOString()
    });

    return { thread, ticket };
}

async function completeWithoutEvents(interaction) {
    const key = sessionKey(interaction);
    const session = activeSessions.get(key);
    if (!session) {
        await interaction.reply({
            content: "That application prompt expired. Press **Apply!** again when you are ready.",
            ephemeral: true
        });
        return;
    }

    await interaction.update({
        content: "Got it. Creating your application ticket now.",
        components: []
    });

    try {
        const { thread } = await createApplicationThread(interaction, session);
        activeSessions.delete(key);
        await interaction.followUp({
            content: `Your application ticket has been created: <#${thread.id}>`,
            ephemeral: true
        });
    } catch (error) {
        activeSessions.delete(key);
        await interaction.followUp({
            content: `I could not create the ticket: ${error.message}`,
            ephemeral: true
        });
    }
}

async function collectEventScreenshots(interaction) {
    const key = sessionKey(interaction);
    const session = activeSessions.get(key);
    if (!session) {
        await interaction.reply({
            content: "That application prompt expired. Press **Apply!** again when you are ready.",
            ephemeral: true
        });
        return;
    }

    await interaction.update({
        content: "Please upload the team event score screenshots in this channel. Include the highlighted name and visible team event name.",
        components: []
    });

    try {
        const upload = await waitForImageMessage(interaction.channel, interaction.user.id);
        session.eventAttachments = upload.attachments;
        if (upload.message.deletable) await upload.message.delete().catch(() => null);

        const { thread } = await createApplicationThread(interaction, session);
        activeSessions.delete(key);
        await interaction.followUp({
            content: `Your application ticket has been created: <#${thread.id}>`,
            ephemeral: true
        });
    } catch (error) {
        activeSessions.delete(key);
        await interaction.followUp({
            content: "Application timed out because no team event screenshot was uploaded in time. Press **Apply!** again when you are ready.",
            ephemeral: true
        }).catch(() => null);
    }
}

function memberCanRecruit(member) {
    if (!member) return false;
    const roleId = recruiterRoleId();
    const hasRole = roleId && member.roles?.cache?.has(roleId);
    const permissions = member.permissions;

    return Boolean(
        hasRole ||
        permissions?.has(PermissionFlagsBits.Administrator) ||
        permissions?.has(PermissionFlagsBits.ManageGuild) ||
        permissions?.has(PermissionFlagsBits.ManageThreads)
    );
}

async function requireRecruiter(interaction) {
    const member = interaction.member?.roles?.cache
        ? interaction.member
        : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

    if (memberCanRecruit(member)) return true;

    await interaction.reply({
        content: "Only recruiters can use these ticket controls.",
        ephemeral: true
    }).catch(() => null);
    return false;
}

async function claimTicket(interaction) {
    if (!(await requireRecruiter(interaction))) return;

    const ticket = await getTicket(interaction.channelId);
    if (!ticket) {
        await interaction.reply({
            content: "I could not find a ticket record for this thread.",
            ephemeral: true
        });
        return;
    }

    const updated = await updateTicket(interaction.channelId, {
        claimedById: interaction.user.id,
        claimedByTag: displayTag(interaction.user)
    });

    await interaction.channel.send(`Ticket claimed by <@${interaction.user.id}>.`);
    await interaction.reply({
        content: `Ticket claimed for ${updated.applicantTag}.`,
        ephemeral: true
    });
}

async function sendTutorial(interaction, tutorialId) {
    if (!(await requireRecruiter(interaction))) return;

    const config = await loadDashboardConfig();
    const tutorial = config.recruitment.tutorials.find(item => item.id === tutorialId && item.enabled);

    if (!tutorial) {
        await interaction.reply({
            content: "That tutorial is not configured anymore.",
            ephemeral: true
        });
        return;
    }

    if (!tutorial.videoUrl) {
        await interaction.reply({
            content: `No video has been uploaded for **${tutorial.label}** yet.`,
            ephemeral: true
        });
        return;
    }

    const ticket = await getTicket(interaction.channelId);
    const applicantMention = ticket?.applicantId ? `<@${ticket.applicantId}> ` : "";

    await interaction.channel.send({
        content: `${applicantMention}${tutorial.description || tutorial.label}\n${tutorial.videoUrl}`
    });

    await interaction.reply({
        content: `Sent **${tutorial.label}** to the ticket.`,
        ephemeral: true
    });
}

async function startClose(interaction) {
    if (!(await requireRecruiter(interaction))) return;

    await interaction.reply({
        content: "Select the final recruitment outcome for this applicant.",
        components: buildCloseOutcomeRows(),
        ephemeral: true
    });
}

function outcomeFromId(outcomeId) {
    return TEAM_BUTTONS.find(team => team.id === outcomeId) || null;
}

function attachmentLinks(ticket) {
    const attachments = [
        ...(ticket.licenseAttachments || []),
        ...(ticket.eventAttachments || [])
    ];

    return attachments
        .slice(0, 10)
        .map((attachment, index) => `[${attachment.name || `Screenshot ${index + 1}`}](${attachment.url})`)
        .join("\n");
}

async function sendRecruitmentLog(client, config, ticket, logEntry) {
    if (!config.recruitment.logChannelId) return;

    const channel = await client.channels.fetch(config.recruitment.logChannelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;

    const accepted = logEntry.outcome === "accepted";
    const embed = new EmbedBuilder()
        .setTitle(accepted ? "Recruitment Accepted" : "Recruitment Rejected")
        .setColor(accepted ? 0x147341 : 0xb42318)
        .addFields(
            { name: "Applicant", value: `<@${ticket.applicantId}> (${ticket.applicantTag || ticket.applicantId})`, inline: false },
            { name: "Closed By", value: `<@${logEntry.closedById}> (${logEntry.closedByTag})`, inline: true },
            { name: "Outcome", value: accepted ? logEntry.team : "Rejected", inline: true },
            { name: "Thread", value: `<#${ticket.threadId}>`, inline: true }
        )
        .setTimestamp(new Date(logEntry.closedAt));

    const links = attachmentLinks(ticket);
    if (links) embed.addFields({ name: "Screenshots", value: links.slice(0, 1000), inline: false });
    if (ticket.licenseAttachments?.[0]?.url) embed.setImage(ticket.licenseAttachments[0].url);

    await channel.send({ embeds: [embed] });
}

async function finishClose(interaction, outcomeId) {
    if (!(await requireRecruiter(interaction))) return;

    const outcome = outcomeFromId(outcomeId);
    if (!outcome) {
        await interaction.reply({ content: "Unknown recruitment outcome.", ephemeral: true });
        return;
    }

    const thread = interaction.channel;
    if (!thread?.isThread?.()) {
        await interaction.reply({ content: "Tickets can only be closed from inside their thread.", ephemeral: true });
        return;
    }

    const ticket = await getTicket(thread.id);
    if (!ticket) {
        await interaction.reply({
            content: "I could not find a ticket record for this thread.",
            ephemeral: true
        });
        return;
    }

    const accepted = Boolean(outcome.team);
    const closedAt = new Date().toISOString();
    const updatedTicket = await updateTicket(thread.id, {
        status: "closed",
        closedAt,
        closedById: interaction.user.id,
        closedByTag: displayTag(interaction.user),
        outcome: accepted ? "accepted" : "rejected",
        team: outcome.team
    });

    const logEntry = await appendRecruitmentLog({
        guildId: ticket.guildId,
        channelId: ticket.channelId,
        threadId: ticket.threadId,
        applicantId: ticket.applicantId,
        applicantTag: ticket.applicantTag,
        closedById: interaction.user.id,
        closedByTag: displayTag(interaction.user),
        outcome: accepted ? "accepted" : "rejected",
        team: outcome.team,
        closedAt,
        createdAt: ticket.createdAt,
        licenseAttachments: ticket.licenseAttachments || [],
        eventAttachments: ticket.eventAttachments || []
    });

    const config = await loadDashboardConfig();
    await sendRecruitmentLog(interaction.client, config, updatedTicket || ticket, logEntry).catch(error => {
        console.error("Failed to send recruitment log:", error);
    });

    const outcomeText = accepted ? `recruited to **${outcome.team}**` : "rejected";
    await thread.send(`Ticket closed by <@${interaction.user.id}>. Applicant was ${outcomeText}.`);

    await interaction.update({
        content: `Ticket closed. Outcome: ${accepted ? outcome.team : "Rejected"}.`,
        components: []
    });

    await thread.setLocked(true, "Recruitment ticket closed").catch(() => null);
    await thread.setArchived(true, "Recruitment ticket closed").catch(() => null);
}

async function handleRecruitmentInteraction(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith("recruitment:")) {
        return false;
    }

    const customId = interaction.customId;

    try {
        const config = await loadDashboardConfig();

        if (!config.recruitment.enabled && customId === APPLY_BUTTON_ID) {
            await interaction.reply({ content: "Recruitment is currently closed.", ephemeral: true });
            return true;
        }

        if (customId === APPLY_BUTTON_ID) {
            await collectLicense(interaction);
        } else if (customId === EVENT_YES_ID) {
            await collectEventScreenshots(interaction);
        } else if (customId === EVENT_NO_ID) {
            await completeWithoutEvents(interaction);
        } else if (customId === CLAIM_ID) {
            await claimTicket(interaction);
        } else if (customId === CLOSE_ID) {
            await startClose(interaction);
        } else if (customId.startsWith(TUTORIAL_PREFIX)) {
            await sendTutorial(interaction, customId.slice(TUTORIAL_PREFIX.length));
        } else if (customId.startsWith(CLOSE_TEAM_PREFIX)) {
            await finishClose(interaction, customId.slice(CLOSE_TEAM_PREFIX.length));
        }
    } catch (error) {
        console.error("Recruitment interaction failed:", error);
        const payload = { content: `Recruitment action failed: ${error.message}`, ephemeral: true };

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(payload).catch(() => null);
        } else {
            await interaction.reply(payload).catch(() => null);
        }
    }

    return true;
}

module.exports = {
    APPLY_BUTTON_ID,
    buildPanelPayload,
    ensureRecruitmentPanel,
    handleRecruitmentInteraction,
    memberCanRecruit
};
