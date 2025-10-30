const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('./database');
const { renderHistoricoPdfToResponse } = require('./utils/pdf');

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3932;

const ADMIN_USERNAME = 'administrador';
const ADMIN_PASSWORD = 'invcco10';

// Configuração do EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use(session({
    secret: 'secreta123',
    resave: false,
    saveUninitialized: true
}));

// Cria tabelas e admin
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS carros (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero_vtr TEXT UNIQUE,
        tipo TEXT,
        modelo TEXT,
        placa TEXT
    )`);

    // Migrar coluna km_base se ainda não existir
    db.all("PRAGMA table_info(carros)", [], (err, columns) => {
        if (err) return console.error("Erro ao inspecionar tabela carros:", err);
        const hasKmBase = Array.isArray(columns) && columns.some(c => c.name === 'km_base');
        const hasPlaca = Array.isArray(columns) && columns.some(c => c.name === 'placa');
        if (!hasKmBase) {
            db.run("ALTER TABLE carros ADD COLUMN km_base INTEGER DEFAULT 0", (alterErr) => {
                if (alterErr) console.error("Erro ao adicionar coluna km_base:", alterErr);
                else console.log("Coluna km_base adicionada em carros.");
            });
        }
        if (!hasPlaca) {
            db.run("ALTER TABLE carros ADD COLUMN placa TEXT", (alterErr) => {
                if (alterErr) console.error("Erro ao adicionar coluna placa:", alterErr);
                else console.log("Coluna placa adicionada em carros.");
            });
        }
    });

    // Migrar coluna tipo em usuarios se ainda não existir
    db.all("PRAGMA table_info(usuarios)", [], (err, columns) => {
        if (err) return console.error("Erro ao inspecionar tabela usuarios:", err);
        const hasTipo = Array.isArray(columns) && columns.some(c => c.name === 'tipo');
        if (!hasTipo) {
            db.run("ALTER TABLE usuarios ADD COLUMN tipo TEXT DEFAULT 'USUARIO'", (alterErr) => {
                if (alterErr) console.error("Erro ao adicionar coluna tipo em usuarios:", alterErr);
                else console.log("Coluna tipo adicionada em usuarios.");
            });
        }
    });

    db.get("SELECT * FROM usuarios WHERE username = ?", [ADMIN_USERNAME], async (err, row) => {
        if (err) return console.error("Erro ao verificar admin:", err);
        if (!row) {
            const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
            db.run("INSERT INTO usuarios (username, password, tipo) VALUES (?, ?, ?)", [ADMIN_USERNAME, hash, 'Administrador'], (err) => {
                if (err) console.error("Erro ao inserir admin:", err);
                else console.log("Usuário administrador criado.");
            });
        }
    });
});

// Autenticação
function requireLogin(req, res, next) {
    if (req.session.loggedIn) return next();
    res.redirect('/');
}

function requireAdmin(req, res, next) {
    if (req.session.loggedIn && (req.session.role === 'Administrador' || req.session.username === ADMIN_USERNAME)) return next();
    res.status(403).send('Acesso restrito a administradores.');
}

// Autorização baseada em papéis
function authorizeRoles(roles = []) {
    return function(req, res, next) {
        if (!req.session.loggedIn) return res.redirect('/');
        const role = req.session.role || 'USUARIO';
        if (role === 'Administrador') return next(); // Acesso total
        if (roles.includes(role)) return next();
        return res.status(403).send('Você não tem permissão para acessar esta página.');
    };
}

// Login
app.get('/', (req, res) => {
    if (req.session.loggedIn) return res.redirect('/dashboard');
    const mensagem = (req.query && (req.query.erro === '1')) ? 'Usuário ou senha incorretos.' : undefined;
    res.render('login', { mensagem });
});

// Garantir que qualquer acesso a /login redirecione corretamente
app.get('/login', (req, res) => {
    if (req.session.loggedIn) return res.redirect('/dashboard');
    return res.redirect('/');
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;

    db.get("SELECT * FROM usuarios WHERE username = ?", [username], async (err, user) => {
        if (err) return res.status(500).send('Erro interno no servidor.');
        if (!user) {
            // Redireciona para raiz com indicador de erro
            return res.status(401).redirect('/?erro=1');
        }

        const match = await bcrypt.compare(password, user.password);
        if (match) {
            req.session.loggedIn = true;
            req.session.username = username;
            req.session.role = user.tipo || 'USUARIO';
            const role = req.session.role;
            const redirectMap = {
              'Administrador': '/dashboard',
              'BASE': '/dashboard',
              'USUARIO': '/uso-veiculo'
            };
            return res.redirect(redirectMap[role] || '/dashboard');
        } else {
            // Redireciona para raiz com indicador de erro
            return res.status(401).redirect('/?erro=1');
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// Dashboard
app.get('/dashboard', authorizeRoles(['BASE']), (req, res) => {
  const sql = `
  SELECT c.id, c.numero_vtr, c.tipo, c.modelo,
         u.id AS uso_id, u.km_inicial, u.vigilante_inicio, u.abastecimento, u.avarias, u.em_uso
  FROM carros c
  LEFT JOIN (
    SELECT *
    FROM usos_veiculos
    WHERE id IN (
      SELECT id FROM (
        SELECT id, vtr_id, MAX(COALESCE(data_fim, data_inicio)) AS data_ref
        FROM usos_veiculos
        GROUP BY vtr_id
      )
    )
  ) u ON c.id = u.vtr_id
  ORDER BY c.numero_vtr ASC
  `;

  db.all(sql, [], (err, vtrs) => {
    if (err) {
      console.error('Erro ao carregar dashboard:', err);
      return res.status(500).send('Erro ao carregar dashboard.');
    }

    res.render('dashboard', {
      username: req.session.username,
      role: req.session.role,
      vtrs
    });
  });
});

// Rota pública de preview do dashboard (sem login), para validar UI
app.get('/dashboard-preview', (req, res) => {
  const sql = `
  SELECT c.id, c.numero_vtr, c.tipo, c.modelo,
         u.id AS uso_id, u.km_inicial, u.vigilante_inicio, u.abastecimento, u.avarias, u.em_uso
  FROM carros c
  LEFT JOIN (
    SELECT *
    FROM usos_veiculos
    WHERE id IN (
      SELECT id FROM (
        SELECT id, vtr_id, MAX(COALESCE(data_fim, data_inicio)) AS data_ref
        FROM usos_veiculos
        GROUP BY vtr_id
      )
    )
  ) u ON c.id = u.vtr_id
  ORDER BY c.numero_vtr ASC
  `;

  db.all(sql, [], (err, vtrs) => {
    if (err) {
      console.error('Erro ao carregar dashboard-preview:', err);
      return res.status(500).send('Erro ao carregar preview.');
    }

    const username = (req.session && req.session.username) ? req.session.username : 'preview';
    const role = (req.session && req.session.role) ? req.session.role : 'USUARIO';
    res.render('dashboard', { username, role, vtrs });
  });
});

// Cadastrar carro
app.get('/cadastrar-carro', authorizeRoles(['BASE']), (req, res) => {
    db.all("SELECT * FROM carros", (err, rows) => {
        if (err) return res.send('Erro ao carregar veículos.');
        res.render('cadastrar-carro', {
            username: req.session.username,
            role: req.session.role,
            mensagem: null,
            vtrs: rows
        });
    });
});

app.post('/cadastrar-carro', authorizeRoles(['BASE']), (req, res) => {
    const { numero_vtr, tipo, modelo, placa } = req.body;

    if (!numero_vtr || !tipo || !modelo || !placa) {
        return carregarVtrsComMensagem(req, res, 'Preencha todos os campos (incluindo placa).');
    }

    db.run("INSERT INTO carros (numero_vtr, tipo, modelo, placa) VALUES (?, ?, ?, ?)", [numero_vtr, tipo, modelo, placa], (err) => {
        const msg = err?.message.includes("UNIQUE")
            ? "Este VTR já está cadastrado."
            : err ? "Erro ao salvar." : "Veículo cadastrado com sucesso!";

        carregarVtrsComMensagem(req, res, msg);
    });
});

app.post('/deletar-carro', authorizeRoles(['BASE']), (req, res) => {
    const { id } = req.body;
    db.run("DELETE FROM carros WHERE id = ?", [id], (err) => {
        if (err) console.error("Erro ao deletar VTR:", err);
        res.redirect('/cadastrar-carro');
    });
});

app.get('/admin/listar-usuarios', authorizeRoles(['BASE']), (req, res) => {
  db.all("SELECT username, tipo FROM usuarios WHERE username != ?", [ADMIN_USERNAME], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.post('/admin/abrir-uso', authorizeRoles(['BASE']), (req, res) => {
  const { vtr_id, motorista, km_inicial, avaria, descricao } = req.body;
  if (!vtr_id || !motorista || !km_inicial) return res.status(400).send('Dados obrigatórios ausentes.');
  const agora = new Date().toISOString();
  db.get("SELECT id FROM usos_veiculos WHERE vtr_id = ? AND em_uso = 1 ORDER BY data_inicio DESC LIMIT 1", [vtr_id], (errActive, usoAtivo) => {
    if (errActive) return res.status(500).send("Erro ao verificar uso ativo.");
    if (usoAtivo) return res.status(400).send("Veículo já está em uso, não é possível abrir novo uso.");
    db.get("SELECT id, numero_vtr, tipo, modelo FROM carros WHERE id = ?", [vtr_id], (errCar, vtr) => {
      if (errCar || !vtr) return res.status(400).send("Veículo não encontrado.");
      const protocoloCodigo = `PRT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      db.run(`
        INSERT INTO protocolos_uso (protocolo_codigo, vtr_id, numero_vtr_snapshot, tipo_snapshot, modelo_snapshot, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [protocoloCodigo, vtr.id, vtr.numero_vtr, vtr.tipo, vtr.modelo, agora], function(errProt) {
        if (errProt) return res.status(500).send("Erro ao criar protocolo de uso.");
        const protocoloId = this.lastID;
        db.run(
          `INSERT INTO usos_veiculos (vtr_id, km_inicial, vigilante_inicio, data_inicio, em_uso, protocolo_id, abastecimento, avarias, observacoes)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          [vtr_id, km_inicial, motorista, agora, protocoloId, /* abastecimento */ 'Não', avaria, descricao],
          (errUso) => {
            if (errUso) return res.status(500).send("Falha ao abrir novo uso do veículo.");
            // Atualiza km_base
            const kmInicialNum = Number(km_inicial);
            if (Number.isFinite(kmInicialNum) && kmInicialNum >= 0) {
              db.run("UPDATE carros SET km_base = ? WHERE id = ?", [kmInicialNum, vtr_id], (errUpdate) => {
                if (errUpdate) console.warn('Aviso ao atualizar km_base:', errUpdate);
                return res.send("Uso aberto com sucesso.");
              });
            } else {
              res.send("Uso aberto com sucesso.");
            }
          }
        );
      });
    });
  });
});

