#!/bin/bash
set -e

# MaxBot setup script for a fresh Ubuntu droplet
# Usage: ssh root@your-droplet 'bash -s' < deploy/setup.sh

echo "=== Installing bun ==="
apt-get update -qq && apt-get install -y -qq git unzip
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

echo "=== Installing Node.js 22 (required by Claude Code) ==="
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs

echo "=== Installing Claude Code CLI ==="
npm install -g @anthropic-ai/claude-code

echo "=== Creating maxbot user ==="
id -u maxbot &>/dev/null || useradd -m -s /bin/bash maxbot

echo "=== Cloning repo ==="
REPO_DIR="/opt/maxbot"
if [ -d "$REPO_DIR" ]; then
  echo "Repo already exists at $REPO_DIR, pulling latest"
  cd "$REPO_DIR" && git pull
else
  git clone https://github.com/MaxLeiter/MaxBot.git "$REPO_DIR"
fi

echo "=== Installing bun for maxbot user ==="
su - maxbot -c 'curl -fsSL https://bun.sh/install | bash'

echo "=== Installing dependencies ==="
cd "$REPO_DIR"
su - maxbot -c "cd $REPO_DIR && ~/.bun/bin/bun install"

echo "=== Setting up env ==="
mkdir -p /etc/maxbot
if [ ! -f /etc/maxbot/.env ]; then
  cp "$REPO_DIR/.env.example" /etc/maxbot/.env
  echo ">>> Edit /etc/maxbot/.env with your API keys <<<"
fi

echo "=== Configuring Claude Code permissions ==="
su - maxbot -c 'mkdir -p ~/.claude && cat > ~/.claude/settings.json << SETTINGS
{
  "permissions": {
    "allow": [
      "WebSearch",
      "WebFetch"
    ]
  }
}
SETTINGS'

echo "=== Setting permissions ==="
chown -R maxbot:maxbot "$REPO_DIR"

echo "=== Installing systemd service ==="
cp "$REPO_DIR/deploy/maxbot.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable maxbot

echo ""
echo "=== Done ==="
echo "1. Edit /etc/maxbot/.env with your API keys"
echo "2. Start with: systemctl start maxbot"
echo "3. Logs: journalctl -u maxbot -f"
echo "4. Bot self-edits go to: $REPO_DIR"
