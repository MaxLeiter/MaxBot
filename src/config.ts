export interface Config {
  irc: {
    host: string;
    port: number;
    tls: boolean;
    nick: string;
    username: string;
    nickservPassword?: string;
  };
  claude: {
    maxTurns: number;
    baseUrl?: string;
    authToken?: string;
  };
}

export function loadConfig(): Config {
  const env = (name: string, fallback?: string): string => {
    const val = process.env[name];
    if (!val && fallback === undefined)
      throw new Error(`Missing required env var: ${name}`);
    return val || fallback!;
  };

  return {
    irc: {
      host: env("IRC_HOST", "irc.libera.chat"),
      port: parseInt(env("IRC_PORT", "6697")),
      tls: env("IRC_TLS", "true") === "true",
      nick: env("IRC_NICK", "MaxBot"),
      username: env("IRC_USERNAME", "maxbot"),
      nickservPassword: env("IRC_NICKSERV_PASSWORD"),
    },
    claude: {
      maxTurns: parseInt(env("CLAUDE_MAX_TURNS", "25")),
      baseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
      authToken: process.env.ANTHROPIC_AUTH_TOKEN || undefined,
    },
  };
}
