import { AppError } from '../errors.js';
import type { Services } from '../services.js';
import { getOrder, type Order, type OrderLine } from './orders.js';

export type OrderExportFormat = 'text' | 'pdf';
export type OrderPaper = 'A4' | '80mm';
export interface OrderExport { body: string | Buffer; contentType: string; filename: string }
interface PageLayout { width: number; height: number; margin: number; font: number; leading: number }

const STATUS_LABELS = {
  draft: 'Brouillon', sent: 'Envoyé', partial: 'Partiellement reçu', received: 'Reçu', cancelled: 'Annulé',
};
const LAYOUTS: Record<OrderPaper, PageLayout> = {
  A4: { width: 595.28, height: 841.89, margin: 36, font: 10, leading: 14 },
  '80mm': { width: 226.77, height: 566.93, margin: 12, font: 9, leading: 12 },
};
// PDF standard Courier with WinAnsiEncoding supports French without an external font or dependency.
const WIN_ANSI: Record<string, number> = {
  '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135,
  'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142,
  '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151,
  '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159,
};

function singleLine(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function pharmacyName(s: Services): string {
  const row = s.db.prepare("SELECT value FROM settings WHERE key = 'pharmacy_name'").get() as
    { value: string } | undefined;
  if (!row?.value.trim()) throw new AppError('setup_required', 'Nom de l’officine non configuré');
  return singleLine(row.value);
}

function headerLines(order: Order, pharmacy: string): string[] {
  const date = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Africa/Douala', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(order.created_at));
  return [pharmacy, `Bon de commande ${order.number}`, `Fournisseur : ${singleLine(order.supplier_name)}`,
    `Date : ${singleLine(date)} (Douala)`, `Statut : ${STATUS_LABELS[order.status]}`, ''];
}

function lineText(line: OrderLine, withCost: boolean): string[] {
  const text = [`${line.qty_ordered} × ${singleLine(line.product_name)}`];
  if (line.strength) text.push(`Dosage : ${singleLine(line.strength)}`);
  if (line.form) text.push(`Forme : ${singleLine(line.form)}`);
  if (line.presentation) text.push(`Présentation : ${singleLine(line.presentation)}`);
  if (withCost && line.unit_cost !== null) {
    const cost = line.unit_cost.toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ');
    text.push(`Coût unitaire : ${cost} XAF`);
  }
  return text;
}

/** Hex strings make delimiters, backslashes and PDF operators inert user text. */
function pdfHex(text: string): string {
  const bytes: number[] = [];
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    const byte = (code >= 32 && code <= 126) || (code >= 160 && code <= 255) ? code : WIN_ANSI[ch];
    if (byte === undefined) {
      throw new AppError('validation_failed', 'Caractère non pris en charge par le PDF',
        'Utilisez l’export texte UTF-8 pour ce libellé ; aucune substitution silencieuse n’est effectuée.',
        { reason: 'pdf_unsupported_character' });
    }
    bytes.push(byte);
  }
  return Buffer.from(bytes).toString('hex');
}

function wrapLine(text: string, columns: number): string[] {
  const chars = [...text.normalize('NFC')];
  if (chars.length === 0) return [''];
  const lines: string[] = [];
  for (let start = 0; start < chars.length; start += columns) {
    lines.push(chars.slice(start, start + columns).join(''));
  }
  return lines;
}

function contentStream(lines: string[], layout: PageLayout, page: number, total: number): string {
  const { margin, height, font, leading } = layout;
  return [`BT /F1 ${font} Tf ${leading} TL ${margin} ${height - margin - font} Td`,
    ...lines.map((line) => `<${pdfHex(line)}> Tj T*`), 'ET',
    `BT /F1 ${font} Tf ${margin} ${margin} Td <${pdfHex(`Page ${page}/${total}`)}> Tj ET`, ''].join('\n');
}

function serializePdf(objects: string[]): Buffer {
  const parts = ['%PDF-1.4\n'];
  const offsets = [0];
  let length = Buffer.byteLength(parts[0]!, 'ascii');
  for (const [i, object] of objects.entries()) {
    offsets.push(length);
    const part = `${i + 1} 0 obj\n${object}\nendobj\n`;
    parts.push(part);
    length += Buffer.byteLength(part, 'ascii');
  }
  const entries = offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  parts.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}`);
  parts.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`);
  return Buffer.from(parts.join(''), 'ascii');
}

/** Real PDF 1.4: standard font, page tree, length-delimited streams, byte offsets and trailer. */
function renderPdf(header: string[], body: string[], paper: OrderPaper): Buffer {
  const layout = LAYOUTS[paper];
  const columns = Math.floor((layout.width - 2 * layout.margin) / (layout.font * 0.6));
  const headings = header.flatMap((line) => wrapLine(line, columns));
  const lines = body.flatMap((line) => wrapLine(line, columns));
  const capacity = Math.floor((layout.height - 2 * layout.margin - layout.font) / layout.leading) - headings.length - 2;
  if (capacity < 1) throw new AppError('validation_failed', 'En-tête trop long pour ce format de papier');
  const pages = Math.max(1, Math.ceil(lines.length / capacity));
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'];
  for (let page = 0; page < pages; page += 1) {
    const stream = contentStream([...headings, ...lines.slice(page * capacity, (page + 1) * capacity)], layout, page + 1, pages);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${layout.width} ${layout.height}]
/Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + page * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream`);
  }
  return serializePdf(objects);
}

/** Text is always cost-free; PDF costs require an explicitly authorized caller. No filesystem or network IO. */
export function exportOrder(
  s: Services, id: string, format: OrderExportFormat, withCost = false, paper: OrderPaper = 'A4',
): OrderExport {
  if (format !== 'text' && format !== 'pdf') throw new AppError('validation_failed', 'Format d’export invalide');
  if (paper !== 'A4' && paper !== '80mm') throw new AppError('validation_failed', 'Format de papier invalide');
  const order = getOrder(s, id, format === 'pdf' && withCost);
  const header = headerLines(order, pharmacyName(s));
  const body = order.lines.flatMap((line) => lineText(line, format === 'pdf' && withCost));
  const filename = order.number.replace(/[^A-Za-z0-9_-]/g, '_');
  return format === 'text'
    ? { body: [...header, ...body, ''].join('\n'), contentType: 'text/plain; charset=utf-8', filename: `${filename}.txt` }
    : { body: renderPdf(header, body, paper), contentType: 'application/pdf', filename: `${filename}.pdf` };
}
