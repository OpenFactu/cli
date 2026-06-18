/**
 * Aplica un conjunto de overrides (clave=valor) sobre el contenido de un .env,
 * preservando comentarios y orden del archivo base.
 *
 *  - Si la clave ya existe, reemplaza solo su valor.
 *  - Si no existe, la añade al final.
 *
 * A diferencia de un merge ingenuo, opera sobre una única cadena acumulada para
 * no duplicar el contenido del archivo en cada iteración.
 */
export function applyEnvOverrides(baseContent: string, overrides: Record<string, string>): string {
  let content = baseContent;
  for (const [key, value] of Object.entries(overrides)) {
    const re = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm');
    // Usamos la forma de función en replace para que '$' en el valor no se
    // interprete como referencia de captura ($1, $&, $$...).
    if (re.test(content)) {
      content = content.replace(re, () => `${key}=${value}`);
    } else {
      content = content.trimEnd() + `\n${key}=${value}`;
    }
  }
  return content.endsWith('\n') ? content : content + '\n';
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
