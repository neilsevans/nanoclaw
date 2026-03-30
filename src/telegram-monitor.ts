import { MONITOR_INTERVAL_MS } from './config.js';
import { getAllRegisteredGroups, getUnknownTelegramChats } from './db.js';
import { logger } from './logger.js';

/**
 * Zero-cost Telegram unknown sender monitor.
 *
 * Polls the database every MONITOR_INTERVAL_MS milliseconds and sends a
 * Telegram alert to the main registered chat when an unknown Telegram chat
 * is detected. Makes no API calls to Anthropic or Ollama.
 *
 * Returns a stop function that clears the interval on shutdown.
 */
export function startTelegramMonitor(
  sendMessage: (jid: string, text: string) => Promise<void>,
): () => void {
  const alerted = new Set<string>();

  async function poll(): Promise<void> {
    let unknownChats: ReturnType<typeof getUnknownTelegramChats>;
    try {
      unknownChats = getUnknownTelegramChats();
    } catch (err) {
      logger.error({ err }, 'telegram-monitor: DB error during poll');
      return;
    }

    if (unknownChats.length === 0) return;

    const groups = getAllRegisteredGroups();
    const mainEntry = Object.entries(groups).find(
      ([jid, g]) => g.isMain === true && jid.startsWith('tg:'),
    );
    if (!mainEntry) {
      logger.warn(
        'telegram-monitor: no main Telegram group registered, cannot send alert',
      );
      return;
    }
    const mainJid = mainEntry[0];

    for (const chat of unknownChats) {
      if (alerted.has(chat.jid)) continue;

      const text = [
        '\u26a0\ufe0f Unknown Telegram sender detected:',
        `Chat JID: ${chat.jid}`,
        `Name: ${chat.name || '(unknown)'}`,
        `First seen: ${chat.last_message_time}`,
      ].join('\n');

      try {
        await sendMessage(mainJid, text);
        alerted.add(chat.jid);
        logger.info({ chatJid: chat.jid }, 'telegram-monitor: alert sent');
      } catch (err) {
        logger.error(
          { err, chatJid: chat.jid },
          'telegram-monitor: failed to send alert, will retry next poll',
        );
      }
    }
  }

  const interval = setInterval(() => {
    poll().catch((err) =>
      logger.error({ err }, 'telegram-monitor: unexpected poll error'),
    );
  }, MONITOR_INTERVAL_MS);

  logger.info({ intervalMs: MONITOR_INTERVAL_MS }, 'Telegram monitor started');

  return () => {
    clearInterval(interval);
    logger.info('Telegram monitor stopped');
  };
}
