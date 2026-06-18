import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export interface SystemCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export function generatePassword(length = 32): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let result = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export function generateSlug(length = 12): string {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

export function checkDiskSpace(dir: string): { availableGB: number; totalGB: number } {
  try {
    const output = execSync(`df -BG "${dir}" | tail -1`, { stdio: 'pipe' }).toString();
    const parts = output.trim().split(/\s+/);
    return {
      availableGB: parseInt(parts[3]) || 0,
      totalGB: parseInt(parts[1]) || 0,
    };
  } catch {
    return { availableGB: 0, totalGB: 0 };
  }
}

export function checkPortInUse(port: number): boolean {
  try {
    execSync(`lsof -i :${port} -sTCP:LISTEN`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function getRunningServices(): string[] {
  try {
    const output = execSync('docker compose ps --services 2>/dev/null || docker-compose ps --services 2>/dev/null', {
      stdio: 'pipe',
    }).toString();
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export function runPreflightChecks(targetDir?: string): SystemCheck[] {
  const checks: SystemCheck[] = [];

  // Node.js version
  try {
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0]);
    if (major >= 18) {
      checks.push({ name: 'Node.js', status: 'pass', message: `${version}` });
    } else {
      checks.push({ name: 'Node.js', status: 'warn', message: `${version} (recomendado >= 18)` });
    }
  } catch {
    checks.push({ name: 'Node.js', status: 'fail', message: 'No detectado' });
  }

  // Git
  try {
    const version = execSync('git --version', { stdio: 'pipe' }).toString().trim();
    checks.push({ name: 'Git', status: 'pass', message: version });
  } catch {
    checks.push({ name: 'Git', status: 'fail', message: 'No instalado' });
  }

  // Docker
  try {
    const version = execSync('docker --version', { stdio: 'pipe' }).toString().trim();
    checks.push({ name: 'Docker', status: 'pass', message: version });
  } catch {
    checks.push({ name: 'Docker', status: 'fail', message: 'No instalado' });
  }

  // Docker Compose
  try {
    let version = '';
    try {
      version = execSync('docker compose version', { stdio: 'pipe' }).toString().trim();
    } catch {
      version = execSync('docker-compose --version', { stdio: 'pipe' }).toString().trim();
    }
    checks.push({ name: 'Docker Compose', status: 'pass', message: version });
  } catch {
    checks.push({ name: 'Docker Compose', status: 'fail', message: 'No instalado' });
  }

  // Disk space
  if (targetDir) {
    const dir = path.dirname(targetDir);
    if (fs.existsSync(dir)) {
      const disk = checkDiskSpace(dir);
      if (disk.availableGB >= 10) {
        checks.push({ name: 'Disco disponible', status: 'pass', message: `${disk.availableGB}GB libres` });
      } else if (disk.availableGB >= 5) {
        checks.push({ name: 'Disco disponible', status: 'warn', message: `${disk.availableGB}GB libres (minimo 5GB)` });
      } else {
        checks.push({ name: 'Disco disponible', status: 'fail', message: `${disk.availableGB}GB libres (minimo 5GB)` });
      }
    }
  }

  // Port conflicts
  const commonPorts = [
    { port: 5432, name: 'PostgreSQL' },
    { port: 8080, name: 'Web' },
    { port: 3000, name: 'API Server' },
    { port: 9090, name: 'Prometheus' },
    { port: 3001, name: 'Grafana' },
    { port: 5050, name: 'pgAdmin' },
    { port: 9000, name: 'Portainer' },
  ];

  const conflictedPorts = commonPorts.filter(p => checkPortInUse(p.port));
  if (conflictedPorts.length === 0) {
    checks.push({ name: 'Puertos', status: 'pass', message: 'Sin conflictos' });
  } else {
    const portList = conflictedPorts.map(p => `${p.name}:${p.port}`).join(', ');
    checks.push({ name: 'Puertos', status: 'warn', message: `En uso: ${portList}` });
  }

  // OS info
  checks.push({ name: 'Sistema', status: 'pass', message: `${os.type()} ${os.release()} (${os.arch()})` });

  return checks;
}

export function waitForService(
  url: string,
  maxAttempts = 30,
  intervalMs = 2000,
): Promise<boolean> {
  return new Promise((resolve) => {
    let attempts = 0;
    const http = url.startsWith('https') ? require('https') : require('http');

    const check = () => {
      attempts++;
      const req = http.get(url, { timeout: 3000 }, (res) => {
        if (res.statusCode) {
          resolve(true);
        } else {
          retry();
        }
      });

      req.on('error', () => {
        if (attempts >= maxAttempts) {
          resolve(false);
        } else {
          retry();
        }
      });

      req.on('timeout', () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      setTimeout(check, intervalMs);
    };

    check();
  });
}

export function getDockerComposeCommand(): string {
  try {
    execSync('docker compose version', { stdio: 'pipe' });
    return 'docker compose';
  } catch {
    return 'docker-compose';
  }
}

export function isLinux(): boolean {
  return os.platform() === 'linux';
}

export function isSystemdAvailable(): boolean {
  if (!isLinux()) return false;
  try {
    const pid = execSync('cat /run/systemd/system 2>/dev/null && echo 1 || echo 0', { stdio: 'pipe' }).toString().trim();
    return pid === '1' || fs.existsSync('/run/systemd/system');
  } catch {
    return false;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function copyDirRecursive(src: string, dest: string): void {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