function carregarVtrsComMensagem(req, res, mensagem) {
    db.all("SELECT * FROM carros", (err, rows) => {
        if (err) return res.send("Erro ao carregar lista.");
        res.render('cadastrar-carro', {
            username: req.session.username,
            role: req.session.role,
            mensagem,
            vtrs: rows
        });
    });
}

// Usuários
app.get('/admin/cadastrar-usuario', requireAdmin, (req, res) => {
    db.all("SELECT id, username, tipo FROM usuarios WHERE username != ?", [ADMIN_USERNAME], (err, rows) => {
        if (err) return res.status(500).send('Erro ao carregar usuários.');
        res.render('cadastrar-usuario', {
            usuarios: rows,
            username: req.session.username,
            role: req.session.role,
            mensagem: null,
            mensagemTipo: null
        });
    });
});

app.post('/admin/cadastrar-usuario', requireAdmin, async (req, res) => {
    const { username, password, tipo } = req.body;
    if (!username || !password) {
        return carregarUsuariosComMensagem(req, res, 'Preencha todos os campos.', 'error');
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const tipoFinal = tipo || 'USUARIO';
        db.run("INSERT INTO usuarios (username, password, tipo) VALUES (?, ?, ?)", [username, hashedPassword, tipoFinal], function(err) {
            if (err) {
                if (err.message.includes("UNIQUE")) {
                    return carregarUsuariosComMensagem(req, res, 'Usuário já existe!', 'error');
                } else {
                    return carregarUsuariosComMensagem(req, res, 'Erro interno ao cadastrar usuário.', 'error');
                }
            }
            return carregarUsuariosComMensagem(req, res, 'Usuário cadastrado com sucesso!', 'success');
        });
    } catch (err) {
        return carregarUsuariosComMensagem(req, res, 'Erro interno ao cadastrar usuário.', 'error');
    }
});

