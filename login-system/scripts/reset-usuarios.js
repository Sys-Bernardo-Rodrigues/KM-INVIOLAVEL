const bcrypt = require('bcrypt');
const db = require('../database');

async function ensureTipoColumn() {
  return new Promise((resolve) => {
    db.all("PRAGMA table_info(usuarios)", [], (err, cols) => {
      if (err) {
        console.error('Erro ao inspecionar tabela usuarios:', err);
        return resolve();
      }
      const hasTipo = Array.isArray(cols) && cols.some(c => c.name === 'tipo');
      if (hasTipo) return resolve();
      db.run("ALTER TABLE usuarios ADD COLUMN tipo TEXT DEFAULT 'USUARIO'", (alterErr) => {
        if (alterErr) console.error('Erro ao adicionar coluna tipo:', alterErr);
        else console.log('Coluna tipo adicionada em usuarios.');
        resolve();
      });
    });
  });
}

async function resetUsuarios() {
  await ensureTipoColumn();

  await new Promise((resolve) => {
    db.run('DELETE FROM usuarios', (err) => {
      if (err) console.error('Erro ao apagar usuários:', err);
      else console.log('Todos os usuários foram apagados.');
      resolve();
    });
  });

  const users = [
    { username: 'administrador', password: 'invcco10', tipo: 'Administrador' },
    { username: 'base', password: 'base', tipo: 'BASE' },
    { username: 'usuario', password: 'usuario', tipo: 'USUARIO' }
  ];

  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 10);
    await new Promise((resolve) => {
      db.run('INSERT INTO usuarios (username, password, tipo) VALUES (?, ?, ?)', [u.username, hash, u.tipo], (err) => {
        if (err) console.error(`Erro ao inserir usuário ${u.username}:`, err);
        else console.log(`Usuário ${u.username} (${u.tipo}) criado.`);
        resolve();
      });
    });
  }

  console.log('Reset de usuários concluído.');
}

resetUsuarios()
  .then(() => {
    db.close(() => process.exit(0));
  })
  .catch((err) => {
    console.error('Falha no reset:', err);
    db.close(() => process.exit(1));
  });