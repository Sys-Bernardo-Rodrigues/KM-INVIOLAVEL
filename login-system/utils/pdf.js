const PDFDocument = require('pdfkit');

function sanitizeText(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .normalize('NFKC');
}

function formatNumber(n) {
  if (n === null || n === undefined || n === '') return '-';
  const num = Number(n);
  if (!Number.isFinite(num)) return '-';
  return new Intl.NumberFormat('pt-BR').format(num);
}

function formatDateTime(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'medium'
    }).format(d);
  } catch (e) {
    return '-';
  }
}

const MARGIN = 40;

// Larguras base pensadas para A4 retrato; serão escaladas conforme largura disponível
const BASE_COLS = [
  { key: 'veiculo', label: 'Veículo', baseWidth: 170, align: 'left' },
  { key: 'placa', label: 'Placa', baseWidth: 50, align: 'left' },
  { key: 'inicio', label: 'Início', baseWidth: 80, align: 'center' },
  { key: 'km_inicial', label: 'KM Inicial', baseWidth: 50, align: 'right' },
  { key: 'fim', label: 'Fim', baseWidth: 80, align: 'center' },
  { key: 'km_final', label: 'KM Final', baseWidth: 50, align: 'right' },
  { key: 'status', label: 'Status', baseWidth: 35, align: 'left' },
];

function contentWidth(doc) {
  const left = doc.page.margins?.left ?? MARGIN;
  const right = doc.page.margins?.right ?? MARGIN;
  return doc.page.width - left - right;
}

function columnsFor(doc) {
  const totalBase = BASE_COLS.reduce((s, c) => s + c.baseWidth, 0);
  const available = contentWidth(doc);
  const factor = available / totalBase;
  return BASE_COLS.map((c) => ({
    key: c.key,
    label: c.label,
    width: Math.floor(c.baseWidth * factor),
    align: c.align,
  }));
}

function drawHeader(doc, filters) {
  doc.font('Helvetica-Bold').fontSize(16).text('Relatório de Histórico de Veículos', {
    align: 'center',
  });
  doc.moveDown(0.3);
  const parts = [];
  if (filters?.q) parts.push(`Busca: ${filters.q}`);
  if (filters?.from) parts.push(`De: ${filters.from}`);
  if (filters?.to) parts.push(`Até: ${filters.to}`);
  doc.font('Helvetica').fontSize(9).fillColor('#000').text(
    parts.length ? `Filtros aplicados: ${parts.join(' | ')}` : 'Sem filtros aplicados'
  );
  doc.moveDown(0.6);

  // Column headers
  let x = MARGIN;
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(10);
  const COLS = columnsFor(doc);
  COLS.forEach((c) => {
    doc.text(c.label, x, y, { width: c.width, align: c.align });
    x += c.width;
  });
  doc
    .moveTo(MARGIN, y + 14)
    .lineTo(MARGIN + contentWidth(doc), y + 14)
    .strokeColor('#333')
    .lineWidth(0.7)
    .stroke();
  doc.moveDown(0.2);
}

function ensurePageSpace(doc, needed) {
  const bottom = doc.page.margins.bottom || MARGIN;
  const available = doc.page.height - bottom - doc.y;
  if (available < needed) {
    doc.addPage();
    return true;
  }
  return false;
}

function drawRow(doc, values, filters) {
  const startY = doc.y + 4;
  const heights = [];
  let x = MARGIN;
  doc.font('Helvetica').fontSize(9).fillColor('#000');
  const COLS = columnsFor(doc);
  COLS.forEach((c) => {
    const text = sanitizeText(values[c.key] ?? '');
    const h = doc.heightOfString(text || '-', {
      width: c.width,
      align: c.align,
    });
    heights.push(h);
  });
  const rowHeight = Math.max(...heights) + 8; // padding

  // If not enough space, add page and redraw header
  if (doc.y + rowHeight > doc.page.height - (doc.page.margins.bottom || MARGIN)) {
    doc.addPage();
    drawHeader(doc, filters);
  }

  // Draw texts
  x = MARGIN;
  COLS.forEach((c, idx) => {
    const text = sanitizeText(values[c.key] ?? '');
    doc.text(text || '-', x, startY, { width: c.width, align: c.align });
    x += c.width;
  });
  const afterY = startY + rowHeight - 6;
  doc
    .moveTo(MARGIN, afterY)
    .lineTo(MARGIN + contentWidth(doc), afterY)
    .strokeColor('#e5e7eb')
    .lineWidth(0.5)
    .stroke();
  doc.y = afterY;
}

function renderHistoricoPdf(doc, rows, filters) {
  // Top margins
  doc.info.Title = 'Histórico de Veículos';
  doc.font('Helvetica');

  drawHeader(doc, filters);

  rows.forEach((r) => {
    const line = {
      veiculo: `${sanitizeText(r.numero_vtr)} - ${sanitizeText(r.modelo)}`,
      placa: sanitizeText(r.placa || '-') ,
      inicio: formatDateTime(r.data_inicio),
      km_inicial: formatNumber(r.km_inicial),
      fim: formatDateTime(r.data_fim),
      km_final: formatNumber(r.km_final),
      status: r.em_uso ? 'Em uso' : 'Finalizado',
    };
    drawRow(doc, line, filters);
  });

  // Footer: page numbers
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const pageNum = i + 1;
    doc.font('Helvetica').fontSize(8).fillColor('#6b7280');
    doc.text(
      `Página ${pageNum} de ${range.count}`,
      MARGIN,
      doc.page.height - (doc.page.margins.bottom || MARGIN) + 10,
      { width: contentWidth(doc), align: 'right' }
    );
  }
}

function renderHistoricoPdfToResponse(res, rows, filters) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGIN, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  const fileName = `historico_${Date.now()}.pdf`;
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

  doc.pipe(res);
  renderHistoricoPdf(doc, rows, filters);
  doc.end();
}

function buildHistoricoPdfBuffer(rows, filters) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGIN, bufferPages: true });
      const { Writable } = require('stream');
      class BufferSink extends Writable {
        constructor() { super(); this._chunks = []; }
        _write(chunk, enc, cb) { this._chunks.push(Buffer.from(chunk)); cb(); }
        getBuffer() { return Buffer.concat(this._chunks); }
      }
      const sink = new BufferSink();
      doc.pipe(sink);
      renderHistoricoPdf(doc, rows, filters);
      doc.end();
      sink.on('finish', () => resolve(sink.getBuffer()));
      sink.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = {
  renderHistoricoPdf,
  renderHistoricoPdfToResponse,
  buildHistoricoPdfBuffer,
  sanitizeText,
  formatNumber,
  formatDateTime,
};