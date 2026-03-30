/**
 * Ollama API Proxy - Translates Claude API calls to Ollama format
 * Allows Claude Code to use local Ollama models without modification
 *
 * Maps:
 *   POST /v1/messages (Claude format) -> POST /api/generate (Ollama format)
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { request as httpRequest } from 'http';
import { logger } from './logger.js';

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string }>;
}

interface ClaudeRequest {
  model: string;
  max_tokens?: number;
  messages: ClaudeMessage[];
}

interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{ type: 'text'; text: string }>;
  stop_reason: 'end_turn' | 'max_tokens';
  usage?: { input_tokens: number; output_tokens: number };
}

export function startOllamaProxy(
  port: number,
  ollamaHost: string,
  ollamaModel: string,
  host = '127.0.0.1',
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
          return;
        }

        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('error', (err) => {
          logger.error({ err }, 'Ollama proxy: request error');
          res.writeHead(500);
          res.end();
        });

        req.on('end', async () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            const claudeReq: ClaudeRequest = JSON.parse(body);

            // Extract the last user message
            const userMessages = claudeReq.messages.filter(
              (m) => m.role === 'user',
            );
            if (userMessages.length === 0) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'No user messages' }));
              return;
            }

            // Handle both string and array content (Claude SDK can send either)
            let prompt = '';
            const lastMsg = userMessages[userMessages.length - 1];
            if (typeof lastMsg.content === 'string') {
              prompt = lastMsg.content;
            } else if (Array.isArray(lastMsg.content)) {
              // Flatten array of content blocks (text, images, etc.) to text
              prompt = (lastMsg.content as any[])
                .filter((c) => c.type === 'text')
                .map((c) => c.text || '')
                .join('\n');
            }

            if (!prompt.trim()) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Empty prompt' }));
              return;
            }

            // Call Ollama
            const ollamaReq = {
              model: ollamaModel,
              prompt,
              stream: false,
            };

            logger.info(
              { model: ollamaModel, promptLen: prompt.length },
              'Ollama proxy: forwarding request',
            );

            const ollamaRes = await new Promise<string>((resolve, reject) => {
              const url = new URL(ollamaHost);
              const options = {
                hostname: url.hostname,
                port: url.port,
                path: '/api/generate',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(
                    JSON.stringify(ollamaReq),
                  ),
                },
              };

              const ollamaRequest = httpRequest(options, (ollamaResponse) => {
                const chunks: Buffer[] = [];
                ollamaResponse.on('data', (c) => chunks.push(c));
                ollamaResponse.on('end', () => {
                  resolve(Buffer.concat(chunks).toString('utf-8'));
                });
              });

              ollamaRequest.on('error', reject);
              ollamaRequest.write(JSON.stringify(ollamaReq));
              ollamaRequest.end();
            });

            let ollamaData: any;
            try {
              ollamaData = JSON.parse(ollamaRes);
            } catch (parseErr) {
              logger.error(
                { parseErr, ollamaRes: ollamaRes.slice(0, 200) },
                'Ollama proxy: failed to parse Ollama response',
              );
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({ error: 'Failed to parse Ollama response' }),
              );
              return;
            }

            const responseText = (ollamaData?.response || '').trim();
            if (!responseText) {
              logger.warn(
                { ollamaData },
                'Ollama proxy: empty response from Ollama',
              );
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Empty response from Ollama' }));
              return;
            }

            // Construct Claude-format response
            const claudeResp: ClaudeResponse = {
              id: `msg_${Date.now()}`,
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: responseText }],
              stop_reason: 'end_turn',
              usage: {
                input_tokens: prompt.split(/\s+/).length,
                output_tokens: responseText.split(/\s+/).length,
              },
            };

            logger.info(
              {
                responseLen: responseText.length,
                duration: ollamaData.total_duration,
              },
              'Ollama proxy: response sent',
            );

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(claudeResp));
          } catch (err) {
            logger.error({ err }, 'Ollama proxy: error processing request');
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        });
      },
    );

    server.listen(port, host, () => {
      logger.info(
        { port, host, ollamaHost, ollamaModel },
        'Ollama proxy started',
      );
      resolve(server);
    });

    server.on('error', reject);
  });
}
