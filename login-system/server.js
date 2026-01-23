const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('./database');
const { renderHistoricoPdfToResponse } = require('./utils/pdf');
const { SimpleCache } = require('./utils/cache');

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

// Middleware para obter unidade_id da sessão
function getUnidadeId(req) {
    // Retorna a primeira unidade do usuário (para compatibilidade)
    if (req.session.unidades_ids && req.session.unidades_ids.length > 0) {
        return req.session.unidades_ids[0];
    }
    return req.session.unidade_id || null;
}

function getUnidadeIds(req) {
    // Retorna todas as unidades do usuário
    if (req.session.unidades_ids && req.session.unidades_ids.length > 0) {
        return req.session.unidades_ids;
    }
    if (req.session.unidade_id) {
        return [req.session.unidade_id];
    }
    return [];
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
    const username = req.body.username ? req.body.username.toLowerCase() : '';
    const { password } = req.body;

    db.get("SELECT * FROM usuarios WHERE username = ?", [username], async (err, user) => {
        if (err) return res.status(500).send('Erro interno no servidor.');
        if (!user) {
            // Redireciona para raiz com indicador de erro
            return res.status(401).redirect('/?erro=1');
        }

        const match = await bcrypt.compare(password, user.password);
        if (match) {
            // Buscar unidades vinculadas ao usuário (relação muitos-para-muitos)
            db.all(`
                SELECT uu.unidade_id, un.nome as unidade_nome
                FROM usuarios_unidades uu
                JOIN unidades un ON uu.unidade_id = un.id
                WHERE uu.usuario_id = ?
                ORDER BY un.nome ASC
            `, [user.id], (errUnidades, unidades) => {
                if (errUnidades) unidades = [];
                
                req.session.loggedIn = true;
                req.session.username = username;
                req.session.role = user.tipo || 'USUARIO';
                
                // Para compatibilidade, usar a primeira unidade se houver
                if (unidades && unidades.length > 0) {
                    // Garantir que os IDs sejam números inteiros
                    const unidadesIdsInt = unidades.map(u => parseInt(u.unidade_id, 10)).filter(id => !isNaN(id));
                    req.session.unidade_id = unidadesIdsInt[0] || null;
                    req.session.unidade_nome = unidades[0].unidade_nome;
                    // Armazenar todas as unidades para uso futuro
                    req.session.unidades_ids = unidadesIdsInt;
                } else {
                    req.session.unidade_id = null;
                    req.session.unidade_nome = null;
                    req.session.unidades_ids = [];
                }
                
                const role = req.session.role;
                const redirectMap = {
                  'Administrador': '/dashboard',
                  'BASE': '/dashboard',
                  'USUARIO': '/uso-veiculo'
                };
                return res.redirect(redirectMap[role] || '/dashboard');
            });
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
  const unidadesIds = getUnidadeIds(req);
  if (unidadesIds.length === 0 && req.session.role !== 'Administrador') {
    return res.status(403).send('Usuário não possui unidade vinculada.');
  }

  let sql = `
  SELECT c.id, c.numero_vtr, c.tipo, c.modelo, c.unidade_id,
         un.nome AS unidade_nome,
         u.id AS uso_id, u.km_inicial, u.vigilante_inicio, u.abastecimento, u.avarias, u.em_uso
  FROM carros c
  LEFT JOIN unidades un ON c.unidade_id = un.id
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
  WHERE 1=1
  `;
  const params = [];
  if (unidadesIds.length > 0 && req.session.role !== 'Administrador') {
    sql += ' AND c.unidade_id IN (' + unidadesIds.map(() => '?').join(',') + ')';
    params.push(...unidadesIds);
  }
  sql += ' ORDER BY c.numero_vtr ASC';

  db.all(sql, params, (err, vtrs) => {
    if (err) {
      console.error('Erro ao carregar dashboard:', err);
      return res.status(500).send('Erro ao carregar dashboard.');
    }

    // Buscar unidades para o filtro
    let unidadesQuery = "SELECT * FROM unidades ORDER BY nome ASC";
    let unidadesParams = [];
    
    // Se for BASE, mostrar apenas as unidades do usuário
    if (req.session.role === 'BASE' && unidadesIds.length > 0) {
      unidadesQuery = "SELECT * FROM unidades WHERE id IN (" + unidadesIds.map(() => '?').join(',') + ") ORDER BY nome ASC";
      unidadesParams = unidadesIds;
    }
    
    db.all(unidadesQuery, unidadesParams, (errUnidades, unidades) => {
      if (errUnidades) unidades = [];
      res.render('dashboard', {
        username: req.session.username,
        role: req.session.role,
        vtrs,
        unidades: unidades || []
      });
    });
  });
});


// Cadastrar carro
app.get('/cadastrar-carro', authorizeRoles(['BASE']), (req, res) => {
    const unidadesIds = getUnidadeIds(req);
    
    // Garantir que os IDs sejam números inteiros
    const unidadesIdsInt = unidadesIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    
    if (unidadesIdsInt.length === 0 && req.session.role !== 'Administrador') {
        return res.status(403).send('Usuário não possui unidade vinculada.');
    }

    let sql = "SELECT c.*, u.nome as unidade_nome FROM carros c LEFT JOIN unidades u ON c.unidade_id = u.id";
    const params = [];
    if (unidadesIdsInt.length > 0 && req.session.role !== 'Administrador') {
        sql += " WHERE c.unidade_id IN (" + unidadesIdsInt.map(() => '?').join(',') + ")";
        params.push(...unidadesIdsInt);
        // Debug: log para verificar a query
        console.log('[CADASTRAR-CARRO GET] Usuário:', req.session.username);
        console.log('[CADASTRAR-CARRO GET] Unidades IDs:', unidadesIdsInt);
        console.log('[CADASTRAR-CARRO GET] SQL:', sql);
        console.log('[CADASTRAR-CARRO GET] Params:', params);
    }
    sql += " ORDER BY u.nome ASC, c.numero_vtr ASC";
    
    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Erro ao carregar veículos:', err);
            return res.send('Erro ao carregar veículos.');
        }
        
        if (rows) {
            console.log('[CADASTRAR-CARRO GET] Veículos encontrados:', rows.length);
            console.log('[CADASTRAR-CARRO GET] Unidades dos veículos:', [...new Set(rows.map(r => r.unidade_id))]);
        }
        
        // Buscar unidades para o select
        let unidadesQuery = "SELECT * FROM unidades ORDER BY nome ASC";
        let unidadesParams = [];
        
        // Se não for admin, mostrar apenas as unidades do usuário
        if (req.session.role !== 'Administrador' && unidadesIdsInt.length > 0) {
            unidadesQuery = "SELECT * FROM unidades WHERE id IN (" + unidadesIdsInt.map(() => '?').join(',') + ") ORDER BY nome ASC";
            unidadesParams = unidadesIdsInt;
        }
        
        db.all(unidadesQuery, unidadesParams, (errUnidades, unidades) => {
            if (errUnidades) {
                console.error('Erro ao carregar unidades:', errUnidades);
                unidades = [];
            }
            res.render('cadastrar-carro', {
                username: req.session.username,
                role: req.session.role,
                mensagem: null,
                vtrs: rows,
                unidades: unidades || [],
                unidadesIds: unidadesIdsInt
            });
        });
    });
});

