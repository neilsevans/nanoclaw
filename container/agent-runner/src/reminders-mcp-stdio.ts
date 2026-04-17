/**
 * Reminders MCP Server for NanoClaw
 * Exposes reminder/todo management as tools for the container agent.
 * Wraps the reminder API at http://host.containers.internal:3457
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const REMINDER_API = 'http://host.containers.internal:3457';

function log(msg: string): void {
  console.error(`[REMINDERS] ${msg}`);
}

async function apiFetch(path: string, method = 'GET', body?: any) {
  const url = `${REMINDER_API}${path}`;
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error ${response.status}: ${text}`);
    }

    return await response.json();
  } catch (err) {
    log(`API call failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

const server = new McpServer({
  name: 'reminders',
  version: '1.0.0',
});

// Extract chat_jid from environment (set by container-runner)
const chatJid = process.env.NANOCLAW_CHAT_JID || 'unknown';

// Create a reminder
server.tool(
  'create_reminder',
  'Create a reminder at a specific time. Format: "text" at "2026-04-18T14:30:00Z" [recur: daily|weekly|monthly]',
  {},
  async (args: any) => {
    try {
      const text = args.text || args[0];
      const due_at = args.due_at || args[1];
      const recurrence = args.recurrence || args[2];

      if (!text || !due_at) {
        return {
          content: [{ type: 'text' as const, text: 'Error: need text and due_at (ISO 8601 datetime)' }],
          isError: true,
        };
      }

      await apiFetch('/reminders', 'POST', {
        chat_jid: chatJid,
        text,
        due_at,
        recurrence: recurrence || null,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Reminder created: "${text}" at ${due_at}${recurrence ? ` (recurring ${recurrence})` : ''}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to create reminder: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Create a todo
server.tool(
  'create_todo',
  'Create a todo item. Format: "text" [priority: low|normal|high] [due_date: YYYY-MM-DD]',
  {},
  async (args: any) => {
    try {
      const text = args.text || args[0];
      const priority = args.priority || args[1] || 'normal';
      const due_date = args.due_date || args[2];

      if (!text) {
        return {
          content: [{ type: 'text' as const, text: 'Error: need todo text' }],
          isError: true,
        };
      }

      await apiFetch('/todos', 'POST', {
        chat_jid: chatJid,
        text,
        priority,
        due_date: due_date || null,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Todo created: "${text}"${due_date ? ` due ${due_date}` : ''}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to create todo: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// List reminders and todos
server.tool(
  'list_items',
  'List all open reminders and todos',
  {},
  async () => {
    try {
      const items = await apiFetch(`/items?chat_jid=${encodeURIComponent(chatJid)}`);

      if (!items.reminders?.length && !items.todos?.length) {
        return {
          content: [
            {
              type: 'text' as const,
              text: "You're all clear — no reminders or todos on your list.",
            },
          ],
        };
      }

      let text = '';

      if (items.reminders?.length) {
        text += '*Reminders:*\n';
        for (const r of items.reminders) {
          text += `• ${r.text} at ${new Date(r.due_at).toLocaleString('en-GB', { timeZone: 'Europe/London' })}${r.recurrence ? ` (${r.recurrence})` : ''}\n`;
        }
        text += '\n';
      }

      if (items.todos?.length) {
        text += '*Todos:*\n';
        const priorityEmoji = { low: '🟢', normal: '🟡', high: '🔴' };
        for (const t of items.todos) {
          const emoji = priorityEmoji[t.priority as keyof typeof priorityEmoji] || '⚪';
          text += `${emoji} ${t.text}${t.due_date ? ` (due ${t.due_date})` : ''}\n`;
        }
      }

      return {
        content: [{ type: 'text' as const, text }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to list items: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

const transport = new StdioServerTransport();
server.connect(transport);
log('Server started');
