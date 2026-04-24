#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="catraquim"
DEFAULT_REPO_URL="https://github.com/Lucas-Delacroix/catraquim.git"
DEFAULT_REF="main"
DEFAULT_PNPM_VERSION="10.8.1"

INSTALL_METHOD="${CATRAQUIM_INSTALL_METHOD:-git}"
REPO_URL="${CATRAQUIM_REPO_URL:-$DEFAULT_REPO_URL}"
REF="${CATRAQUIM_REF:-$DEFAULT_REF}"
INSTALL_DIR="${CATRAQUIM_INSTALL_DIR:-$HOME/.local/share/catraquim}"
BIN_DIR="${CATRAQUIM_BIN_DIR:-$HOME/.local/bin}"
NPM_PACKAGE="${CATRAQUIM_NPM_PACKAGE:-catraquim}"
PNPM_VERSION="${CATRAQUIM_PNPM_VERSION:-$DEFAULT_PNPM_VERSION}"
UNINSTALL="0"
PNPM_BIN=""

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  RED=$'\033[31m'
  NC=$'\033[0m'
else
  BOLD=""
  DIM=""
  GREEN=""
  YELLOW=""
  RED=""
  NC=""
fi

usage() {
  cat <<EOF
catraquim installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/Lucas-Delacroix/catraquim/main/scripts/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/Lucas-Delacroix/catraquim/main/scripts/install.sh | bash -s -- --install-method git

Options:
  --install-method <git|npm>  Install from source checkout or npm package (default: git)
  --repo <url>                Git repository URL (default: $DEFAULT_REPO_URL)
  --ref <ref>                 Git branch, tag, or commit (default: $DEFAULT_REF)
  --install-dir <path>        Source install directory (default: ~/.local/share/catraquim)
  --bin-dir <path>            Symlink directory (default: ~/.local/bin)
  --npm-package <spec>        npm package spec for --install-method npm (default: catraquim)
  --uninstall                 Remove the git install and symlink
  -h, --help                  Show this help

Environment overrides:
  CATRAQUIM_INSTALL_METHOD, CATRAQUIM_REPO_URL, CATRAQUIM_REF,
  CATRAQUIM_INSTALL_DIR, CATRAQUIM_BIN_DIR, CATRAQUIM_NPM_PACKAGE,
  CATRAQUIM_PNPM_VERSION
EOF
}

info() {
  printf '%s\n' "${DIM}$*${NC}"
}

success() {
  printf '%s\n' "${GREEN}$*${NC}"
}

warn() {
  printf '%s\n' "${YELLOW}warning:${NC} $*" >&2
}

