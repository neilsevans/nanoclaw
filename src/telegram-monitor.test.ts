import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _initTestDatabase,
  setRegisteredGroup,
  storeChatMetadata,
} from './db.js';
import { startTelegramMonitor } from './telegram-monitor.js';

// Override MONITOR_INTERVAL_MS so the timer fires quickly in tests
vi.mock('./config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config.js')>();
  return { ...actual, MONITOR_INTERVAL_MS: 100 };
});

describe('startTelegramMonitor', () => {
  let stop: () => void;

  beforeEach(() => {
    _initTestDatabase();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stop?.();
    vi.useRealTimers();
  });

  it('sends an alert when an unknown Telegram chat is detected', async () => {
    // Register a main Telegram group
    setRegisteredGroup('tg:8575568489', {
      name: 'Main',
      folder: 'main',
      trigger: '@Andy',
      added_at: new Date().toISOString(),
      isMain: true,
    });

    // Store an unregistered Telegram chat in the chats table
    storeChatMetadata(
      'tg:9999999',
      new Date().toISOString(),
      'StrangerChat',
      'telegram',
      false,
    );

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    stop = startTelegramMonitor(sendMessage);

    await vi.advanceTimersByTimeAsync(150);

    expect(sendMessage).toHaveBeenCalledOnce();
    const [jid, text] = sendMessage.mock.calls[0];
    expect(jid).toBe('tg:8575568489');
    expect(text).toContain('tg:9999999');
    expect(text).toContain('StrangerChat');
  });

  it('does not send an alert when all Telegram chats are registered', async () => {
    // Register a main Telegram group
    setRegisteredGroup('tg:8575568489', {
      name: 'Main',
      folder: 'main',
      trigger: '@Andy',
      added_at: new Date().toISOString(),
      isMain: true,
    });

    // Store the same chat as registered
    storeChatMetadata(
      'tg:8575568489',
      new Date().toISOString(),
      'Main',
      'telegram',
      true,
    );

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    stop = startTelegramMonitor(sendMessage);

    await vi.advanceTimersByTimeAsync(150);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('deduplicates alerts — same unknown chat only alerted once per run', async () => {
    setRegisteredGroup('tg:8575568489', {
      name: 'Main',
      folder: 'main',
      trigger: '@Andy',
      added_at: new Date().toISOString(),
      isMain: true,
    });

    storeChatMetadata(
      'tg:9999999',
      new Date().toISOString(),
      'StrangerChat',
      'telegram',
      false,
    );

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    stop = startTelegramMonitor(sendMessage);

    // Advance through two poll cycles
    await vi.advanceTimersByTimeAsync(250);

    // Should only have been called once despite two poll cycles
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});
