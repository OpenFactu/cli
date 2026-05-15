import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { log } from '../utils/logger';
import { getProjectRoot, getMonitoringComposePath } from '../utils/paths';

function getLocalIPs(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) {
        ips.push(info.address);
      }
    }
  }
  return ips;
}

function readEnv(envPath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return env;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      env[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
    }
  }
  return env;
}

function writeEnv(envPath: string, env: Record<string, string>) {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(envPath, lines.join('\n') + '\n');
}

export function registerDeployCommand(program: Command) {
  program
    .command('deploy')
    .description('Configura OpenFactu para producción (acceso externo)')
    .option('--with-monitoring', 'Incluir stack de monitoreo (Grafana, Prometheus, etc.)')
    .action(async (opts) => {
      console.log();
      console.log(chalk.bold.white('  OpenFactu — Configurar Despliegue'));
      console.log(chalk.dim('  ────────────────────────────────────'));
      console.log();

      try {
        const root = getProjectRoot();
        const envPath = path.join(root, '.env');
        const composePath = path.join(root, 'docker-compose.yml');

        // 1. Detectar IPs locales
        const localIPs = getLocalIPs();
        log.info(`IPs detectadas: ${localIPs.join(', ') || 'ninguna'}`);

        // 2. Preguntar configuración
        const { mode } = await inquirer.prompt([
          {
            type: 'list',
            name: 'mode',
            message: 'Tipo de despliegue:',
            choices: [
              { name: `${chalk.green('Red local')} ${chalk.dim('— accesible desde otros equipos en tu red')}`, value: 'lan' },
              { name: `${chalk.cyan('Dominio/IP pública')} ${chalk.dim('— accesible desde internet')}`, value: 'public' },
              { name: `${chalk.dim('Solo localhost')} ${chalk.dim('— solo este equipo')}`, value: 'localhost' },
            ],
          },
        ]);

        let host = 'localhost';
        let serverPort = '3000';
        let webPort = '8080';
        let dbPort = '5432';
        let useSSL = false;

        if (mode === 'lan') {
          const ipChoices = localIPs.map((ip) => ({ name: ip, value: ip }));
          ipChoices.push({ name: 'Otra (escribir manualmente)', value: '__custom__' });

          const { selectedIP } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedIP',
              message: 'IP de la máquina en la red:',
              choices: ipChoices,
            },
          ]);

          if (selectedIP === '__custom__') {
            const { customIP } = await inquirer.prompt([
              { type: 'input', name: 'customIP', message: 'IP:' },
            ]);
            host = customIP;
          } else {
            host = selectedIP;
          }

          const { ssl } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'ssl',
              message: '¿Usar HTTPS? (certificado auto-firmado para red local)',
              default: false,
            },
          ]);
          useSSL = ssl;
        } else if (mode === 'public') {
          const { domain } = await inquirer.prompt([
            {
              type: 'input',
              name: 'domain',
              message: 'Dominio o IP pública (ej: erp.miempresa.com):',
            },
          ]);
          host = domain;

          const { ssl } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'ssl',
              message: '¿Usar HTTPS (SSL)?',
              default: true,
            },
          ]);
          useSSL = ssl;
        }

        // Puertos
        const { ports } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'ports',
            message: `¿Usar puertos por defecto? (web: 8080, api: 3000, db: 5432)`,
            default: true,
          },
        ]);

        if (!ports) {
          const answers = await inquirer.prompt([
            { type: 'input', name: 'webPort', message: 'Puerto web:', default: '8080' },
            { type: 'input', name: 'serverPort', message: 'Puerto API:', default: '3000' },
            { type: 'input', name: 'dbPort', message: 'Puerto BD (host):', default: '5432' },
          ]);
          webPort = answers.webPort;
          serverPort = answers.serverPort;
          dbPort = answers.dbPort;
        }

        // Password de BD
        const { dbPassword } = await inquirer.prompt([
          {
            type: 'input',
            name: 'dbPassword',
            message: 'Password de PostgreSQL:',
            default: 'openfactu_pass',
          },
        ]);

        // 3. Construir configuración
        const protocol = useSSL ? 'https' : 'http';
        const webUrl = webPort === '80' || webPort === '443'
          ? `${protocol}://${host}`
          : `${protocol}://${host}:${webPort}`;
        const apiUrl = serverPort === '80' || serverPort === '443'
          ? `${protocol}://${host}`
          : `${protocol}://${host}:${serverPort}`;

        log.blank();
        log.title('  Resumen de configuración');
        log.info(`Web:         ${chalk.cyan(webUrl)}`);
        log.info(`API:         ${chalk.cyan(apiUrl)}`);
        log.info(`BD Puerto:   ${chalk.cyan(dbPort)} ${chalk.dim('(host)')}`);
        log.info(`BD Password: ${chalk.dim(dbPassword === 'openfactu_pass' ? '(default)' : '****')}`);
        log.info(`SSL:         ${useSSL ? chalk.green('Si') : chalk.dim('No')}`);
        log.blank();

        const { confirm } = await inquirer.prompt([
          { type: 'confirm', name: 'confirm', message: 'Aplicar configuración?', default: true },
        ]);

        if (!confirm) {
          log.info('Cancelado');
          return;
        }

        // 4. Escribir .env
        const envSpinner = ora('Configurando .env...').start();
        const env = readEnv(envPath);
        env.SERVER_PORT = serverPort;
        env.WEB_PORT = webPort;
        env.DB_PORT = dbPort;
        env.POSTGRES_USER = env.POSTGRES_USER || 'openfactu';
        env.POSTGRES_PASSWORD = dbPassword;
        env.POSTGRES_DB = env.POSTGRES_DB || 'openfactudb';
        env.DATABASE_URL = `postgresql://${env.POSTGRES_USER}:${dbPassword}@db:5432/${env.POSTGRES_DB}`;
        env.VITE_API_URL = apiUrl;
        env.HOST = host;
        env.CORS_ORIGIN = webUrl;
        writeEnv(envPath, env);
        envSpinner.succeed('.env configurado');

        // 5. Generar docker-compose.prod.yml con bind a 0.0.0.0
        const prodComposePath = path.join(root, 'docker-compose.prod.yml');
        const prodSpinner = ora('Generando docker-compose.prod.yml...').start();

        let composeContent = `services:
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      args:
        VITE_API_URL: "${apiUrl}"
    ports:
      - "0.0.0.0:${webPort}:80"
    environment:
      VITE_API_URL: "${apiUrl}"
    depends_on:
      - server
    restart: unless-stopped
    networks:
      - openfactu_net

  server:
    build:
      context: .
      dockerfile: apps/server/Dockerfile
    ports:
      - "0.0.0.0:${serverPort}:3000"
    env_file:
      - .env
    volumes:
      - ./plugins:/app/plugins
      - ./storage:/app/storage
    depends_on:
      - db
    environment:
      - DATABASE_URL=postgresql://\${POSTGRES_USER:-openfactu}:\${POSTGRES_PASSWORD:-openfactu_pass}@db:5432/\${POSTGRES_DB:-openfactudb}
      - CORS_ORIGIN=${webUrl}
      - NODE_ENV=production
    restart: unless-stopped
    networks:
      - openfactu_net

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-openfactu}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-openfactu_pass}
      POSTGRES_DB: \${POSTGRES_DB:-openfactudb}
    ports:
      - "127.0.0.1:\${DB_PORT:-5432}:5432"
    volumes:
      - ./storage/db_data:/var/lib/postgresql/data
    restart: unless-stopped
    networks:
      - openfactu_net

networks:
  openfactu_net:
    driver: bridge
`;

        // Si SSL, añadir Caddy reverse proxy con Let's Encrypt
        if (useSSL) {
          composeContent += `
  caddy:
    image: caddy:2-alpine
    container_name: openfactu-caddy
    ports:
      - "0.0.0.0:80:80"
      - "0.0.0.0:443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - web
      - server
    restart: unless-stopped
    networks:
      - openfactu_net

volumes:
  caddy_data:
  caddy_config:
`;
          // Generar Caddyfile
          const caddyfilePath = path.join(root, 'Caddyfile');
          const isLAN = mode === 'lan';
          const tlsDirective = isLAN ? 'tls internal' : '';
          const httpRedirect = isLAN ? '' : `
http://${host} {
    redir https://{host}{uri} permanent
}
`;
          const caddyfileContent = `${host} {
    ${tlsDirective}
    encode gzip

    handle /api/* {
        reverse_proxy server:3000
    }

    handle {
        reverse_proxy web:80
    }

    log {
        output file /var/log/caddy/access.log
    }
}
${httpRedirect}`;
          fs.writeFileSync(caddyfilePath, caddyfileContent);
          prodSpinner.succeed('docker-compose.prod.yml y Caddyfile generados');
          log.blank();
          if (isLAN) {
            log.info('Caddy generará certificado auto-firmado para la red local');
            log.dim('  Los navegadores mostrarán advertencia de seguridad (es normal)');
            log.dim('  Puertos: 80 (HTTP) y 443 (HTTPS)');
          } else {
            log.info('Caddy obtendrá certificados Let\'s Encrypt automáticamente');
            log.dim('  Asegúrate de que el puerto 80 y 443 estén abiertos');
            log.dim('  El DNS debe apuntar a este servidor');
            log.dim('  El primer request tardará unos segundos mientras se obtiene el certificado');
          }
        } else {
          prodSpinner.succeed('docker-compose.prod.yml generado');
        }

        // Generar docker-compose.prod.monitoring.yml si se pidió monitoreo
        if (opts.withMonitoring) {
          const monSpinner = ora('Generando docker-compose.prod.monitoring.yml...').start();
          const monitoringComposePath = path.join(root, 'docker-compose.prod.monitoring.yml');
          const monitoringCompose = `services:
  pgadmin:
    image: dpage/pgadmin4:latest
    environment:
      PGADMIN_DEFAULT_EMAIL: \${PGADMIN_EMAIL:-admin@openfactu.local}
      PGADMIN_DEFAULT_PASSWORD: \${PGADMIN_PASSWORD:-admin}
      PGADMIN_CONFIG_SERVER_MODE: 'False'
    ports:
      - "0.0.0.0:\${PGADMIN_PORT:-5050}:80"
    volumes:
      - ./storage/pgadmin_data:/var/lib/pgadmin
    depends_on:
      - db
    restart: unless-stopped
    networks:
      - openfactu_net

  grafana:
    image: grafana/grafana:latest
    environment:
      - GF_SECURITY_ADMIN_USER=\${GRAFANA_USER:-admin}
      - GF_SECURITY_ADMIN_PASSWORD=\${GRAFANA_PASSWORD:-admin}
      - GF_USERS_ALLOW_SIGN_UP=false
    ports:
      - "0.0.0.0:\${GRAFANA_PORT:-3001}:3000"
    volumes:
      - ./storage/grafana_data:/var/lib/grafana
    depends_on:
      - prometheus
    restart: unless-stopped
    networks:
      - openfactu_net

  prometheus:
    image: prom/prometheus:latest
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=15d'
      - '--web.enable-lifecycle'
    ports:
      - "0.0.0.0:\${PROMETHEUS_PORT:-9090}:9090"
    volumes:
      - ./monitoring/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./storage/prometheus_data:/prometheus
    restart: unless-stopped
    networks:
      - openfactu_net

  portainer:
    image: portainer/portainer-ce:latest
    command: -H unix:///var/run/docker.sock
    ports:
      - "0.0.0.0:\${PORTAINER_PORT:-9000}:9000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./storage/portainer_data:/data
    restart: unless-stopped
    networks:
      - openfactu_net

networks:
  openfactu_net:
    name: openfactu_net
    driver: bridge
`;
          fs.writeFileSync(monitoringComposePath, monitoringCompose);
          monSpinner.succeed('docker-compose.prod.monitoring.yml generado');
        }

        // 6. Preguntar si levantar
        log.blank();
        const { start } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'start',
            message: '¿Levantar los servicios ahora?',
            default: true,
          },
        ]);

        if (start) {
          const startSpinner = ora('Construyendo y levantando servicios...').start();
          try {
            execSync('docker compose -f docker-compose.prod.yml up -d --build', {
              cwd: root,
              stdio: 'pipe',
              timeout: 300000,
            });
            startSpinner.succeed('Servicios levantados');
          } catch (err: any) {
            startSpinner.fail('Error: ' + err.message);
            log.dim('  Ejecuta manualmente:');
            log.dim(`  cd ${root} && docker compose -f docker-compose.prod.yml up -d --build`);
          }
        }

        log.blank();
        console.log(chalk.bold.green('  Despliegue configurado'));
        console.log(chalk.dim('  ────────────────────────────────────'));
        console.log(`  ${chalk.dim('Web:')}  ${chalk.cyan(webUrl)}`);
        console.log(`  ${chalk.dim('API:')}  ${chalk.cyan(apiUrl)}`);
        log.blank();

        if (mode === 'lan') {
          log.info('Accede desde otros equipos de la red con la URL de arriba');
        } else if (mode === 'public') {
          log.info('Asegúrate de que los puertos estén abiertos en el firewall');
          if (useSSL) {
            log.info('Caddy obtendrá certificado Let\'s Encrypt automáticamente');
            log.dim('  El DNS debe apuntar a este servidor para que funcione');
            log.dim('  Puertos requeridos: 80 (HTTP) y 443 (HTTPS)');
          }
        }

        log.blank();
        log.dim('  Comandos útiles:');
        log.dim(`  docker compose -f docker-compose.prod.yml logs -f    — Ver logs`);
        log.dim(`  docker compose -f docker-compose.prod.yml down       — Parar`);
        log.dim(`  docker compose -f docker-compose.prod.yml restart    — Reiniciar`);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exitCode = 1;
      }
    });

  // ── openfactu deploy:ssl ──
  program
    .command('deploy:ssl')
    .description('Activa HTTPS en un despliegue existente con Caddy')
    .option('--domain <domain>', 'Dominio para el certificado')
    .option('--lan', 'Usar certificado auto-firmado para red local')
    .option('--port <port>', 'Puerto HTTPS (default: 443)', '443')
    .action(async (opts) => {
      console.log();
      console.log(chalk.bold.white('  OpenFactu — Activar HTTPS'));
      console.log(chalk.dim('  ────────────────────────────────────'));
      console.log();

      try {
        const root = getProjectRoot();
        const envPath = path.join(root, '.env');
        const env = readEnv(envPath);
        const host = opts.domain || env.HOST || 'localhost';
        const isLAN = opts.lan || false;

        if (!isLAN && !opts.domain) {
          const { domain } = await inquirer.prompt([
            {
              type: 'input',
              name: 'domain',
              message: 'Dominio para el certificado Let\'s Encrypt:',
              default: host,
            },
          ]);
          opts.domain = domain;
        }

        const finalHost = opts.domain || host;
        const httpsPort = opts.port || '443';

        // Generar Caddyfile
        const tlsDirective = isLAN ? 'tls internal' : '';
        const httpRedirect = isLAN ? '' : `
http://${finalHost} {
    redir https://${finalHost}{uri} permanent
}
`;
        const caddyfileContent = `${finalHost} {
    ${tlsDirective}
    encode gzip

    handle /api/* {
        reverse_proxy server:3000
    }

    handle {
        reverse_proxy web:80
    }

    log {
        output file /var/log/caddy/access.log
    }
}
${httpRedirect}`;

        const caddyfilePath = path.join(root, 'Caddyfile');
        fs.writeFileSync(caddyfilePath, caddyfileContent);

        // Actualizar docker-compose.prod.yml para añadir Caddy
        const prodComposePath = path.join(root, 'docker-compose.prod.yml');
        let composeContent = fs.existsSync(prodComposePath)
          ? fs.readFileSync(prodComposePath, 'utf-8')
          : '';

        if (!composeContent.includes('caddy:')) {
          composeContent += `
  caddy:
    image: caddy:2-alpine
    container_name: openfactu-caddy
    ports:
      - "0.0.0.0:80:80"
      - "0.0.0.0:${httpsPort}:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - web
      - server
    restart: unless-stopped
    networks:
      - openfactu_net

volumes:
  caddy_data:
  caddy_config:
`;
          fs.writeFileSync(prodComposePath, composeContent);
        }

        // Actualizar .env
        const protocol = 'https';
        const webUrl = httpsPort === '443'
          ? `${protocol}://${finalHost}`
          : `${protocol}://${finalHost}:${httpsPort}`;
        env.VITE_API_URL = webUrl;
        env.CORS_ORIGIN = webUrl;
        env.HOST = finalHost;
        writeEnv(envPath, env);

        log.blank();
        log.success('HTTPS configurado');
        log.blank();
        log.info(`URL: ${chalk.cyan(webUrl)}`);
        if (isLAN) {
          log.dim('  Certificado auto-firmado (los navegadores mostrarán advertencia)');
        } else {
          log.dim('  Caddy obtendrá certificado Let\'s Encrypt en el primer request');
          log.dim('  El DNS debe apuntar a este servidor');
        }
        log.blank();

        const { restart } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'restart',
            message: '¿Reiniciar servicios para aplicar HTTPS?',
            default: true,
          },
        ]);

        if (restart) {
          const spinner = ora('Reiniciando servicios...').start();
          try {
            execSync('docker compose -f docker-compose.prod.yml up -d', {
              cwd: root,
              stdio: 'pipe',
              timeout: 120000,
            });
            spinner.succeed('Servicios reiniciados');
          } catch (err: any) {
            spinner.fail('Error: ' + err.message);
          }
        }
      } catch (err: any) {
        log.error(err.message);
        process.exitCode = 1;
      }
    });

  // ── openfactu deploy:status ──
  program
    .command('deploy:status')
    .description('Muestra el estado de los servicios Docker')
    .option('--with-monitoring', 'Incluir servicios de monitoreo')
    .action(async (opts) => {
      try {
        const root = getProjectRoot();
        const prodCompose = path.join(root, 'docker-compose.prod.yml');
        const composeFile = fs.existsSync(prodCompose) ? 'docker-compose.prod.yml' : 'docker-compose.yml';
        const monitoringCompose = path.join(root, 'docker-compose.prod.monitoring.yml');
        const useMonitoring = opts.withMonitoring && fs.existsSync(monitoringCompose);

        log.info(`Usando: ${chalk.dim(composeFile)}`);
        if (useMonitoring) log.info(`Monitoreo: ${chalk.dim('docker-compose.prod.monitoring.yml')}`);
        log.blank();

        const files = useMonitoring
          ? `-f ${composeFile} -f docker-compose.prod.monitoring.yml`
          : `-f ${composeFile}`;
        const output = execSync(`docker compose ${files} ps`, {
          cwd: root,
        }).toString();

        console.log(output);

        // Mostrar URLs
        const envPath = path.join(root, '.env');
        const env = readEnv(envPath);
        const host = env.HOST || 'localhost';
        const webPort = env.WEB_PORT || '8080';
        const serverPort = env.SERVER_PORT || '3000';
        const protocol = env.VITE_API_URL?.startsWith('https') ? 'https' : 'http';

        log.blank();
        log.info(`Web: ${chalk.cyan(`${protocol}://${host}:${webPort}`)}`);
        log.info(`API: ${chalk.cyan(`${protocol}://${host}:${serverPort}`)}`);
      } catch (err: any) {
        log.error('Docker no disponible o servicios no levantados');
        log.dim('  ' + err.message);
      }
    });

  // ── openfactu rebuild ──
  program
    .command('rebuild')
    .description('Reconstruye y reinicia los contenedores Docker')
    .option('--service <name>', 'Reconstruir solo un servicio (web, server, db)')
    .option('--no-cache', 'Construir sin cache de Docker')
    .option('--with-monitoring', 'Incluir servicios de monitoreo')
    .action(async (opts) => {
      try {
        const root = getProjectRoot();
        const prodCompose = path.join(root, 'docker-compose.prod.yml');
        const composeFile = fs.existsSync(prodCompose) ? 'docker-compose.prod.yml' : 'docker-compose.yml';
        const monitoringCompose = path.join(root, 'docker-compose.prod.monitoring.yml');
        const useMonitoring = opts.withMonitoring && fs.existsSync(monitoringCompose);

        const service = opts.service || '';
        const noCache = opts.cache === false ? ' --no-cache' : '';

        log.info(`Usando: ${chalk.dim(composeFile)}`);
        if (useMonitoring) log.info(`Monitoreo: ${chalk.dim('docker-compose.prod.monitoring.yml')}`);
        log.blank();

        const files = useMonitoring
          ? `-f ${composeFile} -f docker-compose.prod.monitoring.yml`
          : `-f ${composeFile}`;

        const buildSpinner = ora(`Construyendo${service ? ' ' + service : ' todos los servicios'}...`).start();
        try {
          execSync(`docker compose ${files} build${noCache} ${service}`, {
            cwd: root,
            stdio: 'pipe',
            timeout: 600000,
          });
          buildSpinner.succeed('Build completado');
        } catch (err: any) {
          buildSpinner.fail('Error en el build');
          // Mostrar output del error
          const output = err.stdout?.toString() || err.stderr?.toString() || err.message;
          const errorLines = output.split('\n').filter((l: string) => l.includes('error') || l.includes('Error') || l.includes('>>>'));
          if (errorLines.length > 0) {
            log.blank();
            for (const line of errorLines.slice(0, 10)) {
              log.error(line.trim());
            }
          }
          return;
        }

        const upSpinner = ora('Reiniciando servicios...').start();
        try {
          execSync(`docker compose ${files} up -d ${service}`, {
            cwd: root,
            stdio: 'pipe',
            timeout: 60000,
          });
          upSpinner.succeed('Servicios levantados');
        } catch (err: any) {
          upSpinner.fail('Error al levantar: ' + err.message);
          return;
        }

        log.blank();
        log.success('Rebuild completado');

        // Mostrar URLs
        const envPath = path.join(root, '.env');
        const env = readEnv(envPath);
        const host = env.HOST || 'localhost';
        const webPort = env.WEB_PORT || '8080';
        const serverPort = env.SERVER_PORT || '3000';
        log.info(`Web: ${chalk.cyan(`http://${host}:${webPort}`)}`);
        log.info(`API: ${chalk.cyan(`http://${host}:${serverPort}`)}`);
      } catch (err: any) {
        log.error(err.message);
        process.exitCode = 1;
      }
    });

  // ── openfactu logs ──
  program
    .command('logs')
    .description('Muestra los logs de los servicios Docker')
    .option('--service <name>', 'Logs de un servicio especifico (web, server, db)')
    .option('-n, --lines <number>', 'Numero de lineas', '50')
    .option('--with-monitoring', 'Incluir servicios de monitoreo')
    .action(async (opts) => {
      try {
        const root = getProjectRoot();
        const prodCompose = path.join(root, 'docker-compose.prod.yml');
        const composeFile = fs.existsSync(prodCompose) ? 'docker-compose.prod.yml' : 'docker-compose.yml';
        const monitoringCompose = path.join(root, 'docker-compose.prod.monitoring.yml');
        const useMonitoring = opts.withMonitoring && fs.existsSync(monitoringCompose);

        const service = opts.service || '';
        const lines = opts.lines || '50';

        const files = useMonitoring
          ? `-f ${composeFile} -f docker-compose.prod.monitoring.yml`
          : `-f ${composeFile}`;

        execSync(`docker compose ${files} logs --tail ${lines} ${service}`, {
          cwd: root,
          stdio: 'inherit',
        });
      } catch (err: any) {
        log.error(err.message);
      }
    });

  // ── openfactu stop ──
  program
    .command('stop')
    .description('Para todos los servicios Docker')
    .option('--with-monitoring', 'Incluir servicios de monitoreo')
    .action(async (opts) => {
      try {
        const root = getProjectRoot();
        const prodCompose = path.join(root, 'docker-compose.prod.yml');
        const composeFile = fs.existsSync(prodCompose) ? 'docker-compose.prod.yml' : 'docker-compose.yml';
        const monitoringCompose = path.join(root, 'docker-compose.prod.monitoring.yml');
        const useMonitoring = opts.withMonitoring && fs.existsSync(monitoringCompose);

        const files = useMonitoring
          ? `-f ${composeFile} -f docker-compose.prod.monitoring.yml`
          : `-f ${composeFile}`;

        const spinner = ora('Parando servicios...').start();
        execSync(`docker compose ${files} down`, { cwd: root, stdio: 'pipe' });
        spinner.succeed('Servicios parados');
      } catch (err: any) {
        log.error(err.message);
      }
    });

  // ── openfactu restart ──
  program
    .command('restart')
    .description('Reinicia los servicios Docker (sin rebuild)')
    .option('--service <name>', 'Reiniciar solo un servicio')
    .option('--with-monitoring', 'Incluir servicios de monitoreo')
    .action(async (opts) => {
      try {
        const root = getProjectRoot();
        const prodCompose = path.join(root, 'docker-compose.prod.yml');
        const composeFile = fs.existsSync(prodCompose) ? 'docker-compose.prod.yml' : 'docker-compose.yml';
        const monitoringCompose = path.join(root, 'docker-compose.prod.monitoring.yml');
        const useMonitoring = opts.withMonitoring && fs.existsSync(monitoringCompose);

        const files = useMonitoring
          ? `-f ${composeFile} -f docker-compose.prod.monitoring.yml`
          : `-f ${composeFile}`;

        const service = opts.service || '';
        const spinner = ora('Reiniciando...').start();
        execSync(`docker compose ${files} restart ${service}`, { cwd: root, stdio: 'pipe' });
        spinner.succeed('Servicios reiniciados');
      } catch (err: any) {
        log.error(err.message);
      }
    });
}