app.post('/admin/deletar-usuario', requireAdmin, (req, res) => {
    const { username } = req.body;
    if (username === ADMIN_USERNAME) return res.send('Você não pode apagar o administrador.');

    db.run("DELETE FROM usuarios WHERE username = ?", [username], function(err) {
        if (err) return res.status(500).send('Erro ao apagar usuário.');
        res.redirect('/admin/cadastrar-usuario');
    });
});

function carregarUsuariosComMensagem(req, res, mensagem, mensagemTipo) {
    db.all("SELECT id, username, tipo FROM usuarios WHERE username != ?", [ADMIN_USERNAME], (err, rows) => {
        if (err) return res.status(500).send('Erro ao carregar usuários.');
        res.render('cadastrar-usuario', {
            usuarios: rows,
            username: req.session.username,
            role: req.session.role,
            mensagem,
            mensagemTipo
        });
    });
}

// Preview público do cadastro de usuário (apenas para validar UI)
app.get('/admin/cadastrar-usuario-preview', (req, res) => {
    db.all("SELECT id, username, tipo FROM usuarios WHERE username != ?", [ADMIN_USERNAME], (err, rows) => {
        if (err) return res.status(500).send('Erro ao carregar usuários.');
        const username = (req.session && req.session.username) ? req.session.username : ADMIN_USERNAME;
        const role = (req.session && req.session.role) ? req.session.role : 'Administrador';
        res.render('cadastrar-usuario', {
            usuarios: rows,
            username,
            role,
            mensagem: 'Prévia: popup de cadastro estilizado.',
            mensagemTipo: 'success'
        });
    });
});

