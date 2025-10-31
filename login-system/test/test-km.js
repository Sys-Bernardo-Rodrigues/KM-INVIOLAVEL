const assert = require('assert');
const { calcKmPercorrido } = require('../utils/km');

function ok(name, fn) {
  try {
    fn();
    console.log(`✔ ${name}`);
  } catch (e) {
    console.error(`✘ ${name}:`, e.message);
    process.exitCode = 1;
  }
}

// Cálculos corretos
ok('Calcula 50.00 para (100, 150)', () => {
  assert.strictEqual(calcKmPercorrido(100, 150), '50.00');
});

ok('Calcula 0.00 para (0, 0)', () => {
  assert.strictEqual(calcKmPercorrido(0, 0), '0.00');
});

ok('Calcula 76.55 para (123.45, 200)', () => {
  assert.strictEqual(calcKmPercorrido(123.45, 200), '76.55');
});

ok('Aceita strings numéricas', () => {
  assert.strictEqual(calcKmPercorrido('10', '12.5'), '2.50');
});

// Validação de entradas
ok('Rejeita não numérico em km_inicial', () => {
  assert.throws(() => calcKmPercorrido('abc', 100), /numérico/);
});

ok('Rejeita não numérico em km_final', () => {
  assert.throws(() => calcKmPercorrido(100, 'xyz'), /numérico/);
});

ok('Rejeita negativos', () => {
  assert.throws(() => calcKmPercorrido(-1, 10), /negativos/);
  assert.throws(() => calcKmPercorrido(10, -1), /negativos/);
});

ok('Rejeita km_final menor que km_inicial', () => {
  assert.throws(() => calcKmPercorrido(200, 199), /maior ou igual/);
});

// Tratamento de erros
ok('Erro com mensagem clara para valores inválidos', () => {
  try {
    calcKmPercorrido('?', null);
    assert.fail('Deveria lançar erro');
  } catch (e) {
    assert.match(e.message, /numérico|inválido/);
  }
});

if (process.exitCode) {
  console.error('Alguns testes falharam.');
} else {
  console.log('Todos os testes passaram.');
}