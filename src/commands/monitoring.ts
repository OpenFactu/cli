import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger';
import { getProjectRoot } from '../utils/paths';
import { getDockerComposeCommand } from '../utils/helpers';
import {
  ALL_MONITORING_SERVICES,
  monitoringChoices,
  basicMonitoringServices,
  fullMonitoringServices,
  generateMonitoringCompose,
  writeMonitoringConfigs,
} from '../utils/monitoring';

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

export function registerMonitoringCommand(program: Command) {
  // ── openfactu monitoring ──
  program
    .command('monitoring')
    .description('Configura el stack de monitoreo y analitica')
    .option('--generate-compose', 'Generar docker-compose.monitoring.yml')
    .option('--with-analytics', 'Incluir stack completo de analitica')
    .action(async (opts) => {
      console.log();
      console.log(chalk.bold.white('  OpenFactu — Configurar Monitoreo'));
      console.log(chalk.dim('  ────────────────────────────────────'));
      console.log();

      try {
        const root = getProjectRoot();
        const envPath = path.join(root, '.env');
        const env = readEnv(envPath);

        const includeAnalytics = opts.withAnalytics || false;

        const { services } = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'services',
            message: 'Servicios a activar:',
            choices: monitoringChoices({ analytics: includeAnalytics }),
          },
        ]);

        const serviceSet = new Set<string>(services as string[]);

        const { customizePorts } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'customizePorts',
            message: 'Personalizar puertos?',
            default: false,
          },
        ]);

        const ports: Record<string, string> = {};
        if (customizePorts) {
          const portQuestions = [];
          if (serviceSet.has('pgadmin')) portQuestions.push({ type: 'input', name: 'PGADMIN_PORT', message: 'Puerto pgAdmin:', default: env.PGADMIN_PORT || '5050' });
          if (serviceSet.has('grafana')) portQuestions.push({ type: 'input', name: 'GRAFANA_PORT', message: 'Puerto Grafana:', default: env.GRAFANA_PORT || '3001' });
          if (serviceSet.has('prometheus')) portQuestions.push({ type: 'input', name: 'PROMETHEUS_PORT', message: 'Puerto Prometheus:', default: env.PROMETHEUS_PORT || '9090' });
          if (serviceSet.has('loki')) portQuestions.push({ type: 'input', name: 'LOKI_PORT', message: 'Puerto Loki:', default: env.LOKI_PORT || '3100' });
          if (serviceSet.has('cadvisor')) portQuestions.push({ type: 'input', name: 'CADVISOR_PORT', message: 'Puerto cAdvisor:', default: env.CADVISOR_PORT || '8081' });
          if (serviceSet.has('node-exporter')) portQuestions.push({ type: 'input', name: 'NODE_EXPORTER_PORT', message: 'Puerto Node Exporter:', default: env.NODE_EXPORTER_PORT || '9100' });
          if (serviceSet.has('portainer')) portQuestions.push({ type: 'input', name: 'PORTAINER_PORT', message: 'Puerto Portainer:', default: env.PORTAINER_PORT || '9000' });
          if (serviceSet.has('alertmanager')) portQuestions.push({ type: 'input', name: 'ALERTMANAGER_PORT', message: 'Puerto Alertmanager:', default: env.ALERTMANAGER_PORT || '9093' });

          if (portQuestions.length > 0) {
            const answers = await inquirer.prompt(portQuestions);
            Object.assign(ports, answers);
          }
        }

        const { customizeCredentials } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'customizeCredentials',
            message: 'Personalizar credenciales?',
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

        // Generate compose file
        if (opts.generateCompose) {
          const composeSpinner = ora('Generando docker-compose.monitoring.yml...').start();
          const composeContent = generateMonitoringCompose(serviceSet);
          const composePath = path.join(root, 'docker-compose.monitoring.yml');
          fs.writeFileSync(composePath, composeContent);
          composeSpinner.succeed('docker-compose.monitoring.yml generado');

          writeMonitoringConfigs(root, serviceSet);
        }

        // Save config
        const envSpinner = ora('Guardando configuracion...').start();
        for (const [key, value] of Object.entries(ports)) {
          env[key] = value;
        }
        env.MONITORING_SERVICES = services.join(',');
        writeEnv(envPath, env);
        envSpinner.succeed('Configuracion guardada en .env');

        log.blank();
        const { start } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'start',
            message: 'Levantar los servicios de monitoreo ahora?',
            default: true,
          },
        ]);

        if (start) {
          const dockerCmd = getDockerComposeCommand();
          const composePath = path.join(root, 'docker-compose.monitoring.yml');

          if (!fs.existsSync(composePath)) {
            log.warn('docker-compose.monitoring.yml no existe');
            log.dim('  Ejecuta: openfactu monitoring --generate-compose');
            return;
          }

          const upSpinner = ora('Levantando servicios...').start();
          try {
            const scaleFlags = [];
            for (const svc of ALL_MONITORING_SERVICES) {
              scaleFlags.push(`--scale ${svc}=${serviceSet.has(svc) ? 1 : 0}`);
            }
            execSync(
              `${dockerCmd} -f docker-compose.monitoring.yml up -d ${scaleFlags.join(' ')}`,
              { cwd: root, stdio: 'pipe', timeout: 120000 },
            );
            upSpinner.succeed('Servicios levantados');
          } catch (err: any) {
            upSpinner.fail('Error: ' + err.message);
          }
        }

        log.blank();
        console.log(chalk.bold.green('  Monitoreo configurado'));
        console.log(chalk.dim('  ────────────────────────────────────'));
        log.blank();

        const urls: [string, string][] = [];
        if (serviceSet.has('pgadmin')) urls.push(['pgAdmin', `http://localhost:${env.PGADMIN_PORT || '5050'}`]);
        if (serviceSet.has('grafana')) urls.push(['Grafana', `http://localhost:${env.GRAFANA_PORT || '3001'}`]);
        if (serviceSet.has('prometheus')) urls.push(['Prometheus', `http://localhost:${env.PROMETHEUS_PORT || '9090'}`]);
        if (serviceSet.has('loki')) urls.push(['Loki', `http://localhost:${env.LOKI_PORT || '3100'}`]);
        if (serviceSet.has('cadvisor')) urls.push(['cAdvisor', `http://localhost:${env.CADVISOR_PORT || '8081'}`]);
        if (serviceSet.has('node-exporter')) urls.push(['Node Exporter', `http://localhost:${env.NODE_EXPORTER_PORT || '9100'}`]);
        if (serviceSet.has('portainer')) urls.push(['Portainer', `http://localhost:${env.PORTAINER_PORT || '9000'}`]);
        if (serviceSet.has('alertmanager')) urls.push(['Alertmanager', `http://localhost:${env.ALERTMANAGER_PORT || '9093'}`]);

        for (const [name, url] of urls) {
          log.info(`${chalk.dim(name.padEnd(15))} ${chalk.cyan(url)}`);
        }

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
        const dockerCmd = getDockerComposeCommand();
        const composeFile = path.join(root, 'docker-compose.monitoring.yml');

        if (!fs.existsSync(composeFile)) {
          log.error('docker-compose.monitoring.yml no encontrado');
          log.dim('  Ejecuta: openfactu monitoring --generate-compose');
          return;
        }

        const envPath = path.join(root, '.env');
        const env = readEnv(envPath);
        const services = (env.MONITORING_SERVICES || 'pgadmin,grafana,prometheus,loki,portainer').split(',');
        const serviceSet = new Set<string>(services as string[]);

        const spinner = ora('Levantando servicios...').start();
        const scaleFlags = [];
        for (const svc of ALL_MONITORING_SERVICES) {
          scaleFlags.push(`--scale ${svc}=${serviceSet.has(svc) ? 1 : 0}`);
        }
        execSync(
          `${dockerCmd} -f docker-compose.monitoring.yml up -d ${scaleFlags.join(' ')}`,
          { cwd: root, stdio: 'pipe', timeout: 120000 },
        );
        spinner.succeed('Servicios levantados');
      } catch (err: any) {
        log.error(err.message);
      }
    });

  // ── openfactu monitoring:down ──
  program
    .command('monitoring:down')
    .description('Para los servicios de monitoreo')
    .action(async () => {
      try {
        const root = getProjectRoot();
        const dockerCmd = getDockerComposeCommand();

        const spinner = ora('Parando servicios...').start();
        execSync(`${dockerCmd} -f docker-compose.monitoring.yml down`, { cwd: root, stdio: 'pipe' });
        spinner.succeed('Servicios parados');
      } catch (err: any) {
        log.error(err.message);
      }
    });

  // ── openfactu monitoring:status ──
  program
    .command('monitoring:status')
    .description('Estado de los servicios de monitoreo')
    .action(async () => {
      try {
        const root = getProjectRoot();
        const dockerCmd = getDockerComposeCommand();

        const output = execSync(`${dockerCmd} -f docker-compose.monitoring.yml ps`, { cwd: root }).toString();
        console.log(output);

        const envPath = path.join(root, '.env');
        const env = readEnv(envPath);
        log.blank();
        if (env.PGADMIN_PORT) log.info(`pgAdmin:    http://localhost:${env.PGADMIN_PORT}`);
        if (env.GRAFANA_PORT) log.info(`Grafana:    http://localhost:${env.GRAFANA_PORT}`);
        if (env.PROMETHEUS_PORT) log.info(`Prometheus: http://localhost:${env.PROMETHEUS_PORT}`);
        if (env.LOKI_PORT) log.info(`Loki:       http://localhost:${env.LOKI_PORT}`);
        if (env.CADVISOR_PORT) log.info(`cAdvisor:   http://localhost:${env.CADVISOR_PORT}`);
        if (env.NODE_EXPORTER_PORT) log.info(`Node Exp:   http://localhost:${env.NODE_EXPORTER_PORT}`);
        if (env.PORTAINER_PORT) log.info(`Portainer:  http://localhost:${env.PORTAINER_PORT}`);
      } catch (err: any) {
        log.error('Servicios no disponibles');
        log.dim('  ' + err.message);
      }
    });

  // ── openfactu monitoring:config ──
  program
    .command('monitoring:config')
    .description('Cambiar configuracion del monitoreo')
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
              { name: `LOKI_PORT (${env.LOKI_PORT || '3100'})`, value: 'LOKI_PORT' },
              { name: `CADVISOR_PORT (${env.CADVISOR_PORT || '8081'})`, value: 'CADVISOR_PORT' },
              { name: `NODE_EXPORTER_PORT (${env.NODE_EXPORTER_PORT || '9100'})`, value: 'NODE_EXPORTER_PORT' },
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
        log.info('Reinicia con: openfactu monitoring:down && openfactu monitoring:up');
      } catch (err: any) {
        log.error(err.message);
      }
    });

  // ── openfactu monitoring:generate ──
  program
    .command('monitoring:generate')
    .description('Generar docker-compose.monitoring.yml sin interaccion')
    .option('--services <services>', 'Servicios separados por coma')
    .option('--analytics', 'Incluir stack completo de analitica')
    .action(async (opts) => {
      try {
        const root = getProjectRoot();
        const envPath = path.join(root, '.env');
        const env = readEnv(envPath);

        let services: string[];
        if (opts.services) {
          services = opts.services.split(',');
        } else if (opts.analytics) {
          services = fullMonitoringServices();
        } else {
          services = basicMonitoringServices();
        }

        const serviceSet = new Set<string>(services as string[]);
        const composeContent = generateMonitoringCompose(serviceSet);
        const composePath = path.join(root, 'docker-compose.monitoring.yml');
        fs.writeFileSync(composePath, composeContent);

        log.success('docker-compose.monitoring.yml generado');

        writeMonitoringConfigs(root, serviceSet);

        env.MONITORING_SERVICES = services.join(',');
        writeEnv(envPath, env);
      } catch (err: any) {
        log.error(err.message);
      }
    });
}
