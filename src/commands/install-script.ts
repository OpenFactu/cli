import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger';

const REPO_URL = 'https://github.com/OpenFactu/platform.git';

export function registerInstallScriptCommand(program: Command) {
  program
    .command('install:script')
    .description('Generar script de instalacion standalone (sin CLI)')
    .option('-o, --output <file>', 'Archivo de salida', './install-openfactu.sh')
    .option('--tag <tag>', 'Version fija en el script')
    .option('--dir <dir>', 'Directorio por defecto')
    .option('-m, --monitoring', 'Incluir opcion de monitoreo en el script')
    .option('-s, --service', 'Incluir opcion de servicio systemd en el script')
    .action(async (opts) => {
      console.log();
      console.log(chalk.bold.white('  OpenFactu — Generar Script de Instalacion'));
      console.log(chalk.dim('  ────────────────────────────────────'));
      console.log();

      try {
        const tag = opts.tag || '${TAG:-latest}';
        const defaultDir = opts.dir || '$HOME/openfactu';
        const includeMonitoring = opts.monitoring || false;
        const includeService = opts.service || false;

        if (!opts.output.includes('.sh')) {
          opts.output += '.sh';
        }

        const script = generateInstallScript({
          repoUrl: REPO_URL,
          tag,
          defaultDir,
          includeMonitoring,
          includeService,
        });

        const spinner = ora('Generando script...').start();
        fs.writeFileSync(opts.output, script);
        fs.chmodSync(opts.output, 0o755);
        spinner.succeed(`Script generado: ${chalk.cyan(opts.output)}`);

        const fileSize = fs.statSync(opts.output).size;
        log.info(`Tamano: ${(fileSize / 1024).toFixed(1)}KB`);
        log.blank();
        log.dim('  Para usar el script:');
        log.dim(`    chmod +x ${opts.output}`);
        log.dim(`    ./${opts.output}`);
        log.blank();
        log.dim('  O remotamente:');
        log.dim(`    curl -sL <url> | bash`);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exitCode = 1;
      }
    });
}

