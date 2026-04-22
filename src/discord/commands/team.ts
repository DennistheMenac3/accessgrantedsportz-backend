import { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChatInputCommandInteraction 
} from 'discord.js';
import { query } from '../../config/database';

export const data = new SlashCommandBuilder()
    .setName('team')
    .setDescription('View a comprehensive team dashboard, stats, and full roster.')
    .addStringOption(opt => 
        opt.setName('name')
           .setDescription('Team Name, City, or Abbreviation (e.g., Ravens, BAL, or Baltimore)')
           .setRequired(true)
    );

export const execute = async (interaction: ChatInputCommandInteraction) => {
    // 1. BUY TIME! Tell Discord we are thinking...
    await interaction.deferReply();

    // 2. Fluid Search Preparation
    const searchParam = interaction.options.getString('name')?.trim().toLowerCase();

    const teamRes = await query(
        `SELECT id, name, city, abbreviation, overall_rating, team_logo_url FROM teams 
         WHERE LOWER(name) LIKE '%' || $1 || '%' 
         OR LOWER(abbreviation) LIKE '%' || $1 || '%' 
         OR LOWER(city) LIKE '%' || $1 || '%'
         OR LOWER(city || ' ' || name) LIKE '%' || $1 || '%'
         LIMIT 1`,
        [searchParam]
    );

    if (teamRes.rows.length === 0) {
        return interaction.editReply({ content: `❌ Could not find a team matching **"${searchParam}"**. Try a different abbreviation or city name.` });
    }

    const team = teamRes.rows[0];

    // 3. Fetch the Full Roster with TVS
    const rosterRes = await query(
        `SELECT p.first_name, p.last_name, p.position, p.overall_rating, p.age, p.speed, tvh.total_value 
         FROM players p
         LEFT JOIN trade_value_history tvh ON p.id = tvh.player_id
         WHERE p.team_id = $1 
         ORDER BY p.overall_rating DESC`,
        [team.id]
    );

    const players = rosterRes.rows;

    // 4. Fetch Season Stats / Games
    const gamesRes = await query(
        `SELECT home_team_id, away_team_id, home_score, away_score 
         FROM games WHERE home_team_id = $1 OR away_team_id = $1`,
        [team.id]
    );

    let wins = 0, losses = 0, ties = 0, pointsFor = 0, pointsAgainst = 0;
    gamesRes.rows.forEach(game => {
        const isHome = game.home_team_id === team.id;
        const pf = isHome ? game.home_score : game.away_score;
        const pa = isHome ? game.away_score : game.home_score;
        
        pointsFor += pf;
        pointsAgainst += pa;

        if (pf > pa) wins++;
        else if (pf < pa) losses++;
        else ties++;
    });

    const totalTVS = players.reduce((sum, p) => sum + (parseFloat(p.total_value) || 0), 0);

    const currentPage = 0; 
    const totalRosterPages = Math.ceil(players.length / 10);

    const embed = buildTeamDashboardEmbed(team, players, wins, losses, ties, pointsFor, pointsAgainst, totalTVS);
    const buttons = buildTeamButtons(team.id, currentPage, totalRosterPages);

    // Make sure to use editReply here!
    await interaction.editReply({ embeds: [embed], components: [buttons] });
};

// =============================================
// HELPER: DASHBOARD VIEW (PAGE 0)
// =============================================
export const buildTeamDashboardEmbed = (
    team: any, players: any[], w: number, l: number, t: number, pf: number, pa: number, totalTVS: number
) => {
    // Dynamically calculate Team OVR based on the top 53 players
    const top53 = players.slice(0, 53);
    const dynamicOvr = top53.length > 0 
        ? Math.round(top53.reduce((sum, p) => sum + p.overall_rating, 0) / top53.length) 
        : team.overall_rating;

    const recordStr = t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
    
    const topPlayers = players.slice(0, 5).map(p => {
        const tvs = p.total_value ? parseFloat(p.total_value).toFixed(1) : '0.0';
        return `**${p.position}** ${p.first_name} ${p.last_name} | OVR: ${p.overall_rating} | TVS: ${tvs}`;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`🏈 ${team.city} ${team.name} (${team.abbreviation})`)
        .setColor('#2c3e50')
        .addFields(
            { name: '📊 Overview', value: `**OVR:** ${dynamicOvr}\n**Record:** ${recordStr}\n**Net Pts:** ${pf} PF / ${pa} PA`, inline: true },
            { name: '💰 Franchise Value', value: `**Total TVS:** ${totalTVS.toFixed(1)}\n**Roster Size:** ${players.length}/53`, inline: true },
            { name: '⭐ Top Players', value: topPlayers || 'No players found.', inline: false }
        )
        .setFooter({ text: 'AccessGrantedSportz Analytics Engine | OVR is dynamically calculated' });

    if (team.team_logo_url) {
        embed.setThumbnail(team.team_logo_url);
    }

    return embed;
};

// =============================================
// HELPER: ROSTER VIEW (PAGE 1+)
// =============================================
export const buildRosterEmbed = (team: any, players: any[], page: number, totalPages: number) => {
    const start = (page - 1) * 10;
    const slice = players.slice(start, start + 10);

    let rosterText = '';
    slice.forEach(p => {
        const tvs = p.total_value ? parseFloat(p.total_value).toFixed(1) : '0.0';
        rosterText += `**${p.position}** ${p.first_name} ${p.last_name} | **OVR:** ${p.overall_rating} | **SPD:** ${p.speed} | **TVS:** ${tvs}\n`;
    });

    const embed = new EmbedBuilder()
        .setTitle(`📋 ${team.city} ${team.name} | Roster`)
        .setDescription(rosterText)
        .setColor('#3498db')
        .setFooter({ text: `Page ${page} of ${totalPages} | ${players.length} Total Players` });

    // Inject Logo if it exists
    if (team.team_logo_url) {
        embed.setThumbnail(team.team_logo_url);
    }

    return embed;
};

// =============================================
// HELPER: NAVIGATION BUTTONS
// =============================================
export const buildTeamButtons = (teamId: string, page: number, totalPages: number) => {
    const row = new ActionRowBuilder<ButtonBuilder>();

    row.addComponents(
        new ButtonBuilder()
            // If on page 0, give it a dead ID. Otherwise, point to the previous page.
            .setCustomId(page === 0 ? `teamview_${teamId}_dead` : `teamview_${teamId}_${page - 1}`)
            // Dynamically rename the Back button if returning to the dashboard
            .setLabel(page === 1 ? '📊 Dashboard' : '◀ Prev')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === 0), // Disabled on the dashboard
            
        new ButtonBuilder()
            .setCustomId(`teamview_${teamId}_${page + 1}`)
            .setLabel(page === 0 ? 'View Full Roster ▶' : 'Next ▶')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page >= totalPages || totalPages === 0)
    );

    return row;
};