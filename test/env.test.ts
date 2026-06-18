import { describe, it, expect } from 'vitest';
import { applyEnvOverrides } from '../src/utils/env';

describe('applyEnvOverrides', () => {
  it('reemplaza el valor de una clave existente sin duplicar el archivo', () => {
    const base = [
      '# comentario',
      'POSTGRES_USER=openfactu',
      'POSTGRES_PASSWORD=viejo',
      'POSTGRES_DB=openfactudb',
    ].join('\n');

    const out = applyEnvOverrides(base, { POSTGRES_PASSWORD: 'nuevo' });

    // La clave se actualiza...
    expect(out).toContain('POSTGRES_PASSWORD=nuevo');
    expect(out).not.toContain('POSTGRES_PASSWORD=viejo');
    // ...y solo aparece UNA vez (el bug original la duplicaba).
    expect(out.match(/^POSTGRES_PASSWORD=/gm)).toHaveLength(1);
    // El resto del archivo se preserva (comentarios y otras claves).
    expect(out).toContain('# comentario');
    expect(out).toContain('POSTGRES_USER=openfactu');
  });

  it('añade claves que no existían', () => {
    const base = 'POSTGRES_USER=openfactu\n';
    const out = applyEnvOverrides(base, { JWT_SECRET: 'abc123' });
    expect(out).toContain('POSTGRES_USER=openfactu');
    expect(out).toContain('JWT_SECRET=abc123');
  });

  it('aplica varios overrides sin duplicar contenido', () => {
    const base = 'A=1\nB=2\nC=3\n';
    const out = applyEnvOverrides(base, { A: 'x', B: 'y', D: 'w' });
    expect(out.match(/^A=/gm)).toHaveLength(1);
    expect(out.match(/^B=/gm)).toHaveLength(1);
    expect(out).toContain('A=x');
    expect(out).toContain('B=y');
    expect(out).toContain('C=3');
    expect(out).toContain('D=w');
    // No se ha multiplicado el contenido base.
    expect(out.match(/^C=3$/gm)).toHaveLength(1);
  });

  it('preserva valores con caracteres especiales (% de una URL codificada)', () => {
    const base = 'DATABASE_URL=old\n';
    const url = 'postgresql://openfactu:p%40ss%23word@db:5432/openfactudb';
    const out = applyEnvOverrides(base, { DATABASE_URL: url });
    expect(out).toContain(`DATABASE_URL=${url}`);
  });

  it('no rompe si el valor contiene "$" (no se interpreta como referencia)', () => {
    const out = applyEnvOverrides('K=old\n', { K: 'a$b$1c' });
    expect(out).toContain('K=a$b$1c');
  });

  it('termina siempre con salto de línea', () => {
    expect(applyEnvOverrides('A=1', { B: '2' }).endsWith('\n')).toBe(true);
  });
});