app.post('/cadastrar-carro', authorizeRoles(['BASE']), (req, res) => {
    const { numero_vtr, tipo, modelo, placa, unidade_id } = req.body;
    const unidadesIds = getUnidadeIds(req);

    if (!numero_vtr || !tipo || !modelo || !placa) {
        return carregarVtrsComMensagem(req, res, 'Preencha todos os campos (incluindo placa).', 'error');
    }

    let unidadeIdFinal = null;

    if (req.session.role === 'Administrador') {
        // Administrador pode escolher qualquer unidade ou deixar sem unidade
        unidadeIdFinal = (unidade_id && unidade_id !== '') ? parseInt(unidade_id, 10) : null;
    } else {
        // Usuário comum: se tiver múltiplas unidades, deve escolher uma
        if (unidadesIds.length === 0) {
            return carregarVtrsComMensagem(req, res, 'Usuário não possui unidade vinculada.', 'error');
        } else if (unidadesIds.length === 1) {
            // Se tiver apenas uma unidade, usar ela automaticamente
            unidadeIdFinal = unidadesIds[0];
        } else {
            // Se tiver múltiplas unidades, deve escolher uma
            if (!unidade_id || unidade_id === '') {
                return carregarVtrsComMensagem(req, res, 'Selecione a unidade para o veículo.', 'error');
            }
            const unidadeIdEscolhida = parseInt(unidade_id, 10);
            // Verificar se a unidade escolhida pertence ao usuário
            if (!unidadesIds.includes(unidadeIdEscolhida)) {
                return carregarVtrsComMensagem(req, res, 'Unidade selecionada não pertence ao usuário.', 'error');
            }
            unidadeIdFinal = unidadeIdEscolhida;
        }
    }

    db.run("INSERT INTO carros (numero_vtr, tipo, modelo, placa, unidade_id) VALUES (?, ?, ?, ?, ?)", 
        [numero_vtr, tipo, modelo, placa, unidadeIdFinal], 
        (err) => {
            if (err) {
                const msg = err.message.includes("UNIQUE")
                    ? "Este VTR já está cadastrado nesta unidade."
                    : "Erro ao salvar.";
                return carregarVtrsComMensagem(req, res, msg, 'error');
            }
            carregarVtrsComMensagem(req, res, 'Veículo cadastrado com sucesso!', 'success');
        }
    );
});

