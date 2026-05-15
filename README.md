# @openfactu/cli

CLI oficial para instalar, gestionar y desplegar [OpenFactu](https://github.com/OpenFactu/platform) — ERP de facturacion open source.

## Instalacion

```bash
npm i -g @openfactu/cli
```

## Inicio rapido

```bash
openfactu install              # Wizard interactivo completo
openfactu install:quick        # Instalacion rapida (non-interactive)
openfactu deploy               # Configura acceso externo
openfactu setup                # Configuracion inicial de BD
openfactu doctor               # Diagnostico del entorno
```

## Comandos

### Instalacion

| Comando | Descripcion |
|---------|-------------|
| `openfactu install [dir]` | Wizard completo: version, modo, Docker, monitoreo, servicio |
| `openfactu install:quick` | Instalacion rapida non-interactive |
| `openfactu install:script` | Generar script shell standalone para instalar sin CLI |
| `openfactu update` | Actualiza sin perder datos |
| `openfactu update:check` | Comprueba si hay versiones nuevas |
| `openfactu uninstall` | Desinstalacion limpia con backup opcional |

#### Opciones de `install`

```bash
openfactu install --tag v1.0.0           # Version especifica
openfactu install --branch develop       # Desde branch
openfactu install --mode full            # Modo: full, docker, minimal, download
openfactu install --generate-env         # Credenciales seguras aleatorias
openfactu install --monitoring           # Incluir stack de monitoreo
openfactu install --with-analytics       # Incluir analitica completa (Loki, cAdvisor, Node Exporter)
openfactu install --service              # Instalar como servicio systemd
openfactu install -y                     # Non-interactive, acepta defaults
openfactu install --no-preflight         # Saltar chequeos previos
```

#### Modos de instalacion

- **full** — Build + up + setup de BD + health checks
- **docker** — Build + up (sin setup de BD)
- **minimal** — Solo up, sin build
- **download** — Solo descarga el codigo

### Servicio systemd

| Comando | Descripcion |
|---------|-------------|
| `openfactu service install` | Instalar como servicio systemd con auto-start |
| `openfactu service start` | Iniciar servicio |
| `openfactu service stop` | Detener servicio |
| `openfactu service restart` | Reiniciar servicio |
| `openfactu service status` | Ver estado |
| `openfactu service logs` | Ver logs del servicio |
| `openfactu service uninstall` | Remover servicio |

```bash
openfactu service install --restart always --healthcheck --with-monitoring
```

### Despliegue

| Comando | Descripcion |
|---------|-------------|
| `openfactu deploy` | Wizard para configurar acceso externo (LAN/internet) |
| `openfactu deploy:status` | Estado de los contenedores Docker |
| `openfactu rebuild` | Reconstruye y reinicia contenedores |
| `openfactu logs` | Muestra logs de los servicios |
| `openfactu stop` | Para todos los servicios |
| `openfactu restart` | Reinicia sin rebuild |

### Monitoreo y Analitica

| Comando | Descripcion |
|---------|-------------|
| `openfactu monitoring` | Wizard para configurar stack de monitoreo |
| `openfactu monitoring:generate` | Generar compose sin interaccion |
| `openfactu monitoring:up` | Levantar servicios de monitoreo |
| `openfactu monitoring:down` | Parar servicios de monitoreo |
| `openfactu monitoring:status` | Estado de los servicios |
| `openfactu monitoring:config` | Cambiar configuracion |

#### Servicios disponibles

- **pgAdmin** — Gestion de base de datos (puerto 5050)
- **Grafana** — Dashboards y visualizacion (puerto 3001)
- **Prometheus** — Metricas y alertas (puerto 9090)
- **Loki** — Agregacion de logs (puerto 3100)
- **Promtail** — Envio de logs a Loki
- **cAdvisor** — Metricas de contenedores Docker (puerto 8081)
- **Node Exporter** — Metricas del host (puerto 9100)
- **Portainer** — Gestion de Docker (puerto 9000)
- **Alertmanager** — Gestion de alertas (puerto 9093)

```bash
openfactu monitoring --with-analytics        # Stack completo de analitica
openfactu monitoring:generate --analytics    # Generar compose con todo
```

### Backup y Restore

| Comando | Descripcion |
|---------|-------------|
| `openfactu backup create` | Crear backup completo |
| `openfactu backup list` | Listar backups disponibles |
| `openfactu backup restore` | Restaurar desde backup |
| `openfactu backup delete` | Eliminar backup |

```bash
openfactu backup create --name produccion-2024
openfactu backup create --db-only              # Solo base de datos
openfactu backup restore --name produccion-2024
openfactu uninstall --keep-backup              # Backup antes de desinstalar
```

### Diagnostico

| Comando | Descripcion |
|---------|-------------|
| `openfactu doctor` | Diagnostico completo del entorno |

```bash
openfactu doctor          # Verificacion visual
openfactu doctor --json   # Salida en JSON para scripts
```

### Base de datos

| Comando | Descripcion |
|---------|-------------|
| `openfactu setup` | Configuracion inicial: BD, admin, primer tenant |
| `openfactu migrate` | Ejecuta migraciones pendientes |
| `openfactu migrate:status` | Estado de migraciones por tenant |

### Tenants (empresas)

| Comando | Descripcion |
|---------|-------------|
| `openfactu tenant list` | Lista empresas |
| `openfactu tenant create` | Crea una empresa nueva |
| `openfactu tenant sync` | Sincroniza migraciones |

### Plugins

| Comando | Descripcion |
|---------|-------------|
| `openfactu plugin list` | Lista plugins instalados con estado por tenant |
| `openfactu plugin search` | Busca en el marketplace (interactivo) |
| `openfactu plugin install <nombre>` | Descarga e instala del marketplace |
| `openfactu plugin update [nombre]` | Actualiza uno o todos |
| `openfactu plugin remove <nombre>` | Elimina un plugin |
| `openfactu plugin link [dir]` | Enlaza un plugin externo (symlink) |
| `openfactu plugin unlink <nombre>` | Quita el enlace |
| `openfactu plugin push [dir]` | Sube un plugin a un servidor remoto |
| `openfactu plugin watch [dir]` | Auto-sync al guardar (desarrollo remoto) |
| `openfactu plugin dev [nombre]` | Servidor en modo desarrollo con hot reload |

### Otros

| Comando | Descripcion |
|---------|-------------|
| `openfactu version` | Versiones del sistema |

## Flujos de trabajo

### Instalacion para produccion

```bash
# 1. Instalacion completa con todo
openfactu install --mode full --monitoring --with-analytics --service --generate-env

# 2. Verificar que todo esta bien
openfactu doctor

# 3. Configurar acceso externo
openfactu deploy

# 4. Configurar base de datos
openfactu setup
```

### Instalacion rapida para desarrollo

```bash
openfactu install:quick --generate-env
```

### Instalar en servidor remoto sin CLI

```bash
# Generar script en tu maquina
openfactu install:script --output deploy.sh --monitoring --service

# Subir y ejecutar en el servidor
scp deploy.sh usuario@servidor:~/
ssh usuario@servidor "chmod +x ~/deploy.sh && ~/deploy.sh"
```

### Backup antes de actualizar

```bash
openfactu backup create --name pre-update
openfactu update
# Si algo sale mal:
openfactu backup restore --name pre-update
```

### Instalar como servicio con auto-start

```bash
openfactu service install --restart always --healthcheck --healthcheck-interval 5min
```

## Desarrollo remoto de plugins

```bash
# Desde otro ordenador, sube tu plugin automaticamente al guardar
openfactu plugin watch \
  --server http://mi-servidor:3000 \
  --client-id ofk_... \
  --client-secret ofs_...
```

Las dev keys se generan desde la UI del ERP: Plugins > Desarrollo > Generar API Key.

## Uso desde cualquier directorio

```bash
openfactu --path /ruta/a/openfactu migrate

# o con variable de entorno
export OPENFACTU_HOME=/ruta/a/openfactu
openfactu migrate
```

## Requisitos

- Node.js >= 18
- Docker Desktop (para instalar y desplegar)
- Git

## Links

- [GitHub](https://github.com/OpenFactu/platform)
- [Documentacion](https://openfactuerp.org)
- [Marketplace](https://openfactuerp.org/marketplace/)
- [Reportar problema](https://github.com/OpenFactu/platform/issues)
