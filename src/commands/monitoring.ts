import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger';
import { getProjectRoot, getMonitoringComposePath } from '../utils/paths';

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

function getComposeFile(root: string): string {
  const monitoringCompose = getMonitoringComposePath();
  if (fs.existsSync(monitoringCompose)) {
    return monitoringCompose;
  }
  throw new Error('No se encontró docker-compose.monitoring.yml. Asegúrate de estar en el repo de OpenFactu.');
}

export function registerMonitoringCommand(program: Command) {
  // ── openfactu monitoring ──
  program
    .command('monitoring')
    .description('Configura el stack de monitoreo (pgAdmin, Grafana, Prometheus, Portainer)')
    .action(async () => {
      console.log();
      console.log(chalk.bold.white('  OpenFactu — Configurar Monitoreo'));
      console.log(chalk.dim('  ────────────────────────────────────'));
      console.log();

      try {
        const root = getProjectRoot();
        const envPath = path.join(root, '.env');
        const composeFile = getComposeFile(root);

        const env = readEnv(envPath);

        // Preguntar qué servicios activar
        const { services } = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'services',
            message: 'Servicios a activar:',
            choices: [
              { name: 'pgAdmin (gestión BD)', value: 'pgadmin', checked: true },
              { name: 'Grafana (dashboards)', value: 'grafana', checked: true },
              { name: 'Prometheus (métricas)', value: 'prometheus', checked: true },
              { name: 'Loki (logs)', value: 'loki', checked: true },
              { name: 'cAdvisor (métricas contenedores)', value: 'cadvisor', checked: false },
              { name: 'Node Exporter (métricas host)', value: 'node-exporter', checked: false },
              { name: 'Portainer (gestión Docker)', value: 'portainer', checked: true },
            ],
          },
        ]);

        const serviceSet = new Set(services);

        // Preguntar puertos
        const { customizePorts } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'customizePorts',
            message: '¿Personalizar puertos?',
            default: false,
          },
        ]);

        const ports: Record<string, string> = {};
        if (customizePorts) {
          const portQuestions = [];
          if (serviceSet.has('pgadmin')) {
            portQuestions.push({ type: 'input', name: 'PGADMIN_PORT', message: 'Puerto pgAdmin:', default: env.PGADMIN_PORT || '5050' });
          }
          if (serviceSet.has('grafana')) {
            portQuestions.push({ type: 'input', name: 'GRAFANA_PORT', message: 'Puerto Grafana:', default: env.GRAFANA_PORT || '3001' });
          }
          if (serviceSet.has('prometheus')) {
            portQuestions.push({ type: 'input', name: 'PROMETHEUS_PORT', message: 'Puerto Prometheus:', default: env.PROMETHEUS_PORT || '9090' });
          }
          if (serviceSet.has('portainer')) {
            portQuestions.push({ type: 'input', name: 'PORTAINER_PORT', message: 'Puerto Portainer:', default: env.PORTAINER_PORT || '9000' });
          }
          if (portQuestions.length > 0) {
            const answers = await inquirer.prompt(portQuestions);
            Object.assign(ports, answers);
          }
        }

        // Preguntar credenciales
        const { customizeCredentials } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'customizeCredentials',
            message: '¿Personalizar credenciales?',
            default: false,
          },
        ]);

        if (customizeCredentials) {
          if (serviceSet.has('pgadmin')) {
            const creds = await inquirer.prompt([
              { type: 'input', name: 'PGADMIN_EMAIL', message: 'Email pgAdmin:', default: env.PGADMIN_EMAIL || 'admin@openfactu.local' },
              { type: 'password', name: 'PGADMIN_PASSWORD', message: 'Password pgAdmin:', default: env.PGADMIN_PASSWORD || 'admin' },
            ]);
            Object.assign(ports, creds);
          }
          if (serviceSet.has('grafana')) {
            const creds = await inquirer.prompt([
              { type: 'input', name: 'GRAFANA_USER', message: 'Usuario Grafana:', default: env.GRAFANA_USER || 'admin' },
              { type: 'password', name: 'GRAFANA_PASSWORD', message: 'Password Grafana:', default: env.GRAFANA_PASSWORD || 'admin' },
            ]);
            Object.assign(ports, creds);
          }
        }

        // Guardar en .env
        const envSpinner = ora('Guardando configuración...').start();
        for (const [key, value] of Object.entries(ports)) {
          env[key] = value;
        }
        // Guardar servicios activos
        env.MONITORING_SERVICES = services.join(',');
        writeEnv(envPath, env);
        envSpinner.succeed('Configuración guardada en .env');

        // Preguntar si levantar
        log.blank();
        const { start } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'start',
            message: '¿Levantar los servicios de monitoreo ahora?',
            default: true,
          },
        ]);

        if (start) {
          const upSpinner = ora('Levantando servicios de monitoreo...').start();
          try {
            const scaleFlags = [];
            const allServices = ['pgadmin', 'grafana', 'prometheus', 'loki', 'cadvisor', 'node-exporter', 'portainer'];
            for (const svc of allServices) {
              scaleFlags.push(`--scale ${svc}=${serviceSet.has(svc) ? 1 : 0}`);
            }
            execSync(
              `docker compose -f ${composeFile} up -d ${scaleFlags.join(' ')}`,
              { cwd: root, stdio: 'pipe', timeout: 120000 }
            );
            upSpinner.succeed('Servicios de monitoreo levantados');
          } catch (err: any) {
            upSpinner.fail('Error: ' + err.message);
          }
        }

        log.blank();
        console.log(chalk.bold.green('  Monitoreo configurado'));
        console.log(chalk.dim('  ────────────────────────────────────'));
        if (serviceSet.has('pgadmin')) log.info(`pgAdmin:     http://localhost:${env.PGADMIN_PORT || '5050'}`);
        if (serviceSet.has('grafana')) log.info(`Grafana:     http://localhost:${env.GRAFANA_PORT || '3001'}`);
        if (serviceSet.has('prometheus')) log.info(`Prometheus:  http://localhost:${env.PROMETHEUS_PORT || '9090'}`);
        if (serviceSet.has('portainer')) log.info(`Portainer:   http://localhost:${env.PORTAINER_PORT || '9000'}`);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exitCode = 1;
      }
    });

  // ── openfactu monitoring:up ──
  program
    .command('monitoring:up')
    .description('Levanta los servicios de monitoreo')
    .action(async () => {
      try {
        const root = getProjectRoot();
        const composeFile = getComposeFile(root);
        const envPath = path.join(root, '.env');
        const env = readEnv(envPath);
        const services = (env.MONITORING_SERVICES || 'pgadmin,grafana,prometheus,loki,portainer').split(',');
        const serviceSet = new Set(services);

        const spinner = ora('Levantando servicios de monitoreo...').start();
        try {
          const scaleFlags = [];
          const allServices = ['pgadmin', 'grafana', 'prometheus', 'loki', 'cadvisor', 'node-exporter', 'portainer'];
          for (const svc of allServices) {
            scaleFlags.push(`--scale ${svc}=${serviceSet.has(svc) ? 1 : 0}`);
          }
          execSync(
            `docker compose -f ${composeFile} up -d ${scaleFlags.join(' ')}`,
            { cwd: root, stdio: 'pipe', timeout: 120000 }
          );
          spinner.succeed('Servicios de monitoreo levantados');
        } catch (err: any) {
          spinner.fail('Error: ' + err.message);
        }
      } catch (err: any) {
        log.error(err.message);
        process.exitCode = 1;
      }
    });

  // ── openfactu monitoring:down ──
  program
    .command('monitoring:down')
    .description('Para los servicios de monitoreo')
    .action(async () => {
      try {
        const root = getProjectRoot();
        const composeFile = getComposeFile(root);

        const spinner = ora('Parando servicios de monitoreo...').start();
        execSync(`docker compose -f ${composeFile} down`, { cwd: root, stdio: 'pipe' });
        spinner.succeed('Servicios de monitoreo parados');
      } catch (err: any) {
        log.error(err.message);
        process.exitCode = 1;
      }
    });

  // ── openfactu monitoring:status ──
  program
    .command('monitoring:status')
    .description('Muestra el estado de los servicios de monitoreo')
    .action(async () => {
      try {
        const root = getProjectRoot();
        const composeFile = getComposeFile(root);

        const output = execSync(`docker compose -f ${composeFile} ps`, { cwd: root }).toString();
        console.log(output);

        const envPath = path.join(root, '.env');
        const env = readEnv(envPath);
        log.blank();
        if (env.PGADMIN_PORT) log.info(`pgAdmin:    http://localhost:${env.PGADMIN_PORT}`);
        if (env.GRAFANA_PORT) log.info(`Grafana:    http://localhost:${env.GRAFANA_PORT}`);
        if (env.PROMETHEUS_PORT) log.info(`Prometheus: http://localhost:${env.PROMETHEUS_PORT}`);
        if (env.PORTAINER_PORT) log.info(`Portainer:  http://localhost:${env.PORTAINER_PORT}`);
      } catch (err: any) {
        log.error('Servicios de monitoreo no disponibles');
        log.dim('  ' + err.message);
      }
    });

  // ── openfactu monitoring:config ──
  program
    .command('monitoring:config')
    .description('Cambia la configuración de puertos/servicios del monitoreo')
    .action(async () => {
      try {
        const root = getProjectRoot();
        const envPath = path.join(root, '.env');
        const env = readEnv(envPath);

        const { key } = await inquirer.prompt([
          {
            type: 'list',
            name: 'key',
            message: 'Variable a cambiar:',
            choices: [
              { name: `PGADMIN_PORT (${env.PGADMIN_PORT || '5050'})`, value: 'PGADMIN_PORT' },
              { name: `GRAFANA_PORT (${env.GRAFANA_PORT || '3001'})`, value: 'GRAFANA_PORT' },
              { name: `PROMETHEUS_PORT (${env.PROMETHEUS_PORT || '9090'})`, value: 'PROMETHEUS_PORT' },
              { name: `PORTAINER_PORT (${env.PORTAINER_PORT || '9000'})`, value: 'PORTAINER_PORT' },
              { name: `PGADMIN_EMAIL (${env.PGADMIN_EMAIL || 'admin@openfactu.local'})`, value: 'PGADMIN_EMAIL' },
              { name: `GRAFANA_USER (${env.GRAFANA_USER || 'admin'})`, value: 'GRAFANA_USER' },
            ],
          },
        ]);

        const { value } = await inquirer.prompt([
          { type: 'input', name: 'value', message: `Nuevo valor para ${key}:`, default: env[key] },
        ]);

        env[key] = value;
        writeEnv(envPath, env);
        log.success(`${key} actualizado a: ${value}`);
        log.info('Reinicia los servicios con: openfactu monitoring:down && openfactu monitoring:up');
      } catch (err: any) {
        log.error(err.message);
        process.exitCode = 1;
      }
    });
}
