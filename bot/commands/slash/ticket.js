const {
    ChannelType,
    PermissionFlagsBits,
    SlashCommandBuilder
} = require("discord.js");
const { loadDashboardConfig, saveDashboardConfig } = require("../../utils/dashboardConfig");
const { ensureRecruitmentPanel } = require("../../utils/recruitmentManager");
const { listRecruitmentLogs } = require("../../utils/recruitmentStore");

function optionalText(interaction, name, fallback) {
    const value = interaction.options.getString(name);
    return value === null ? fallback : value;
}

function formatSync(sync) {
    if (sync.skipped) return `Saved, but panel sync was skipped: ${sync.reason}`;
    return `Recruitment panel ${sync.created ? "created" : "synced"} in <#${sync.channelId}>.`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("tickets")
        .setDescription("Manage the recruitment ticket system")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName("setup")
                .setDescription("Configure and post the recruitment Apply panel")
                .addChannelOption(option =>
                    option
                        .setName("channel")
                        .setDescription("Channel where the Apply panel should be posted")
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true)
                )
                .addChannelOption(option =>
                    option
                        .setName("log_channel")
                        .setDescription("Channel where recruitment close logs should be sent")
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName("title")
                        .setDescription("Panel embed title")
                        .setMaxLength(120)
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName("description")
                        .setDescription("Panel embed body")
                        .setMaxLength(2000)
                        .setRequired(false)
                )
                .addBooleanOption(option =>
                    option
                        .setName("private_threads")
                        .setDescription("Create private application threads when possible")
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("sync-panel")
                .setDescription("Refresh the recruitment Apply panel from saved settings")
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("status")
                .setDescription("Show current recruitment ticket settings")
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("logs")
                .setDescription("Show recent recruitment outcomes")
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        await interaction.deferReply({ ephemeral: true });

        if (subcommand === "setup") {
            const config = await loadDashboardConfig();
            const channel = interaction.options.getChannel("channel", true);
            const logChannel = interaction.options.getChannel("log_channel", false);
            const privateThreads = interaction.options.getBoolean("private_threads");

            const nextRecruitment = {
                ...config.recruitment,
                enabled: true,
                panelChannelId: channel.id,
                panelTitle: optionalText(interaction, "title", config.recruitment.panelTitle),
                panelDescription: optionalText(interaction, "description", config.recruitment.panelDescription),
                logChannelId: logChannel?.id || config.recruitment.logChannelId,
                privateThreads: privateThreads === null ? config.recruitment.privateThreads : privateThreads
            };

            await saveDashboardConfig({ ...config, recruitment: nextRecruitment });
            const sync = await ensureRecruitmentPanel(interaction.client);
            await interaction.editReply(formatSync(sync));
            return;
        }

        if (subcommand === "sync-panel") {
            const sync = await ensureRecruitmentPanel(interaction.client);
            await interaction.editReply(formatSync(sync));
            return;
        }

        if (subcommand === "status") {
            const { recruitment } = await loadDashboardConfig();
            await interaction.editReply([
                `Enabled: **${recruitment.enabled ? "yes" : "no"}**`,
                `Panel Channel: ${recruitment.panelChannelId ? `<#${recruitment.panelChannelId}>` : "not set"}`,
                `Panel Message: ${recruitment.panelMessageId || "not set"}`,
                `Log Channel: ${recruitment.logChannelId ? `<#${recruitment.logChannelId}>` : "not set"}`,
                `Private Threads: **${recruitment.privateThreads ? "yes" : "no"}**`,
                `Recruiter Role: ${process.env.RECRUITER_ROLE_ID ? `<@&${process.env.RECRUITER_ROLE_ID}>` : "RECRUITER_ROLE_ID is not set"}`
            ].join("\n"));
            return;
        }

        if (subcommand === "logs") {
            const logs = await listRecruitmentLogs(10);
            if (!logs.length) {
                await interaction.editReply("No recruitment logs yet.");
                return;
            }

            await interaction.editReply(logs.map(log => {
                const outcome = log.outcome === "accepted" ? log.team : "Rejected";
                return `**${outcome}** - <@${log.applicantId}> closed by <@${log.closedById}> on ${new Date(log.closedAt).toLocaleString()}`;
            }).join("\n"));
        }
    }
};