// Uso de veículos (USUARIO)
app.get('/uso-veiculo', authorizeRoles(['USUARIO']), (req, res) => {
    const username = req.session.username;
    db.all("SELECT * FROM carros", (err, vtrs) => {
        if (err) return res.send("Erro ao carregar veículos.");
        db.all(`
            SELECT u.id AS uso_id, u.vtr_id, u.data_inicio, u.km_inicial, c.numero_vtr, c.modelo
            FROM usos_veiculos u
            JOIN carros c ON u.vtr_id = c.id
            WHERE u.vigilante_inicio = ? AND u.em_uso = 1
            ORDER BY u.data_inicio DESC
        `, [username], (errUsos, usosAtivos) => {
            if (errUsos) return res.send("Erro ao carregar seus usos em andamento.");
            res.render('formulario-uso', {
                vtrs,
                username,
                role: req.session.role,
                usos_ativos: usosAtivos || []
            });
        });
    });
});

// Verifica status atual do veículo
app.get('/status-veiculo/:id', (req, res) => {
    const vtrId = req.params.id;
    db.get(`
        SELECT * FROM usos_veiculos 
        WHERE vtr_id = ? AND em_uso = 1 
        ORDER BY data_inicio DESC LIMIT 1
    `, [vtrId], (err, row) => {
        if (err) return res.status(500).send("Erro ao consultar uso.");
        res.json(row || null);
    });
});

