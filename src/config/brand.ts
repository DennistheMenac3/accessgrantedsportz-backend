// =============================================
// ACCESSGRANTEDSPORTZ — Brand Configuration
// Deep Navy + Cyber Orange color system
// =============================================

export const COLORS = {
  // Primary brand colors
  NAVY:    0x1e3a5f,  // Deep Navy — trust, authority
  ORANGE:  0xff6b00,  // Cyber Orange — action, urgency
  GOLD:    0xffd700,  // VIP Gold — premium, elite

  // Semantic colors
  SUCCESS: 0x00c851,  // Green — fair trade, win
  WARNING: 0xff8800,  // Amber — slightly uneven
  DANGER:  0xff4444,  // Red — lopsided, alert
  DARK:    0x0a1628,  // Deep dark navy — backgrounds

  // Trade verdict colors
  FAIR:           0x00c851,
  SLIGHTLY_UNEVEN:0xff8800,
  UNEVEN:         0xff6b00,
  LOPSIDED:       0xff4444,
  HIGHWAY_ROBBERY:0x8b0000
};

export const FOOTER = {
  text:    'AccessGrantedSportz | Access Granted. Game On.',
  iconURL: 'https://i.imgur.com/placeholder.png' // Replace with your logo URL
};

export const BRAND = {
  name:    'AccessGrantedSportz',
  tagline: 'Access Granted. Game On.',
  version: '1.0.0'
};

// =============================================
// EMBED BUILDER HELPERS
// Consistent formatting across all commands
// =============================================
import { EmbedBuilder } from 'discord.js';

export const createEmbed = (color: number = COLORS.NAVY): EmbedBuilder => {
  return new EmbedBuilder()
    .setColor(color)
    .setFooter({
      text: FOOTER.text
    })
    .setTimestamp();
};

export const createSuccessEmbed = (title: string, description?: string) => {
  return createEmbed(COLORS.SUCCESS)
    .setTitle(`✅ ${title}`)
    .setDescription(description || '');
};

export const createErrorEmbed = (message: string) => {
  return createEmbed(COLORS.DANGER)
    .setTitle('❌ Error')
    .setDescription(message);
};

export const createTradeEmbed = (absDiff: number) => {
  const color =
    absDiff <= 10  ? COLORS.FAIR            :
    absDiff <= 25  ? COLORS.SLIGHTLY_UNEVEN :
    absDiff <= 50  ? COLORS.UNEVEN          :
    absDiff <= 100 ? COLORS.LOPSIDED        :
    COLORS.HIGHWAY_ROBBERY;

  return createEmbed(color);
};

export const createPremiumEmbed = (title: string, description?: string) => {
  return createEmbed(COLORS.GOLD)
    .setTitle(`🏆 ${title}`)
    .setDescription(description || '');
};