app.post('/editar-carro', authorizeRoles(['BASE']), (req, res) => {
    const { id, numero_vtr, tipo, modelo, placa, unidade_id } = req.body;
    const unidadesIds = getUnidadeIds(req);

    if (!id || !numero_vtr || !tipo || !modelo || !placa) {
        return carregarVtrsComMensagem(req, res, 'Preencha todos os campos.', 'error');
    }

    // Se não for administrador, verificar se o carro pertence a uma das unidades do usuário
    if (req.session.role !== 'Administrador') {
        if (unidadesIds.length === 0) {
            return carregarVtrsComMensagem(req, res, 'Usuário não possui unidade vinculada.', 'error');
        }

        // Verificar se o carro pertence a uma das unidades do usuário
        db.get("SELECT unidade_id FROM carros WHERE id = ?", [id], (err, carro) => {
            if (err || !carro) {
                return carregarVtrsComMensagem(req, res, 'Erro ao verificar veículo.', 'error');
            }
            
            // Verificar se a unidade do carro está nas unidades do usuário
            if (carro.unidade_id && !unidadesIds.includes(carro.unidade_id)) {
                return carregarVtrsComMensagem(req, res, 'Você não tem permissão para editar este veículo.', 'error');
            }
            
            // Manter a unidade atual (não-admins não podem mudar unidade)
            const unidadeIdFinal = carro.unidade_id;
            
            db.run("UPDATE carros SET numero_vtr = ?, tipo = ?, modelo = ?, placa = ? WHERE id = ?", 
                [numero_vtr, tipo, modelo, placa, id], 
                (err) => {
                    if (err) {
                        const msg = err.message.includes("UNIQUE")
                            ? "Número VTR já cadastrado."
                            : "Erro ao atualizar.";
                        return carregarVtrsComMensagem(req, res, msg, 'error');
                    }
                    carregarVtrsComMensagem(req, res, 'Veículo atualizado com sucesso!', 'success');
                }
            );
        });
        return;
    }

    // Administrador pode alterar a unidade
    const unidadeIdFinal = unidade_id && unidade_id !== '' ? parseInt(unidade_id, 10) : null;

    db.run("UPDATE carros SET numero_vtr = ?, tipo = ?, modelo = ?, placa = ?, unidade_id = ? WHERE id = ?", 
        [numero_vtr, tipo, modelo, placa, unidadeIdFinal, id], 
        (err) => {
            if (err) {
                const msg = err.message.includes("UNIQUE")
                    ? "Número VTR já cadastrado."
                    : "Erro ao atualizar.";
                return carregarVtrsComMensagem(req, res, msg, 'error');
            }
            carregarVtrsComMensagem(req, res, 'Veículo atualizado com sucesso!', 'success');
        }
    );
});

app.post('/deletar-carro', authorizeRoles(['BASE']), (req, res) => {
    const { id } = req.body;
    db.run("DELETE FROM carros WHERE id = ?", [id], (err) => {
        if (err) console.error("Erro ao deletar VTR:", err);
        res.redirect('/cadastrar-carro');
    });
});

