import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  generatePassword,
  generateSlug,
  formatBytes,
  timestamp,
  ensureDir,
  copyDirRecursive,
  isLinux,
  getDockerComposeCommand,
} from '../src/utils/helpers';

const testDir = path.join(os.tmpdir(), 'openfactu-test-' + Date.now());

describe('generatePassword', () => {
  it('genera un password de longitud correcta', () => {
    expect(generatePassword(16)).toHaveLength(16);
    expect(generatePassword(32)).toHaveLength(32);
    expect(generatePassword(48)).toHaveLength(48);
  });

  it('genera passwords diferentes cada vez', () => {
    const passwords = new Set();
    for (let i = 0; i < 10; i++) {
      passwords.add(generatePassword(24));
    }
    expect(passwords.size).toBe(10);
  });

  it('incluye caracteres variados', () => {
    const password = generatePassword(100);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[!@#$%^&*]/);
  });

  it('usa longitud por defecto de 32', () => {
    expect(generatePassword()).toHaveLength(32);
  });
});

describe('generateSlug', () => {
  it('genera un slug de longitud correcta', () => {
    expect(generateSlug(12)).toHaveLength(12);
    expect(generateSlug(24)).toHaveLength(24);
  });

  it('genera solo caracteres hexadecimales', () => {
    const slug = generateSlug(20);
    expect(slug).toMatch(/^[a-f0-9]+$/);
  });

  it('genera slugs diferentes cada vez', () => {
    const slugs = new Set();
    for (let i = 0; i < 10; i++) {
      slugs.add(generateSlug(12));
    }
    expect(slugs.size).toBe(10);
  });
});

describe('formatBytes', () => {
  it('formatea bytes correctamente', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(1073741824)).toBe('1 GB');
  });

  it('formatea valores intermedios', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

describe('timestamp', () => {
  it('genera un string con formato ISO sin caracteres invalidos', () => {
    const ts = timestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });

  it('genera timestamps con formato valido', () => {
    const ts = timestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    expect(ts.length).toBe(19);
  });
});

describe('ensureDir', () => {
  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('crea un directorio si no existe', () => {
    const newDir = path.join(testDir, 'new-dir');
    ensureDir(newDir);
    expect(fs.existsSync(newDir)).toBe(true);
    expect(fs.statSync(newDir).isDirectory()).toBe(true);
  });

  it('no falla si el directorio ya existe', () => {
    const newDir = path.join(testDir, 'existing-dir');
    fs.mkdirSync(newDir, { recursive: true });
    expect(() => ensureDir(newDir)).not.toThrow();
  });

  it('crea directorios anidados', () => {
    const nestedDir = path.join(testDir, 'a', 'b', 'c');
    ensureDir(nestedDir);
    expect(fs.existsSync(nestedDir)).toBe(true);
  });
});

describe('copyDirRecursive', () => {
  const srcDir = path.join(testDir, 'src');
  const destDir = path.join(testDir, 'dest');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'file1.txt'), 'content1');
    fs.writeFileSync(path.join(srcDir, 'file2.txt'), 'content2');
    fs.mkdirSync(path.join(srcDir, 'subdir'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'subdir', 'file3.txt'), 'content3');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('copia directorio completo recursivamente', () => {
    copyDirRecursive(srcDir, destDir);

    expect(fs.existsSync(path.join(destDir, 'file1.txt'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'file2.txt'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'subdir', 'file3.txt'))).toBe(true);

    expect(fs.readFileSync(path.join(destDir, 'file1.txt'), 'utf-8')).toBe('content1');
    expect(fs.readFileSync(path.join(destDir, 'subdir', 'file3.txt'), 'utf-8')).toBe('content3');
  });

  it('crea el directorio destino si no existe', () => {
    copyDirRecursive(srcDir, destDir);
    expect(fs.existsSync(destDir)).toBe(true);
  });
});

describe('isLinux', () => {
  it('devuelve booleano', () => {
    const result = isLinux();
    expect(typeof result).toBe('boolean');
  });
});

describe('getDockerComposeCommand', () => {
  it('devuelve un string', () => {
    const result = getDockerComposeCommand();
    expect(typeof result).toBe('string');
    expect(result === 'docker compose' || result === 'docker-compose').toBe(true);
  });
});