// Abrir novo uso
app.post('/abrir-uso', authorizeRoles(['USUARIO']), (req, res) => {
    const { vtr_id, km_inicial } = req.body;
    const vigilante_inicio = req.session.username; // força motorista como usuário logado
    const agora = new Date().toISOString();

    // Regra: não permitir abertura se já houver uso ativo para o VTR
    db.get("SELECT id, vigilante_inicio FROM usos_veiculos WHERE vtr_id = ? AND em_uso = 1 ORDER BY data_inicio DESC LIMIT 1", [vtr_id], (errActive, activeUso) => {
        if (errActive) return res.status(500).send("Erro ao verificar uso ativo do veículo.");
        if (activeUso) return res.status(400).send(`Veículo já está em uso por ${activeUso.vigilante_inicio}.`);

        // Buscar snapshot do VTR e criar protocolo antes do registro de uso
        db.get("SELECT id, numero_vtr, tipo, modelo FROM carros WHERE id = ?", [vtr_id], (errCar, vtr) => {
            if (errCar) return res.status(500).send("Erro ao buscar VTR.");
            if (!vtr) return res.status(400).send("VTR não encontrado.");

            const protocoloCodigo = `PRT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

            db.run(
                `INSERT INTO protocolos_uso (protocolo_codigo, vtr_id, numero_vtr_snapshot, tipo_snapshot, modelo_snapshot, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [protocoloCodigo, vtr.id, vtr.numero_vtr, vtr.tipo, vtr.modelo, agora],
                function (errProt) {
                    if (errProt) {
                        console.error('Erro ao criar protocolo:', errProt);
                        return res.status(500).send("Erro ao criar protocolo de uso.");
                    }

                    const protocoloId = this.lastID;
                    db.run(
                        `INSERT INTO usos_veiculos (vtr_id, km_inicial, vigilante_inicio, data_inicio, protocolo_id)
                         VALUES (?, ?, ?, ?, ?)`,
                        [vtr_id, km_inicial, vigilante_inicio, agora, protocoloId],
                        (errUso) => {
                            if (errUso) {
                                console.error('Erro ao abrir uso:', errUso);
                                return res.status(500).send("Erro ao abrir uso.");
                            }
                            // Atualiza km_base do VTR para refletir o KM inicial do novo uso
                            const kmInicialNum = Number(km_inicial);
                            if (Number.isFinite(kmInicialNum) && kmInicialNum >= 0) {
                              db.run(
                                "UPDATE carros SET km_base = ? WHERE id = ?",
                                [kmInicialNum, vtr_id],
                                (errUpdate) => {
                                  if (errUpdate) {
                                    console.error('Erro ao atualizar km_base na abertura do uso:', errUpdate);
                                    // Ainda assim confirma abertura do uso
                                  }
                                  res.send("Uso iniciado com sucesso.");
                                }
                              );
                            } else {
                              res.send("Uso iniciado com sucesso.");
                            }
                        }
                    );
                }
            );
        });
    });
});

