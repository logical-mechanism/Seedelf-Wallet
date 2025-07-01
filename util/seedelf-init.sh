#!/usr/bin/env bash
set -e

# Detect OS and architecture
OS=$(uname -s)
ARCH=$(uname -m)

# Map OS and ARCH to your release asset naming convention
if [[ "$OS" == "Linux" ]]; then
  OS="linux"
elif [[ "$OS" == "Darwin" ]]; then
  OS="macos"
else
  echo "Unsupported OS: $OS"
  exit 1
fi

# Set install directory
INSTALL_DIR="$HOME/.local/bin"
mkdir -p "$INSTALL_DIR"

# Fetch the latest release URL
REPO="logical-mechanism/Seedelf-Wallet"
LATEST_URL=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep "browser_download_url" | grep "$OS" | cut -d '"' -f 4)

if [[ -z "$LATEST_URL" ]]; then
  echo "Failed to find the latest release for $OS."
  exit 1
fi

# Set install directory
INSTALL_DIR="$HOME/.local/bin"
mkdir -p "$INSTALL_DIR"

# Download binary
echo "Downloading $LATEST_URL..."
curl -L -o "$INSTALL_DIR/seedelf-cli.tar.gz" "$LATEST_URL"
echo "Extracting the binary..."
tar -xzf $INSTALL_DIR/seedelf-cli.tar.gz -C $INSTALL_DIR
mv "$INSTALL_DIR/seedelf-cli.bin" "$INSTALL_DIR/seedelf-cli"
chmod +x "$INSTALL_DIR/seedelf-cli"
rm "$INSTALL_DIR/seedelf-cli.bin.sha256"

# Check if the binary directory is in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo "Your binary was installed to $INSTALL_DIR, which is not in your PATH."

  # Determine the user's shell
  SHELL_NAME=$(basename "$SHELL")

  case "$SHELL_NAME" in
    bash)
      PROFILE_FILE="$HOME/.bashrc"
      ;;
    zsh)
      PROFILE_FILE="$HOME/.zshrc"
      ;;
    fish)
      PROFILE_FILE="$HOME/.config/fish/config.fish"
      ;;
    *)
      PROFILE_FILE=""
      ;;
  esac

  if [[ -n "$PROFILE_FILE" ]]; then
    echo "Adding $INSTALL_DIR to PATH in $PROFILE_FILE..."
    echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$PROFILE_FILE"
    echo "Run 'source $PROFILE_FILE' or restart your terminal to apply the changes."
  else
    echo "Could not determine your shell's configuration file."
    echo "Please add the following line to your shell's configuration file manually:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
  fi
else
  echo "Installation complete. You can now run 'seedelf-cli'."
fi
