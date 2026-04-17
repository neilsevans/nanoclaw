/**
 * Weather MCP Server for NanoClaw
 * Exposes weather queries as tools for the container agent.
 * Wraps the weather service at http://host.containers.internal:3458
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const WEATHER_API = 'http://host.containers.internal:3458';

function log(msg: string): void {
  console.error(`[WEATHER] ${msg}`);
}

async function fetchWeather(location: string) {
  const url = `${WEATHER_API}/weather?location=${encodeURIComponent(location)}`;
  try {
    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Weather service error ${response.status}: ${text}`);
    }

    return await response.json();
  } catch (err) {
    log(`Weather API call failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

const server = new McpServer({
  name: 'weather',
  version: '1.0.0',
});

// Get current weather
server.tool(
  'get_weather',
  'Get current weather and forecast for a location. Example: "get_weather London" or "London"',
  {},
  async (args: any) => {
    try {
      const location = args.location || args[0] || '';

      if (!location) {
        return {
          content: [{ type: 'text' as const, text: 'Error: need a location (city name)' }],
          isError: true,
        };
      }

      const weather = await fetchWeather(location);
      const current = weather.current;
      const forecast = weather.forecast.today;

      let text = `*Weather for ${weather.location.name}, ${weather.location.country}*\n\n`;

      text += `*Current:*\n`;
      text += `• Temperature: ${current.temperature_c}°C (feels like ${current.feels_like_c}°C)\n`;
      text += `• Condition: ${current.condition}\n`;
      text += `• Humidity: ${current.humidity}%\n`;
      text += `• Wind: ${current.wind_speed_kmph} km/h\n`;
      text += `• Visibility: ${current.visibility_km} km\n`;
      text += `• UV Index: ${current.uv_index}\n\n`;

      if (forecast) {
        text += `*Today's Forecast:*\n`;
        text += `• High: ${forecast.max_temp_c}°C / Low: ${forecast.min_temp_c}°C\n`;
        text += `• Condition: ${forecast.condition}\n`;
        text += `• Chance of rain: ${forecast.chance_of_rain}%\n`;
        text += `• Chance of snow: ${forecast.chance_of_snow}%\n`;

        if (forecast.hourly_samples?.length) {
          text += `\n*Hourly samples:*\n`;
          for (const hour of forecast.hourly_samples) {
            const time = new Date(`2000-01-01T${hour.time}`).toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
            });
            text += `• ${time}: ${hour.temp_c}°C, ${hour.condition} (${hour.wind_kmph} km/h wind)\n`;
          }
        }
      }

      text += `\n_Data cached; refresh in 1 hour_`;

      return {
        content: [{ type: 'text' as const, text }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Could not get weather: ${err instanceof Error ? err.message : String(err)}`,
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