// Encerrar uso existente
app.post('/encerrar-uso', authorizeRoles(['USUARIO', 'BASE']), (req, res) => {
    const { uso_id, km_final, abastecimento, avarias, observacoes } = req.body;
    const vigilante_fim = req.session.username; // força motorista como usuário logado
    const agora = new Date().toISOString();
    const role = req.session.role || 'USUARIO';

    // Regra: apenas o usuário que abriu o uso pode encerrá-lo e o uso deve estar ativo
    db.get("SELECT vigilante_inicio, em_uso FROM usos_veiculos WHERE id = ?", [uso_id], (errUso, usoRow) => {
        if (errUso) return res.status(500).send("Erro ao validar uso.");
        if (!usoRow) return res.status(404).send("Uso não encontrado.");
        if (usoRow.em_uso !== 1) return res.status(400).send("Uso já está encerrado.");
        const canOverride = (role === 'Administrador' || role === 'BASE');
        if (!canOverride && usoRow.vigilante_inicio !== vigilante_fim) {
          return res.status(403).send("Encerramento permitido apenas pelo usuário que abriu o uso.");
        }

        db.run(`
            UPDATE usos_veiculos 
            SET km_final = ?, abastecimento = ?, avarias = ?, observacoes = ?, 
                vigilante_fim = ?, data_fim = ?, em_uso = 0
            WHERE id = ?
        `, [km_final, abastecimento, avarias, observacoes, vigilante_fim, agora, uso_id], (err) => {
            if (err) return res.status(500).send("Erro ao encerrar uso.");
            // Após encerrar, atualizar km_base do VTR com o km_final
            const kmFinalNum = Number(km_final);
            if (!Number.isFinite(kmFinalNum) || kmFinalNum < 0) {
              return res.send("Uso encerrado com sucesso.");
            }
            db.get("SELECT vtr_id FROM usos_veiculos WHERE id = ?", [uso_id], (errVtr, rowVtr) => {
              if (errVtr || !rowVtr) {
                if (errVtr) console.error('Erro ao buscar vtr_id para atualizar km_base:', errVtr);
                return res.send("Uso encerrado com sucesso.");
              }
              db.run("UPDATE carros SET km_base = ? WHERE id = ?", [kmFinalNum, rowVtr.vtr_id], (errUpdate) => {
                if (errUpdate) {
                  console.error('Erro ao atualizar km_base no encerramento do uso:', errUpdate);
                }
                res.send("Uso encerrado com sucesso.");
              });
            });
        });
    });
});

// Histórico
app.get('/historico', authorizeRoles(['BASE']), (req, res) => {
    const q = (req.query.q || '').trim();
    const from = (req.query.from || '').trim(); // yyyy-mm-dd
    const to = (req.query.to || '').trim();     // yyyy-mm-dd

    const params = [];
    let where = '';
    const clauses = [];

    if (q) {
      const like = `%${q}%`;
      clauses.push('(p.numero_vtr_snapshot LIKE ? OR p.modelo_snapshot LIKE ? OR u.vigilante_inicio LIKE ? OR u.vigilante_fim LIKE ? OR c.placa LIKE ?)');
      params.push(like, like, like, like, like);
    }
    if (from) {
      clauses.push('u.data_inicio >= ?');
      params.push(`${from}T00:00:00`);
    }
    if (to) {
      clauses.push('COALESCE(u.data_fim, u.data_inicio) <= ?');
      params.push(`${to}T23:59:59`);
    }
    if (clauses.length) {
      where = 'WHERE ' + clauses.join(' AND ');
    }

    const sql = `
        SELECT u.*, 
               p.numero_vtr_snapshot AS numero_vtr, 
               p.modelo_snapshot AS modelo, 
               p.protocolo_codigo,
               c.placa AS placa
        FROM usos_veiculos u
        JOIN protocolos_uso p ON p.id = u.protocolo_id
        LEFT JOIN carros c ON c.id = u.vtr_id
        ${where}
        ORDER BY u.data_inicio DESC
    `;
    db.all(sql, params, (err, rows) => {
        if (err) return res.send('Erro ao carregar histórico.');
        res.render('historico', { username: req.session.username, role: req.session.role, registros: rows, q, from, to });
    });
});

// Exportação de histórico em PDF com filtros
app.get('/historico/export-pdf', authorizeRoles(['BASE']), (req, res) => {
    const q = (req.query.q || '').trim();
    const from = (req.query.from || '').trim(); // yyyy-mm-dd
    const to = (req.query.to || '').trim();     // yyyy-mm-dd

    const params = [];
    let where = '';
    const clauses = [];

    if (q) {
      const like = `%${q}%`;
      clauses.push('(p.numero_vtr_snapshot LIKE ? OR p.modelo_snapshot LIKE ? OR u.vigilante_inicio LIKE ? OR u.vigilante_fim LIKE ? OR c.placa LIKE ?)');
      params.push(like, like, like, like, like);
    }
    if (from) {
      clauses.push('u.data_inicio >= ?');
      params.push(`${from}T00:00:00`);
    }
    if (to) {
      clauses.push('COALESCE(u.data_fim, u.data_inicio) <= ?');
      params.push(`${to}T23:59:59`);
    }
    if (clauses.length) {
      where = 'WHERE ' + clauses.join(' AND ');
    }

    const sql = `
        SELECT u.*, 
               p.numero_vtr_snapshot AS numero_vtr, 
               p.modelo_snapshot AS modelo, 
               p.protocolo_codigo,
               c.placa AS placa
        FROM usos_veiculos u
        JOIN protocolos_uso p ON p.id = u.protocolo_id
        LEFT JOIN carros c ON c.id = u.vtr_id
        ${where}
        ORDER BY u.data_inicio DESC
    `;

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Erro ao gerar PDF:', err);
            return res.status(500).send('Erro ao gerar PDF.');
        }
        const filters = { q, from, to };
        renderHistoricoPdfToResponse(res, rows, filters);
    });
});

