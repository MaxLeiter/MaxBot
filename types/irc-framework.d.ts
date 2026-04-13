declare module "irc-framework" {
  import { EventEmitter } from "events";

  interface ClientOptions {
    nick?: string;
    username?: string;
    gecos?: string;
    encoding?: string;
    version?: string;
    auto_reconnect?: boolean;
    auto_reconnect_max_wait?: number;
    auto_reconnect_max_retries?: number;
    ping_interval?: number;
    ping_timeout?: number;
    message_max_length?: number;
    sasl_disconnect_on_fail?: boolean;
  }

  interface ConnectOptions {
    host: string;
    port?: number;
    tls?: boolean;
    nick?: string;
    password?: string;
    account?: {
      account: string;
      password: string;
    };
  }

  interface MessageEvent {
    nick: string;
    ident: string;
    hostname: string;
    target: string;
    message: string;
    tags: Record<string, string>;
    time?: Date;
    account?: string;
    group?: string;
    type?: "privmsg" | "notice" | "action";
    from_server?: boolean;
    reply: (message: string) => void;
  }

  interface JoinEvent {
    nick: string;
    ident: string;
    hostname: string;
    channel: string;
    account?: string;
    gecos?: string;
    time?: Date;
  }

  interface PartEvent {
    nick: string;
    ident: string;
    hostname: string;
    channel: string;
    message?: string;
    time?: Date;
  }

  interface RegisteredEvent {
    nick: string;
  }

  interface UserListEvent {
    channel: string;
    users: Array<{
      nick: string;
      ident: string;
      hostname: string;
      modes: string[];
    }>;
  }

  interface ChannelObject {
    name: string;
    users: Array<{ nick: string; modes: string[] }>;
    say(message: string): void;
    notice(message: string): void;
    join(key?: string): void;
    part(message?: string): void;
    updateUsers(callback: () => void): void;
  }

  interface UserInfo {
    nick: string;
    username: string;
    gecos: string;
    host: string;
    away: string;
    modes: string[];
  }

  class Client extends EventEmitter {
    constructor(options?: ClientOptions);

    user: UserInfo;
    connected: boolean;

    connect(options: ConnectOptions): void;
    quit(message?: string): void;

    say(target: string, message: string, tags?: Record<string, string>): void;
    notice(target: string, message: string): void;
    action(target: string, message: string): void;
    tagmsg(target: string, tags: Record<string, string>): void;

    requestCap(cap: string | string[]): void;
    request_extra_caps: string[];

    join(channel: string, key?: string): void;
    part(channel: string, message?: string): void;

    changeNick(nick: string): void;
    whois(nick: string, callback?: (event: any) => void): void;
    who(target: string, callback?: (event: any) => void): void;

    channel(name: string): ChannelObject;

    raw(...args: string[]): void;
    rawString(...args: string[]): string;

    ctcpRequest(nick: string, type: string, ...params: string[]): void;
    ctcpResponse(nick: string, type: string, ...params: string[]): void;

    match(regex: RegExp, callback: (event: MessageEvent) => void): void;
    matchMessage(regex: RegExp, callback: (event: MessageEvent) => void): void;
    matchNotice(regex: RegExp, callback: (event: MessageEvent) => void): void;
    matchAction(regex: RegExp, callback: (event: MessageEvent) => void): void;

    use(middleware: (client: Client, rawEvents: any, parsedEvents: any) => void): void;

    on(event: "registered", listener: (event: RegisteredEvent) => void): this;
    on(event: "connected", listener: (event: RegisteredEvent) => void): this;
    on(event: "privmsg", listener: (event: MessageEvent) => void): this;
    on(event: "notice", listener: (event: MessageEvent) => void): this;
    on(event: "action", listener: (event: MessageEvent) => void): this;
    on(event: "message", listener: (event: MessageEvent) => void): this;
    on(event: "join", listener: (event: JoinEvent) => void): this;
    on(event: "part", listener: (event: PartEvent) => void): this;
    on(event: "userlist", listener: (event: UserListEvent) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "reconnecting", listener: () => void): this;
    on(event: "socket connected", listener: () => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export { Client, MessageEvent, ClientOptions, ConnectOptions };
  export default Client;
}
