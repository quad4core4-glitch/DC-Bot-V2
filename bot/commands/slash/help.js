const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const { loadDashboardConfig } = require("../../utils/dashboardConfig");
const { getDashboardUrl } = require("../../utils/serverConfig");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription("Show useful bot commands and dashboard links."),

    async execute(interaction) {
        const config = await loadDashboardConfig();
        const dashboardUrl = getDashboardUrl(config);

        const embed = new EmbedBuilder()
            .setTitle("DCA Bot Help")
            .setColor(0x37d6a7)
            .addFields(
                {
                    name: "Recruitment",
                    value: "`/tickets status`, `/tickets close`, `/tickets claim`, `/invite`"
                },
                {
                    name: "Teams",
                    value: "`/membercount set`, `/membercount sync`, `/updatecount`"
                },
                {
                    name: "Moderation",
                    value: "`/ban`, `/snap`, `/roles`"
                },
                {
                    name: "Dashboard",
                    value: dashboardUrl || "Dashboard URL is not configured."
                }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