// Prévia pública da exportação em PDF (sem login) para validação visual
app.get('/historico/export-pdf-preview', (req, res) => {
    const q = (req.query.q || '').trim();
    const from = (req.query.from || '').trim();
    const to = (req.query.to || '').trim();

    const params = [];
    let where = '';
    const clauses = [];

    if (q) {
      const like = `%${q}%`;
      clauses.push('(p.numero_vtr_snapshot LIKE ? OR p.modelo_snapshot LIKE ? OR u.vigilante_inicio LIKE ? OR u.vigilante_fim LIKE ? OR c.placa LIKE ?)');
      params.push(like, like, like, like, like);
    }
    if (from) {
      clauses.push('u.data_inicio >= ?');
      params.push(`${from}T00:00:00`);
    }
    if (to) {
      clauses.push('COALESCE(u.data_fim, u.data_inicio) <= ?');
      params.push(`${to}T23:59:59`);
    }
    if (clauses.length) {
      where = 'WHERE ' + clauses.join(' AND ');
    }

    const sql = `
        SELECT u.*, 
               p.numero_vtr_snapshot AS numero_vtr, 
               p.modelo_snapshot AS modelo, 
               p.protocolo_codigo,
               c.placa AS placa
        FROM usos_veiculos u
        JOIN protocolos_uso p ON p.id = u.protocolo_id
        LEFT JOIN carros c ON c.id = u.vtr_id
        ${where}
        ORDER BY u.data_inicio DESC
        LIMIT 100
    `;

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Erro ao gerar PDF (preview):', err);
            return res.status(500).send('Erro ao gerar PDF (preview).');
        }
        const filters = { q, from, to };
        renderHistoricoPdfToResponse(res, rows, filters);
    });
});

// Último KM
app.get('/ultimo-km/:vtrId', (req, res) => {
    const vtrId = req.params.vtrId;
    db.get("SELECT km_base FROM carros WHERE id = ?", [vtrId], (errCar, rowCar) => {
        if (errCar) {
            console.error("Erro ao buscar km_base:", errCar);
            return res.status(500).json({ erro: 'Erro ao buscar KM atual.' });
        }
        const kmBase = Number.isFinite(Number(rowCar?.km_base)) ? Number(rowCar?.km_base) : 0;

        const ultimoKmSql = `
            SELECT km_final FROM usos_veiculos
            WHERE vtr_id = ? AND km_final IS NOT NULL AND em_uso = 0
            ORDER BY data_fim DESC LIMIT 1
        `;
        db.get(ultimoKmSql, [vtrId], (errUso, rowUso) => {
            if (errUso) {
                console.error("Erro ao buscar último KM:", errUso);
                return res.status(500).json({ erro: 'Erro ao buscar KM final.' });
            }
            const kmUso = Number.isFinite(Number(rowUso?.km_final)) ? Number(rowUso?.km_final) : 0;
            const kmFinal = Math.max(kmBase, kmUso);
            res.json({ km_final: kmFinal });
        });
    });
});

// (Rota de editar KM removida)

// Inicia servidor HTTP normal
app.listen(PORT, () => {
  console.log(`Servidor HTTP rodando em http://localhost:${PORT}`);
});