function generateInstallScript(options: {
  repoUrl: string;
  tag: string;
  defaultDir: string;
  includeMonitoring: boolean;
  includeService: boolean;
}): string {
  const { repoUrl, tag, defaultDir, includeMonitoring, includeService } = options;

  return `#!/bin/bash
# ============================================================
# OpenFactu - Script de Instalacion Automatica
# Generado por @openfactu/cli
# ============================================================

set -e

# Colors
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
NC='\\033[0m'

# Config
REPO_URL="${repoUrl}"
TAG="${tag}"
INSTALL_DIR="${defaultDir}"
MONITORING=false
SERVICE=false
SKIP_DOCKER=false

# ============================================================
# Functions
# ============================================================

log_info() {
    echo -e "\${BLUE}[INFO]\${NC} $1"
}

log_success() {
    echo -e "\${GREEN}[OK]\${NC} $1"
}

log_warn() {
    echo -e "\${YELLOW}[WARN]\${NC} $1"
}

log_error() {
    echo -e "\${RED}[ERROR]\${NC} $1"
}

check_command() {
    if ! command -v $1 &> /dev/null; then
        return 1
    fi
    return 0
}

generate_password() {
    openssl rand -base64 32 | tr -dc 'a-zA-Z0-9!@#$%^&*' | head -c 24
}

# ============================================================
# Banner
# ============================================================

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║     OpenFactu - Instalador Automatico    ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ============================================================
# Parse arguments
# ============================================================

while [[ $# -gt 0 ]]; do
    case $1 in
        --tag)
            TAG="$2"
            shift 2
            ;;
        --dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --monitoring)
            MONITORING=true
            shift
            ;;
        --service)
            SERVICE=true
            shift
            ;;
        --skip-docker)
            SKIP_DOCKER=true
            shift
            ;;
        --help|-h)
            echo "Uso: $0 [opciones]"
            echo ""
            echo "Opciones:"
            echo "  --tag <version>    Version a instalar (default: latest)"
            echo "  --dir <ruta>       Directorio de instalacion"
            echo "  --monitoring       Incluir stack de monitoreo"
            echo "  --service          Instalar como servicio systemd"
            echo "  --skip-docker      Solo descargar, no usar Docker"
            echo "  --help, -h         Mostrar esta ayuda"
            exit 0
            ;;
        *)
            log_error "Opcion desconocida: $1"
            exit 1
            ;;
    esac
done

# ============================================================
# Pre-flight checks
# ============================================================

log_info "Verificando requisitos..."

# Check OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    log_success "Sistema: Linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    log_success "Sistema: macOS"
else
    log_warn "Sistema no verificado: $OSTYPE"
fi

# Check Git
if check_command git; then
    log_success "Git: $(git --version)"
else
    log_error "Git no esta instalado"
    log_info "Instala Git: https://git-scm.com/downloads"
    exit 1
fi

# Check Docker
if check_command docker; then
    log_success "Docker: $(docker --version)"
    if docker compose version &> /dev/null || docker-compose --version &> /dev/null; then
        log_success "Docker Compose: disponible"
    else
        log_error "Docker Compose no esta instalado"
        exit 1
    fi
else
    if [ "$SKIP_DOCKER" = false ]; then
        log_warn "Docker no esta instalado"
        log_info "Instala Docker: https://docs.docker.com/get-docker/"
        log_info "Usa --skip-docker para solo descargar el codigo"
        exit 1
    fi
fi

# Check disk space
AVAILABLE_GB=$(df -BG "$HOME" | tail -1 | awk '{print $4}' | tr -d 'G')
if [ "$AVAILABLE_GB" -lt 5 ]; then
    log_error "Espacio insuficiente: \${AVAILABLE_GB}GB disponibles (minimo 5GB)"
    exit 1
fi
log_success "Espacio en disco: \${AVAILABLE_GB}GB disponibles"

echo ""

# ============================================================
# Interactive prompts (if not all options provided)
# ============================================================

if [ "$TAG" = "\${TAG:-latest}" ]; then
    read -p "Version a instalar (dejar vacio para latest): " USER_TAG
    if [ -n "$USER_TAG" ]; then
        TAG="$USER_TAG"
    fi
fi

read -p "Directorio de instalacion [$INSTALL_DIR]: " USER_DIR
if [ -n "$USER_DIR" ]; then
    INSTALL_DIR="$USER_DIR"
fi

if [ "$SKIP_DOCKER" = false ]; then
    if [ "$MONITORING" = false ]; then
        read -p "Incluir stack de monitoreo (Grafana, Prometheus)? [y/N]: " MON_ANSWER
        if [[ "$MON_ANSWER" =~ ^[Yy]$ ]]; then
            MONITORING=true
        fi
    fi

${includeService ? `    if [ "$SERVICE" = false ]; then
        read -p "Instalar como servicio systemd (auto-start)? [y/N]: " SVC_ANSWER
        if [[ "$SVC_ANSWER" =~ ^[Yy]$ ]]; then
            SERVICE=true
        fi
    fi` : ''}
fi

echo ""

# ============================================================
# Resolve tag
# ============================================================

if [ "$TAG" = "latest" ]; then
    log_info "Obteniendo ultima version..."
    LATEST=$(curl -s https://api.github.com/repos/OpenFactu/platform/releases | grep -m1 '"tag_name"' | cut -d'"' -f4)
    if [ -n "$LATEST" ]; then
        TAG="$LATEST"
        log_success "Version seleccionada: $TAG"
    else
        TAG="main"
        log_warn "No se pudo obtener la ultima version, usando main"
    fi
fi

# ============================================================
# Clone repository
# ============================================================

log_info "Descargando OpenFactu..."

if [ -d "$INSTALL_DIR" ]; then
    if [ "$(ls -A $INSTALL_DIR)" ]; then
        log_warn "El directorio $INSTALL_DIR no esta vacio"
        read -p "Continuar? [y/N]: " OVERWRITE
        if [[ ! "$OVERWRITE" =~ ^[Yy]$ ]]; then
            log_info "Instalacion cancelada"
            exit 0
        fi
    fi
else
    mkdir -p "$INSTALL_DIR"
fi

IS_TAG=false
if [[ "$TAG" == v* ]]; then
    IS_TAG=true
fi

if [ "$IS_TAG" = true ]; then
    git clone --depth 1 --branch "$TAG" "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || {
        log_warn "Clon por tag fallo, intentando metodo alternativo..."
        git clone "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
        git checkout "$TAG"
    }
else
    git clone --branch "$TAG" "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || {
        git clone "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
        git checkout "$TAG"
    }
fi

log_success "Codigo descargado en $INSTALL_DIR"

# ============================================================
# Generate .env
# ============================================================

log_info "Generando configuracion..."

cd "$INSTALL_DIR"

if [ -f ".env.example" ] && [ ! -f ".env" ]; then
    cp .env.example .env
fi

DB_PASSWORD=$(generate_password)
JWT_SECRET=$(generate_password)
ADMIN_PASSWORD=$(generate_password)

cat >> .env << EOF

# Generated by installer
POSTGRES_USER=openfactu
POSTGRES_PASSWORD=$DB_PASSWORD
POSTGRES_DB=openfactudb
DATABASE_URL=postgresql://openfactu:$DB_PASSWORD@db:5432/openfactudb
JWT_SECRET=$JWT_SECRET
SESSION_SECRET=$(generate_password)
NODE_ENV=production
HOST=localhost
CORS_ORIGIN=http://localhost:8080
VITE_API_URL=http://localhost:3000
ADMIN_EMAIL=admin@openfactu.local
ADMIN_PASSWORD=$ADMIN_PASSWORD
EOF

log_success "Configuracion generada"
echo ""
log_warn "Guarda estas credenciales:"
echo "  DB Password: $DB_PASSWORD"
echo "  Admin: admin@openfactu.local / $ADMIN_PASSWORD"
echo ""

# ============================================================
# Docker setup
# ============================================================

if [ "$SKIP_DOCKER" = false ]; then
    log_info "Construyendo contenedores Docker..."

    if command -v docker &> /dev/null && (docker compose version &> /dev/null || docker-compose --version &> /dev/null); then
        DOCKER_CMD="docker compose"
        if ! docker compose version &> /dev/null; then
            DOCKER_CMD="docker-compose"
        fi

        # Build
        $DOCKER_CMD build || {
            log_warn "Build fallo, puedes ejecutarlo manualmente despues"
        }

        # Up
        COMPOSE_FLAGS="-f docker-compose.yml"
        if [ -f "docker-compose.prod.yml" ]; then
            COMPOSE_FLAGS="-f docker-compose.prod.yml"
        fi

        if [ "$MONITORING" = true ] && [ -f "docker-compose.monitoring.yml" ]; then
            COMPOSE_FLAGS="$COMPOSE_FLAGS -f docker-compose.monitoring.yml"
        fi

        log_info "Levantando servicios..."
        $DOCKER_CMD $COMPOSE_FLAGS up -d

        log_success "Servicios levantados"

        # Wait for services
        log_info "Esperando que los servicios inicien..."
        sleep 10

        # Health check
        if curl -s http://localhost:3000/api/health &> /dev/null; then
            log_success "API esta operativa"
        else
            log_warn "API aun no responde, puede tardar unos segundos"
        fi
    else
        log_error "Docker no disponible"
    fi
fi

# ============================================================
# Install systemd service
# ============================================================

${includeService ? `if [ "$SERVICE" = true ]; then
    if [ -d "/run/systemd/system" ]; then
        log_info "Instalando servicio systemd..."

        DOCKER_CMD="docker compose"
        if ! docker compose version &> /dev/null; then
            DOCKER_CMD="docker-compose"
        fi

        cat > /tmp/openfactu.service << SVCEOF
[Unit]
Description=OpenFactu ERP Platform
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=$DOCKER_CMD -f docker-compose.yml up -d
ExecStop=$DOCKER_CMD -f docker-compose.yml down
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
SVCEOF

        sudo mv /tmp/openfactu.service /etc/systemd/system/openfactu.service
        sudo systemctl daemon-reload
        sudo systemctl enable openfactu

        log_success "Servicio systemd instalado"
        log_info "Iniciar con: sudo systemctl start openfactu"
    else
        log_warn "systemd no disponible, omitiendo servicio"
    fi
fi` : ''}

# ============================================================
# Summary
# ============================================================

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║     Instalacion Completada!              ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""
echo "  Directorio: $INSTALL_DIR"
echo "  Version:    $TAG"
echo ""
echo "  Proximos pasos:"
echo "    cd $INSTALL_DIR"
echo "    openfactu setup          # Configurar base de datos"
echo "    openfactu deploy         # Configurar acceso externo"
echo "    openfactu doctor         # Verificar instalacion"
echo ""
if [ "$SKIP_DOCKER" = false ]; then
    echo "  URLs:"
    echo "    Web: http://localhost:8080"
    echo "    API: http://localhost:3000"
    echo ""
fi
`;
}
