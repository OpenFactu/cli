import { describe, it, expect } from 'vitest';

function generateUnitFile(
  serviceName: string,
  workDir: string,
  composeFile: string,
  options: {
    restartPolicy: string;
    includeMonitoring: boolean;
    monitoringComposeFile?: string;
    user?: string;
    environment?: Record<string, string>;
  },
): string {
  const user = options.user || 'testuser';
  const envFile = `${workDir}/.env`;

  let composeFlags = `-f ${composeFile}`;
  if (options.includeMonitoring && options.monitoringComposeFile) {
    composeFlags += ` -f ${options.monitoringComposeFile}`;
  }

  let envVars = '';
  if (options.environment) {
    for (const [key, value] of Object.entries(options.environment)) {
      envVars += `Environment="${key}=${value}"\n`;
    }
  }

  return `[Unit]
Description=OpenFactu ${serviceName} Service
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${workDir}
User=${user}
ExecStart=docker compose ${composeFlags} up -d
ExecStop=docker compose ${composeFlags} down
ExecReload=docker compose ${composeFlags} restart
Restart=${options.restartPolicy}
RestartSec=30
TimeoutStartSec=300
TimeoutStopSec=120

${envVars}
EnvironmentFile=${envFile}

StandardOutput=journal
StandardError=journal
SyslogIdentifier=${serviceName}

[Install]
WantedBy=multi-user.target
`;
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
REPO_URL="${repoUrl}"
TAG="${tag}"
INSTALL_DIR="${defaultDir}"
MONITORING=${includeMonitoring}
SERVICE=${includeService}

echo "Installing OpenFactu..."
git clone --branch "$TAG" "$REPO_URL" "$INSTALL_DIR"
`;
}

describe('generateUnitFile', () => {
  it('genera un unit file valido con configuracion basica', () => {
    const unit = generateUnitFile('openfactu', '/home/user/openfactu', 'docker-compose.yml', {
      restartPolicy: 'on-failure',
      includeMonitoring: false,
    });

    expect(unit).toContain('[Unit]');
    expect(unit).toContain('[Service]');
    expect(unit).toContain('[Install]');
    expect(unit).toContain('Description=OpenFactu openfactu Service');
    expect(unit).toContain('WorkingDirectory=/home/user/openfactu');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('WantedBy=multi-user.target');
  });

  it('incluye monitoreo cuando se especifica', () => {
    const unit = generateUnitFile('openfactu', '/home/user/openfactu', 'docker-compose.yml', {
      restartPolicy: 'always',
      includeMonitoring: true,
      monitoringComposeFile: 'docker-compose.monitoring.yml',
    });

    expect(unit).toContain('-f docker-compose.yml -f docker-compose.monitoring.yml');
  });

  it('no incluye compose de monitoreo si no se especifica', () => {
    const unit = generateUnitFile('openfactu', '/home/user/openfactu', 'docker-compose.yml', {
      restartPolicy: 'on-failure',
      includeMonitoring: false,
    });

    expect(unit).not.toContain('docker-compose.monitoring.yml');
    expect(unit).toContain('-f docker-compose.yml');
  });

  it('usa el usuario especificado', () => {
    const unit = generateUnitFile('openfactu', '/home/user/openfactu', 'docker-compose.yml', {
      restartPolicy: 'on-failure',
      includeMonitoring: false,
      user: 'deploy',
    });

    expect(unit).toContain('User=deploy');
  });

  it('incluye variables de entorno cuando se proporcionan', () => {
    const unit = generateUnitFile('openfactu', '/home/user/openfactu', 'docker-compose.yml', {
      restartPolicy: 'on-failure',
      includeMonitoring: false,
      environment: {
        NODE_ENV: 'production',
        CUSTOM_VAR: 'value',
      },
    });

    expect(unit).toContain('Environment="NODE_ENV=production"');
    expect(unit).toContain('Environment="CUSTOM_VAR=value"');
  });

  it('incluye EnvironmentFile apuntando al .env', () => {
    const unit = generateUnitFile('openfactu', '/home/user/openfactu', 'docker-compose.yml', {
      restartPolicy: 'on-failure',
      includeMonitoring: false,
    });

    expect(unit).toContain('EnvironmentFile=/home/user/openfactu/.env');
  });

  it('soporta diferentes politicas de reinicio', () => {
    const policies = ['no', 'on-failure', 'always'];

    for (const policy of policies) {
      const unit = generateUnitFile('openfactu', '/home/user/openfactu', 'docker-compose.yml', {
        restartPolicy: policy,
        includeMonitoring: false,
      });

      expect(unit).toContain(`Restart=${policy}`);
    }
  });
});

describe('generateInstallScript', () => {
  it('genera un script bash valido', () => {
    const script = generateInstallScript({
      repoUrl: 'https://github.com/OpenFactu/platform.git',
      tag: 'v1.0.0',
      defaultDir: '/opt/openfactu',
      includeMonitoring: false,
      includeService: false,
    });

    expect(script).toContain('#!/bin/bash');
    expect(script).toContain('REPO_URL=');
    expect(script).toContain('TAG=');
    expect(script).toContain('INSTALL_DIR=');
    expect(script).toContain('git clone');
  });

  it('incluye opciones de monitoreo cuando se especifica', () => {
    const script = generateInstallScript({
      repoUrl: 'https://github.com/OpenFactu/platform.git',
      tag: 'v1.0.0',
      defaultDir: '/opt/openfactu',
      includeMonitoring: true,
      includeService: false,
    });

    expect(script).toContain('MONITORING=true');
  });

  it('incluye opciones de servicio cuando se especifica', () => {
    const script = generateInstallScript({
      repoUrl: 'https://github.com/OpenFactu/platform.git',
      tag: 'v1.0.0',
      defaultDir: '/opt/openfactu',
      includeMonitoring: false,
      includeService: true,
    });

    expect(script).toContain('SERVICE=true');
  });

  it('usa el tag y directorio especificados', () => {
    const script = generateInstallScript({
      repoUrl: 'https://github.com/test/platform.git',
      tag: 'v2.0.0',
      defaultDir: '/custom/path',
      includeMonitoring: false,
      includeService: false,
    });

    expect(script).toContain('TAG="v2.0.0"');
    expect(script).toContain('INSTALL_DIR="/custom/path"');
  });
});
