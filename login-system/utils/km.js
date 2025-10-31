function ensureNumeric(value, name) {
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isFinite(num)) {
    throw new Error(`Valor inválido: ${name} deve ser numérico.`);
  }
  return num;
}

function calcKmPercorrido(kmInicial, kmFinal) {
  const inicial = ensureNumeric(kmInicial, 'km_inicial');
  const final = ensureNumeric(kmFinal, 'km_final');

  if (inicial < 0 || final < 0) {
    throw new Error('Valores negativos não são permitidos.');
  }
  if (final < inicial) {
    throw new Error('km_final deve ser maior ou igual a km_inicial.');
  }

  const diff = final - inicial;
  return diff.toFixed(2);
}

module.exports = { calcKmPercorrido };