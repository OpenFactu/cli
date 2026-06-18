import { describe, it, expect } from 'vitest';
import { resolveHostDatabaseUrl } from '../src/utils/config';

describe('resolveHostDatabaseUrl', () => {
  it('reescribe el host de Docker "db" a 127.0.0.1 para el CLI del host', () => {
    const out = resolveHostDatabaseUrl('postgresql://openfactu:1234@db:5432/openfactudb');
    expect(out).toBe('postgresql://openfactu:1234@127.0.0.1:5432/openfactudb');
  });

  it('usa el puerto publicado DB_PORT cuando se remapea', () => {
    const out = resolveHostDatabaseUrl('postgresql://openfactu:1234@db:5432/openfactudb', '5433');
    expect(out).toBe('postgresql://openfactu:1234@127.0.0.1:5433/openfactudb');
  });

  it('preserva la contraseña (incluida la codificada en URL)', () => {
    const out = resolveHostDatabaseUrl('postgresql://openfactu:p%40ss%23word@db:5432/openfactudb');
    const u = new URL(out);
    expect(u.password).toBe('p%40ss%23word');
    expect(decodeURIComponent(u.password)).toBe('p@ss#word');
    expect(u.hostname).toBe('127.0.0.1');
  });

  it('no toca una URL que ya apunta a localhost', () => {
    const url = 'postgresql://openfactu:1234@localhost:5432/openfactudb';
    expect(resolveHostDatabaseUrl(url)).toBe(url);
  });

  it('no toca una URL que apunta a una IP/host externo', () => {
    const url = 'postgresql://openfactu:1234@10.0.0.5:5432/openfactudb';
    expect(resolveHostDatabaseUrl(url)).toBe(url);
  });

  it('devuelve la cadena tal cual si no es una URL válida', () => {
    expect(resolveHostDatabaseUrl('no-es-una-url')).toBe('no-es-una-url');
  });
});