// Página de gráficos (acesso BASE e Administrador)
app.get('/graficos', authorizeRoles(['BASE']), (req, res) => {
  res.render('graficos', {
    username: req.session.username,
    role: req.session.role
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

function carregarVtrsComMensagem(req, res, mensagem, mensagemTipo = 'success') {
    const unidadesIds = getUnidadeIds(req);
    
    // Garantir que os IDs sejam números inteiros
    const unidadesIdsInt = unidadesIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    
    if (unidadesIdsInt.length === 0 && req.session.role !== 'Administrador') {
        return res.status(403).send('Usuário não possui unidade vinculada.');
    }

    let sql = "SELECT c.*, u.nome as unidade_nome FROM carros c LEFT JOIN unidades u ON c.unidade_id = u.id";
    const params = [];
    if (unidadesIdsInt.length > 0 && req.session.role !== 'Administrador') {
        sql += " WHERE c.unidade_id IN (" + unidadesIdsInt.map(() => '?').join(',') + ")";
        params.push(...unidadesIdsInt);
    }
    sql += " ORDER BY u.nome ASC, c.numero_vtr ASC";
    
    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Erro ao carregar veículos:', err);
            return res.send("Erro ao carregar lista.");
        }
        
        // Buscar unidades para o select
        let unidadesQuery = "SELECT * FROM unidades ORDER BY nome ASC";
        let unidadesParams = [];
        
        // Se não for admin, mostrar apenas as unidades do usuário
        if (req.session.role !== 'Administrador' && unidadesIdsInt.length > 0) {
            unidadesQuery = "SELECT * FROM unidades WHERE id IN (" + unidadesIdsInt.map(() => '?').join(',') + ") ORDER BY nome ASC";
            unidadesParams = unidadesIdsInt;
        }
        
        db.all(unidadesQuery, unidadesParams, (errUnidades, unidades) => {
            if (errUnidades) {
                console.error('Erro ao carregar unidades:', errUnidades);
                unidades = [];
            }
            res.render('cadastrar-carro', {
                username: req.session.username,
                role: req.session.role,
                mensagem,
                mensagemTipo,
                vtrs: rows,
                unidades: unidades || [],
                unidadesIds: unidadesIdsInt
            });
        });
    });
}

// Usuários
app.get('/admin/cadastrar-usuario', requireAdmin, (req, res) => {
    // Buscar usuários com suas unidades (múltiplas)
    db.all(`
        SELECT DISTINCT u.id, u.username, u.tipo
        FROM usuarios u
        WHERE u.username != ?
        ORDER BY u.username ASC
    `, [ADMIN_USERNAME], (err, usuarios) => {
        if (err) return res.status(500).send('Erro ao carregar usuários.');
        
        // Para cada usuário, buscar suas unidades
        db.all("SELECT * FROM unidades ORDER BY nome ASC", [], (errUnidades, todasUnidades) => {
            if (errUnidades) todasUnidades = [];
            
            // Buscar unidades de cada usuário
            const usuariosComUnidades = [];
            let processados = 0;
            
            if (usuarios.length === 0) {
                return res.render('cadastrar-usuario', {
                    usuarios: [],
                    unidades: todasUnidades || [],
                    username: req.session.username,
                    role: req.session.role,
                    mensagem: null,
                    mensagemTipo: null
                });
            }
            
            usuarios.forEach((usuario, index) => {
                db.all(`
                    SELECT uu.unidade_id, un.nome as unidade_nome
                    FROM usuarios_unidades uu
                    JOIN unidades un ON uu.unidade_id = un.id
                    WHERE uu.usuario_id = ?
                    ORDER BY un.nome ASC
                `, [usuario.id], (errUnidades, unidades) => {
                    if (errUnidades) unidades = [];
                    usuario.unidades = unidades || [];
                    usuariosComUnidades.push(usuario);
                    
                    processados++;
                    if (processados === usuarios.length) {
                        res.render('cadastrar-usuario', {
                            usuarios: usuariosComUnidades,
                            unidades: todasUnidades || [],
                            username: req.session.username,
                            role: req.session.role,
                            mensagem: null,
                            mensagemTipo: null
                        });
                    }
                });
            });
        });
    });
});

app.post('/admin/cadastrar-usuario', requireAdmin, async (req, res) => {
    const { username, password, tipo, unidades } = req.body;
    if (!username || !password) {
        return carregarUsuariosComMensagem(req, res, 'Preencha todos os campos obrigatórios.', 'error');
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const tipoFinal = tipo || 'USUARIO';
        
        // Inserir usuário
        db.run("INSERT INTO usuarios (username, password, tipo) VALUES (?, ?, ?)", 
            [username, hashedPassword, tipoFinal], 
            function(err) {
                if (err) {
                    if (err.message.includes("UNIQUE")) {
                        return carregarUsuariosComMensagem(req, res, 'Usuário já existe!', 'error');
                    } else {
                        return carregarUsuariosComMensagem(req, res, 'Erro interno ao cadastrar usuário.', 'error');
                    }
                }
                
                const usuarioId = this.lastID;
                
                // Inserir unidades (se houver)
                if (unidades && Array.isArray(unidades) && unidades.length > 0) {
                    const unidadesIds = unidades.filter(id => id && id !== '');
                    if (unidadesIds.length > 0) {
                        const stmt = db.prepare("INSERT INTO usuarios_unidades (usuario_id, unidade_id) VALUES (?, ?)");
                        unidadesIds.forEach(unidadeId => {
                            stmt.run([usuarioId, parseInt(unidadeId, 10)]);
                        });
                        stmt.finalize();
                    }
                }
                
                return carregarUsuariosComMensagem(req, res, 'Usuário cadastrado com sucesso!', 'success');
            }
        );
    } catch (err) {
        return carregarUsuariosComMensagem(req, res, 'Erro interno ao cadastrar usuário.', 'error');
    }
});

app.post('/admin/editar-usuario', requireAdmin, (req, res) => {
    const { id, username, tipo, unidades } = req.body;
    if (!id) {
        return carregarUsuariosComMensagem(req, res, 'ID do usuário é obrigatório.', 'error');
    }

    // Verificar se não é o admin principal
    db.get("SELECT username FROM usuarios WHERE id = ?", [id], (err, user) => {
        if (err) return carregarUsuariosComMensagem(req, res, 'Erro ao verificar usuário.', 'error');
        if (user && user.username === ADMIN_USERNAME) {
            return carregarUsuariosComMensagem(req, res, 'Não é possível editar o administrador principal.', 'error');
        }

        // Remover todas as unidades atuais do usuário
        db.run("DELETE FROM usuarios_unidades WHERE usuario_id = ?", [id], (err) => {
            if (err) {
                return carregarUsuariosComMensagem(req, res, 'Erro ao atualizar unidades do usuário.', 'error');
            }
            
            // Inserir novas unidades (se houver)
            if (unidades && Array.isArray(unidades) && unidades.length > 0) {
                const unidadesIds = unidades.filter(u => u && u !== '');
                if (unidadesIds.length > 0) {
                    const stmt = db.prepare("INSERT INTO usuarios_unidades (usuario_id, unidade_id) VALUES (?, ?)");
                    unidadesIds.forEach(unidadeId => {
                        stmt.run([id, parseInt(unidadeId, 10)]);
                    });
                    stmt.finalize();
                }
            }
            
            return carregarUsuariosComMensagem(req, res, 'Unidades do usuário atualizadas com sucesso!', 'success');
        });
    });
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
    db.all(`
        SELECT DISTINCT u.id, u.username, u.tipo
        FROM usuarios u
        WHERE u.username != ?
        ORDER BY u.username ASC
    `, [ADMIN_USERNAME], (err, usuarios) => {
        if (err) return res.status(500).send('Erro ao carregar usuários.');
        
        db.all("SELECT * FROM unidades ORDER BY nome ASC", [], (errUnidades, todasUnidades) => {
            if (errUnidades) todasUnidades = [];
            
            const usuariosComUnidades = [];
            let processados = 0;
            
            if (usuarios.length === 0) {
                return res.render('cadastrar-usuario', {
                    usuarios: [],
                    unidades: todasUnidades || [],
                    username: req.session.username,
                    role: req.session.role,
                    mensagem,
                    mensagemTipo
                });
            }
            
            usuarios.forEach((usuario) => {
                db.all(`
                    SELECT uu.unidade_id, un.nome as unidade_nome
                    FROM usuarios_unidades uu
                    JOIN unidades un ON uu.unidade_id = un.id
                    WHERE uu.usuario_id = ?
                    ORDER BY un.nome ASC
                `, [usuario.id], (errUnidades, unidades) => {
                    if (errUnidades) unidades = [];
                    usuario.unidades = unidades || [];
                    usuariosComUnidades.push(usuario);
                    
                    processados++;
                    if (processados === usuarios.length) {
                        res.render('cadastrar-usuario', {
                            usuarios: usuariosComUnidades,
                            unidades: todasUnidades || [],
                            username: req.session.username,
                            role: req.session.role,
                            mensagem,
                            mensagemTipo
                        });
                    }
                });
            });
        });
    });
}


// Unidades (Empresas)
app.get('/cadastrar-unidade', requireAdmin, (req, res) => {
    db.all("SELECT * FROM unidades ORDER BY nome ASC", [], (err, rows) => {
        if (err) return res.status(500).send('Erro ao carregar unidades.');
        res.render('cadastrar-unidade', {
            unidades: rows || [],
            username: req.session.username,
            role: req.session.role,
            mensagem: null,
            mensagemTipo: null
        });
    });
});

app.post('/cadastrar-unidade', requireAdmin, (req, res) => {
    const { nome, codigo, endereco, telefone } = req.body;
    if (!nome) {
        return carregarUnidadesComMensagem(req, res, 'Nome da unidade é obrigatório.', 'error');
    }

    db.run("INSERT INTO unidades (nome, codigo, endereco, telefone) VALUES (?, ?, ?, ?)", 
        [nome, codigo || null, endereco || null, telefone || null], 
        function(err) {
            if (err) {
                if (err.message.includes("UNIQUE")) {
                    return carregarUnidadesComMensagem(req, res, 'Unidade já existe!', 'error');
                } else {
                    return carregarUnidadesComMensagem(req, res, 'Erro interno ao cadastrar unidade.', 'error');
                }
            }
            return carregarUnidadesComMensagem(req, res, 'Unidade cadastrada com sucesso!', 'success');
        }
    );
});

app.post('/editar-unidade', requireAdmin, (req, res) => {
    const { id, nome, codigo, endereco, telefone } = req.body;
    if (!id || !nome) {
        return carregarUnidadesComMensagem(req, res, 'ID e nome são obrigatórios.', 'error');
    }

    db.run("UPDATE unidades SET nome = ?, codigo = ?, endereco = ?, telefone = ? WHERE id = ?", 
        [nome, codigo || null, endereco || null, telefone || null, id], 
        function(err) {
            if (err) {
                if (err.message.includes("UNIQUE")) {
                    return carregarUnidadesComMensagem(req, res, 'Nome ou código já existe!', 'error');
                } else {
                    return carregarUnidadesComMensagem(req, res, 'Erro ao atualizar unidade.', 'error');
                }
            }
            return carregarUnidadesComMensagem(req, res, 'Unidade atualizada com sucesso!', 'success');
        }
    );
});

app.post('/deletar-unidade', requireAdmin, (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).send('ID da unidade é obrigatório.');

    // Verificar se há usuários vinculados (usando usuarios_unidades)
    db.get("SELECT COUNT(*) as count FROM usuarios_unidades WHERE unidade_id = ?", [id], (err, userCount) => {
        if (err) return res.status(500).send('Erro ao verificar usuários.');
        if (userCount.count > 0) {
            return carregarUnidadesComMensagem(req, res, 'Não é possível deletar unidade com usuários vinculados.', 'error');
        }

        db.get("SELECT COUNT(*) as count FROM carros WHERE unidade_id = ?", [id], (err, carCount) => {
            if (err) return res.status(500).send('Erro ao verificar carros.');
            if (carCount.count > 0) {
                return carregarUnidadesComMensagem(req, res, 'Não é possível deletar unidade com veículos vinculados.', 'error');
            }

            db.run("DELETE FROM unidades WHERE id = ?", [id], function(err) {
                if (err) return res.status(500).send('Erro ao deletar unidade.');
                res.redirect('/cadastrar-unidade');
            });
        });
    });
});

function carregarUnidadesComMensagem(req, res, mensagem, mensagemTipo) {
    db.all("SELECT * FROM unidades ORDER BY nome ASC", [], (err, rows) => {
        if (err) return res.status(500).send('Erro ao carregar unidades.');
        res.render('cadastrar-unidade', {
            unidades: rows || [],
            username: req.session.username,
            role: req.session.role,
            mensagem,
            mensagemTipo
        });
    });
}

// Uso de veículos (USUARIO)
app.get('/uso-veiculo', authorizeRoles(['USUARIO']), (req, res) => {
  const unidadesIds = getUnidadeIds(req);
  if (unidadesIds.length === 0) {
    return res.status(403).send('Usuário não possui unidade vinculada.');
  }
    const username = req.session.username;
    
    // Filtrar carros apenas das unidades do usuário
    let sqlCarros = "SELECT * FROM carros";
    const paramsCarros = [];
    if (unidadesIds.length > 0) {
        sqlCarros += " WHERE unidade_id IN (" + unidadesIds.map(() => '?').join(',') + ")";
        paramsCarros.push(...unidadesIds);
    }
    sqlCarros += " ORDER BY numero_vtr ASC";
    
    db.all(sqlCarros, paramsCarros, (err, vtrs) => {
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
    const { vtr_id, km_inicial, avarias, observacoes } = req.body;
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
                        `INSERT INTO usos_veiculos (vtr_id, km_inicial, vigilante_inicio, data_inicio, protocolo_id, avarias, observacoes)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [vtr_id, km_inicial, vigilante_inicio, agora, protocoloId, avarias || null, observacoes || null],
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
// Cache de consultas de gráficos
const graphsCache = new SimpleCache({ ttlMs: 60 * 1000, maxEntries: 500 });

function parseDateRange(req) {
  const from = (req.query.from || '').trim();
  const to = (req.query.to || '').trim();
  let where = '';
  const params = [];
  const clauses = [];
  if (from) { clauses.push('COALESCE(u.data_fim, u.data_inicio) >= ?'); params.push(`${from}T00:00:00`); }
  if (to) { clauses.push('COALESCE(u.data_fim, u.data_inicio) <= ?'); params.push(`${to}T23:59:59`); }
  if (clauses.length) { where = 'WHERE ' + clauses.join(' AND '); }
  return { where, params };
}

function granularityExpr(granularity) {
  const g = String(granularity || 'dia').toLowerCase();
  if (g === 'ano') return "STRFTIME('%Y', COALESCE(u.data_fim, u.data_inicio))";
  if (g === 'mes') return "STRFTIME('%Y-%m', COALESCE(u.data_fim, u.data_inicio))";
  return "DATE(COALESCE(u.data_fim, u.data_inicio))"; // dia
}

function kmDeltaExpr() {
  // Garante: valores numéricos, não negativos e km_final >= km_inicial.
  // Para registros inválidos, contabiliza 0 no agregado.
  return `CASE
    WHEN u.km_final IS NOT NULL
     AND u.km_inicial IS NOT NULL
     AND u.km_inicial >= 0
     AND u.km_final >= 0
     AND u.km_final >= u.km_inicial
    THEN (u.km_final - u.km_inicial)
    ELSE 0
  END`;
}

function cacheKey(prefix, query) {
  const entries = Object.entries(query).sort(([a],[b]) => a.localeCompare(b));
  return prefix + ':' + entries.map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

// Lista de VTRs para filtros
app.get('/graficos/lista-vtrs', authorizeRoles(['BASE']), (req, res) => {
  db.all('SELECT id, numero_vtr, modelo, tipo FROM carros ORDER BY numero_vtr ASC', [], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

// Dados agregados por usuário
app.get('/graficos/data/usuarios', authorizeRoles(['BASE']), (req, res) => {
  const username = (req.query.user || '').trim();
  const granularity = (req.query.granularity || 'dia').trim();
  if (!username) return res.status(400).json({ erro: 'Parâmetro user é obrigatório.' });

  const ck = cacheKey('user', req.query);
  const cached = graphsCache.get(ck);
  if (cached) return res.json(cached);

  const { where, params } = parseDateRange(req);
  const gExpr = granularityExpr(granularity);
  const delta = kmDeltaExpr();
  const sql = `
    SELECT ${gExpr} AS periodo, SUM(${delta}) AS km_total
    FROM usos_veiculos u
    ${where ? where + ' AND ' : 'WHERE '} (u.vigilante_inicio = ? OR u.vigilante_fim = ?)
    GROUP BY periodo
    ORDER BY periodo ASC
  `;
  db.all(sql, [...params, username, username], (err, rows) => {
    if (err) return res.status(500).json({ erro: 'Falha ao consultar km por usuário.' });
    const result = { granularity, user: username, data: rows };
    graphsCache.set(ck, result);
    res.json(result);
  });
});

// Dados agregados por VTR (aceita múltiplos ids via vtrId=1,2,3)
app.get('/graficos/data/vtrs', authorizeRoles(['BASE']), (req, res) => {
  const vtrIdsParam = (req.query.vtrId || '').trim();
  const granularity = (req.query.granularity || 'dia').trim();
  if (!vtrIdsParam) return res.status(400).json({ erro: 'Parâmetro vtrId é obrigatório.' });
  const vtrIds = vtrIdsParam.split(',').map(s => s.trim()).filter(Boolean);
  if (!vtrIds.length) return res.status(400).json({ erro: 'Nenhum vtrId válido informado.' });

  const ck = cacheKey('vtr', req.query);
  const cached = graphsCache.get(ck);
  if (cached) return res.json(cached);

  const { where, params } = parseDateRange(req);
  const gExpr = granularityExpr(granularity);
  const delta = kmDeltaExpr();

  // Monta SQL com IN (...) seguro via placeholders
  const placeholders = vtrIds.map(() => '?').join(',');
  const sql = `
    SELECT ${gExpr} AS periodo, u.vtr_id, SUM(${delta}) AS km_total
    FROM usos_veiculos u
    ${where ? where + ' AND ' : 'WHERE '} u.vtr_id IN (${placeholders})
    GROUP BY periodo, u.vtr_id
    ORDER BY periodo ASC
  `;
  db.all(sql, [...params, ...vtrIds], (err, rows) => {
    if (err) return res.status(500).json({ erro: 'Falha ao consultar km por VTR.' });
    // Enriquecer com labels
    db.all('SELECT id, numero_vtr, modelo FROM carros WHERE id IN (' + placeholders + ')', vtrIds, (err2, vtrs) => {
      const labels = {};
      if (!err2 && Array.isArray(vtrs)) {
        vtrs.forEach(v => { labels[v.id] = `${v.numero_vtr} - ${v.modelo}`; });
      }
      const result = { granularity, vtrIds, labels, data: rows };
      graphsCache.set(ck, result);
      res.json(result);
    });
  });
});

// Exportação CSV dos dados agregados
app.get('/graficos/export-csv', authorizeRoles(['BASE']), (req, res) => {
  const type = (req.query.type || '').trim();
  if (!['usuario','vtr'].includes(type)) return res.status(400).send('type deve ser usuario ou vtr');
  const ck = cacheKey('export:'+type, req.query);
  let cached = graphsCache.get(ck);
  const toCsv = (rows, headers) => {
    const escape = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const head = headers.map(h => escape(h)).join(',');
    const body = rows.map(r => headers.map(h => escape(r[h])).join(',')).join('\n');
    return head + '\n' + body;
  };
  const sendCsv = (rows, headers, name) => {
    const csv = toCsv(rows, headers);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${name}_${Date.now()}.csv"`);
    return res.send(csv);
  };
  if (cached) {
    const rows = cached.rows;
    const headers = cached.headers;
    const name = cached.name;
    return sendCsv(rows, headers, name);
  }
  if (type === 'usuario') {
    req.query.granularity = req.query.granularity || 'dia';
    const { where, params } = parseDateRange(req);
    const gExpr = granularityExpr(req.query.granularity);
    const delta = kmDeltaExpr();
    const sql = `
      SELECT ${gExpr} AS periodo, u.vigilante_inicio AS usuario, SUM(${delta}) AS km_total
      FROM usos_veiculos u
      ${where}
      GROUP BY periodo, usuario
      ORDER BY periodo ASC
    `;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).send('Erro ao exportar CSV.');
      const headers = ['periodo','usuario','km_total'];
      graphsCache.set(ck, { rows, headers, name: 'km_usuario' });
      return sendCsv(rows, headers, 'km_usuario');
    });
  } else {
    // vtr
    req.query.granularity = req.query.granularity || 'dia';
    const vtrIdsParam = (req.query.vtrId || '').trim();
    const vtrIds = vtrIdsParam ? vtrIdsParam.split(',').map(s => s.trim()).filter(Boolean) : [];
    const { where, params } = parseDateRange(req);
    const gExpr = granularityExpr(req.query.granularity);
    const delta = kmDeltaExpr();
    const placeholders = vtrIds.length ? vtrIds.map(() => '?').join(',') : '';
    const sql = `
      SELECT ${gExpr} AS periodo, u.vtr_id, SUM(${delta}) AS km_total
      FROM usos_veiculos u
      ${where ? where + (vtrIds.length ? ' AND ' : '') : (vtrIds.length ? 'WHERE ' : '')} ${vtrIds.length ? 'u.vtr_id IN ('+placeholders+')' : ''}
      GROUP BY periodo, u.vtr_id
      ORDER BY periodo ASC
    `;
    db.all(sql, [...params, ...vtrIds], (err, rows) => {
      if (err) return res.status(500).send('Erro ao exportar CSV.');
      const headers = ['periodo','vtr_id','km_total'];
      graphsCache.set(ck, { rows, headers, name: 'km_vtr' });
      return sendCsv(rows, headers, 'km_vtr');
    });
  }
});

