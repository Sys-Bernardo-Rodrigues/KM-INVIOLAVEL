const assert = require('assert');
const { buildHistoricoPdfBuffer } = require('../utils/pdf');

async function testSmallDataset() {
  const rows = [
    {
      numero_vtr: 'teste', modelo: '111', placa: 'ABC1245',
      data_inicio: '2025-10-30T13:54:29Z', km_inicial: 1234,
      data_fim: '2025-10-30T15:10:11Z', km_final: 3010, em_uso: 0
    },
  ];
  const buf = await buildHistoricoPdfBuffer(rows, { q: '', from: '', to: '' });
  assert(buf.length > 1000, 'PDF muito pequeno');
  // Valida assinatura do arquivo PDF
  assert(buf.slice(0, 4).toString() === '%PDF', 'Assinatura PDF inválida');
}

async function testSpecialCharsAndWrapping() {
  const rows = [
    {
      numero_vtr: '70’&ÓÄ…"&cc&&% 04',
      modelo: 'TÄÒÖR Teste com descrição longa que deve quebrar em várias linhas sem truncar conteúdo',
      placa: 'XYZ9D99',
      data_inicio: '2025-10-30T08:41:29Z', km_inicial: 169995,
      data_fim: null, km_final: null, em_uso: 1
    },
  ];
  const buf = await buildHistoricoPdfBuffer(rows, { q: 'teste', from: '2025-10-01', to: '2025-10-31' });
  assert(buf.length > 1000);
  assert(buf.slice(0, 4).toString() === '%PDF');
}

async function testManyRowsPagination() {
  const base = [];
  for (let i = 0; i < 120; i++) {
    base.push({
      numero_vtr: `VTR${i}`,
      modelo: `Modelo ${i}`,
      placa: i % 3 === 0 ? `ABC${(1000 + i)}` : '',
      data_inicio: `2025-10-29T1${i % 10}:00:00Z`,
      km_inicial: 10000 + i * 57,
      data_fim: i % 2 ? `2025-10-30T1${i % 10}:30:00Z` : null,
      km_final: i % 2 ? 15000 + i * 59 : null,
      em_uso: i % 2 ? 0 : 1
    });
  }
  const buf = await buildHistoricoPdfBuffer(base, {});
  assert(buf.length > 5000, 'PDF de muitas linhas deve ser maior');
  assert(buf.slice(0, 4).toString() === '%PDF');
}

(async () => {
  await testSmallDataset();
  await testSpecialCharsAndWrapping();
  await testManyRowsPagination();
  console.log('Testes de PDF concluídos com sucesso.');
})().catch((e) => {
  console.error('Falha nos testes de PDF:', e);
  process.exit(1);
});