die() {
  printf '%s\n' "${RED}error:${NC} $*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-method)
      [[ $# -ge 2 ]] || die "--install-method requires a value"
      INSTALL_METHOD="$2"
      shift 2
      ;;
    --install-method=*)
      INSTALL_METHOD="${1#*=}"
      shift
      ;;
    --repo)
      [[ $# -ge 2 ]] || die "--repo requires a value"
      REPO_URL="$2"
      shift 2
      ;;
    --repo=*)
      REPO_URL="${1#*=}"
      shift
      ;;
    --ref)
      [[ $# -ge 2 ]] || die "--ref requires a value"
      REF="$2"
      shift 2
      ;;
    --ref=*)
      REF="${1#*=}"
      shift
      ;;
    --install-dir)
      [[ $# -ge 2 ]] || die "--install-dir requires a value"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --install-dir=*)
      INSTALL_DIR="${1#*=}"
      shift
      ;;
    --bin-dir)
      [[ $# -ge 2 ]] || die "--bin-dir requires a value"
      BIN_DIR="$2"
      shift 2
      ;;
    --bin-dir=*)
      BIN_DIR="${1#*=}"
      shift
      ;;
    --npm-package)
      [[ $# -ge 2 ]] || die "--npm-package requires a value"
      NPM_PACKAGE="$2"
      shift 2
      ;;
    --npm-package=*)
      NPM_PACKAGE="${1#*=}"
      shift
      ;;
    --uninstall)
      UNINSTALL="1"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

ensure_node() {
  command_exists node || die "Node.js 20 or newer is required"

  local major
  major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || true)"
  [[ "$major" =~ ^[0-9]+$ ]] || die "could not detect Node.js version"

  if ((major < 20)); then
    die "Node.js 20 or newer is required; found $(node --version)"
  fi
}

ensure_pnpm() {
  if command_exists pnpm; then
    PNPM_BIN="pnpm"
    return
  fi

  if command_exists corepack; then
    info "pnpm not found; preparing pnpm@$PNPM_VERSION with corepack"
    corepack enable >/dev/null 2>&1 || true
    if corepack prepare "pnpm@$PNPM_VERSION" --activate >/dev/null; then
      if command_exists pnpm; then
        PNPM_BIN="pnpm"
        return
      fi

      PNPM_BIN="corepack"
      return
    fi

    warn "corepack could not prepare pnpm@$PNPM_VERSION; falling back to npm exec"
  fi

  command_exists npm || die "pnpm is required. Install pnpm, corepack, or npm."

  info "pnpm not found; using npm exec pnpm@$PNPM_VERSION"
  PNPM_BIN="npm-exec"
}

run_pnpm() {
  if [[ "$PNPM_BIN" == "corepack" ]]; then
    corepack pnpm "$@"
    return
  fi

  if [[ "$PNPM_BIN" == "npm-exec" ]]; then
    npm exec --yes "pnpm@$PNPM_VERSION" -- "$@"
    return
  fi

  pnpm "$@"
}

checkout_ref() {
  local dir="$1"

  if git -C "$dir" rev-parse --verify --quiet "${REF}^{commit}" >/dev/null; then
    git -C "$dir" checkout --force "$REF" >/dev/null
    return
  fi

  git -C "$dir" fetch --depth 1 origin "$REF" >/dev/null
  git -C "$dir" checkout --force FETCH_HEAD >/dev/null
}

install_from_git() {
  ensure_node
  ensure_pnpm
  command_exists git || die "git is required for --install-method git"

  mkdir -p "$(dirname "$INSTALL_DIR")" "$BIN_DIR"

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Updating $PROJECT_NAME in $INSTALL_DIR"
    git -C "$INSTALL_DIR" remote set-url origin "$REPO_URL"
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$REF" >/dev/null
    git -C "$INSTALL_DIR" checkout --force FETCH_HEAD >/dev/null
  elif [[ -e "$INSTALL_DIR" ]]; then
    die "$INSTALL_DIR already exists and is not a git checkout. Remove it or pass --install-dir."
  else
    info "Cloning $PROJECT_NAME from $REPO_URL"
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR" >/dev/null
    checkout_ref "$INSTALL_DIR"
  fi

  info "Installing dependencies"
  (cd "$INSTALL_DIR" && run_pnpm install --frozen-lockfile)

  info "Building CLI"
  (cd "$INSTALL_DIR" && run_pnpm build)

  [[ -f "$INSTALL_DIR/dist/cli.js" ]] || die "build did not produce dist/cli.js"
  chmod +x "$INSTALL_DIR/dist/cli.js"
  ln -sfn "$INSTALL_DIR/dist/cli.js" "$BIN_DIR/catraquim"

  success "${BOLD}$PROJECT_NAME installed${NC}"
  printf 'Binary: %s\n' "$BIN_DIR/catraquim"
}

install_from_npm() {
  ensure_node
  command_exists npm || die "npm is required for --install-method npm"

  info "Installing $NPM_PACKAGE globally with npm"
  npm install -g "$NPM_PACKAGE"
  success "${BOLD}$PROJECT_NAME installed with npm${NC}"
}

uninstall_git_install() {
  if [[ -L "$BIN_DIR/catraquim" ]]; then
    rm -f "$BIN_DIR/catraquim"
    info "Removed $BIN_DIR/catraquim"
  elif [[ -e "$BIN_DIR/catraquim" ]]; then
    warn "$BIN_DIR/catraquim exists but is not a symlink; leaving it untouched"
  fi

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    rm -rf "$INSTALL_DIR"
    info "Removed $INSTALL_DIR"
  elif [[ -e "$INSTALL_DIR" ]]; then
    warn "$INSTALL_DIR exists but is not a git checkout; leaving it untouched"
  fi

  success "$PROJECT_NAME git install removed"
}

print_path_hint() {
  case ":${PATH:-}:" in
    *":$BIN_DIR:"*) ;;
    *)
      warn "$BIN_DIR is not in PATH"
      printf 'Add this to your shell profile:\n  export PATH="%s:$PATH"\n' "$BIN_DIR"
      ;;
  esac
}

printf '%s\n' "${BOLD}catraquim installer${NC}"

if [[ "$UNINSTALL" == "1" ]]; then
  uninstall_git_install
  exit 0
fi

case "$INSTALL_METHOD" in
  git)
    install_from_git
    print_path_hint
    ;;
  npm)
    install_from_npm
    ;;
  *)
    die "--install-method must be 'git' or 'npm'"
    ;;
esac

printf '\nNext steps:\n'
printf '  catraquim config:init\n'
printf '  catraquim start\n'
