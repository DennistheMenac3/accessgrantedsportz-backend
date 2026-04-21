import { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChatInputCommandInteraction // Use this instead of CommandInteraction
} from 'discord.js';
import { query } from '../../config/database';
import { v4 as uuidv4 } from 'uuid';

export const data = new SlashCommandBuilder()
    .setName('trade')
    .setDescription('AccessGranted Trade Engine')
    .addSubcommand(sub =>
        sub.setName('propose')
            .setDescription('Propose a trade to another team')
            .addUserOption(opt => opt.setName('partner').setDescription('The user you are trading with').setRequired(true))
            .addStringOption(opt => opt.setName('giving').setDescription('Names of players you are sending (comma separated)').setRequired(true))
            .addStringOption(opt => opt.setName('receiving').setDescription('Names of players you are receiving (comma separated)').setRequired(true))
    );

export const execute = async (interaction: ChatInputCommandInteraction) => {
    const sub = interaction.options.getSubcommand();

    if (sub === 'propose') {
        const partnerUser = interaction.options.getUser('partner');
        const givingNames = interaction.options.getString('giving');
        const receivingNames = interaction.options.getString('receiving');

        // 1. Fetch team IDs for both users
        const proposerTeam = await query(`SELECT id, name FROM teams WHERE owner_id = $1`, [interaction.user.id]);
        const partnerTeam = await query(`SELECT id, name FROM teams WHERE owner_id = $1`, [partnerUser?.id]);

        if (!proposerTeam.rows[0] || !partnerTeam.rows[0]) {
            return interaction.reply({ 
                content: "❌ One of the users in this trade does not own a team or hasn't linked their Discord.", 
                ephemeral: true 
            });
        }

        const tradeId = uuidv4();

        // 2. Build the Commissioner Review Embed
        const tradeEmbed = new EmbedBuilder()
            .setTitle('New Trade Proposal')
            .setColor('#f1c40f')
            .addFields(
                { name: `${proposerTeam.rows[0].name} Sends`, value: givingNames || 'N/A', inline: true },
                { name: `${partnerTeam.rows[0].name} Sends`, value: receivingNames || 'N/A', inline: true },
                { name: 'Status', value: '⏳ Pending Commissioner Approval' }
            )
            .setFooter({ text: `Trade ID: ${tradeId}` });

        // 3. Approval Buttons
        const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`approve_trade_${tradeId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`deny_trade_${tradeId}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        // 4. Save to DB
        await query(
            `INSERT INTO trades (id, proposer_team_id, partner_team_id, status) VALUES ($1, $2, $3, $4)`,
            [tradeId, proposerTeam.rows[0].id, partnerTeam.rows[0].id, 'pending']
        );

        // 5. Success Message
        await interaction.reply({ content: `✅ Trade proposal sent to the commissioner!`, ephemeral: true });
        
        // Send to your commish-log channel
        const logChannel = interaction.guild?.channels.cache.find(c => c.name === 'commish-log') as any;
        if (logChannel) {
            await logChannel.send({ embeds: [tradeEmbed], components: [buttons] });
        }
    }
};