// Exportação PDF dos dados agregados (sumário)
app.get('/graficos/export-pdf', authorizeRoles(['BASE']), (req, res) => {
  const type = (req.query.type || '').trim();
  const granularity = (req.query.granularity || 'dia').trim();
  const { where, params } = parseDateRange(req);
  const gExpr = granularityExpr(granularity);
  const delta = kmDeltaExpr();
  let sql, dataKey;
  if (type === 'usuario') {
    sql = `SELECT ${gExpr} AS periodo, u.vigilante_inicio AS usuario, SUM(${delta}) AS km_total FROM usos_veiculos u ${where} GROUP BY periodo, usuario ORDER BY periodo ASC`;
    dataKey = 'usuario';
  } else {
    sql = `SELECT ${gExpr} AS periodo, u.vtr_id AS vtr_id, SUM(${delta}) AS km_total FROM usos_veiculos u ${where} GROUP BY periodo, vtr_id ORDER BY periodo ASC`;
    dataKey = 'vtr_id';
  }
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).send('Erro ao exportar PDF.');
    // Gera PDF simples com tabela de período e valor
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="graficos_${type}_${Date.now()}.pdf"`);
    doc.pipe(res);
    doc.font('Helvetica-Bold').fontSize(16).text(`Resumo de KM (${type})`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Granularidade: ${granularity}`);
    if (req.query.from) doc.text(`De: ${req.query.from}`);
    if (req.query.to) doc.text(`Até: ${req.query.to}`);
    doc.moveDown();
    const headers = ['Período', type === 'usuario' ? 'Usuário' : 'VTR', 'KM Total'];
    doc.font('Helvetica-Bold');
    doc.text(headers.join(' | '));
    doc.moveDown(0.3);
    doc.font('Helvetica');
    rows.forEach(r => {
      const line = `${r.periodo} | ${r[dataKey] ?? '-'} | ${Number(r.km_total || 0).toFixed(2)}`;
      doc.text(line);
    });
    doc.end();
  });
});
