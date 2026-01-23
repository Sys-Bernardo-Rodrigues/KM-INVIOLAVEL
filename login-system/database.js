const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./banco.db');

db.serialize(() => {
    // Criação da tabela de unidades (empresas)
    db.run(`
        CREATE TABLE IF NOT EXISTS unidades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT UNIQUE NOT NULL,
            codigo TEXT UNIQUE,
            endereco TEXT,
            telefone TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Criação da tabela de usuários
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            unidade_id INTEGER,
            FOREIGN KEY (unidade_id) REFERENCES unidades(id)
        )
    `);

    // Criação da tabela de carros
    db.run(`
        CREATE TABLE IF NOT EXISTS carros (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero_vtr TEXT,
            tipo TEXT,
            modelo TEXT,
            unidade_id INTEGER,
            FOREIGN KEY (unidade_id) REFERENCES unidades(id),
            UNIQUE(numero_vtr, unidade_id)
        )
    `);

    // Adicionar coluna km_base (idempotente)
    db.run(`ALTER TABLE carros ADD COLUMN km_base INTEGER`, (err) => {
        if (err && !String(err.message).toLowerCase().includes('duplicate')) {
            console.warn('Aviso ao adicionar coluna km_base:', err.message);
        }
    });

     // Criação da tabela de usos_veiculos
    db.run(`
        CREATE TABLE IF NOT EXISTS usos_veiculos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vtr_id INTEGER,
        unidade_id INTEGER,
        km_inicial INTEGER,
        km_final INTEGER,
        vigilante_inicio TEXT,
        vigilante_fim TEXT,
        em_uso INTEGER DEFAULT 1,
        data_inicio DATETIME,
        data_fim DATETIME,
        abastecimento TEXT,
        avarias TEXT,
        observacoes TEXT,
        FOREIGN KEY (vtr_id) REFERENCES carros(id),
        FOREIGN KEY (unidade_id) REFERENCES unidades(id)
        )
    `);

    // Criação da tabela de protocolos de uso com snapshots do VTR
    db.run(`
        CREATE TABLE IF NOT EXISTS protocolos_uso (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            protocolo_codigo TEXT,
            vtr_id INTEGER,
            unidade_id INTEGER,
            numero_vtr_snapshot TEXT,
            tipo_snapshot TEXT,
            modelo_snapshot TEXT,
            created_at DATETIME,
            FOREIGN KEY (unidade_id) REFERENCES unidades(id),
            UNIQUE(protocolo_codigo, unidade_id)
        )
    `);

    // Tentar adicionar coluna de vínculo de protocolo em usos_veiculos (idempotente)
    db.run(`ALTER TABLE usos_veiculos ADD COLUMN protocolo_id INTEGER`, (err) => {
        if (err && !String(err.message).includes('duplicate column')) {
            console.warn('Aviso ao adicionar coluna protocolo_id:', err.message);
        }
    });

    // Tabela de relacionamento muitos-para-muitos entre usuarios e unidades
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios_unidades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            unidade_id INTEGER NOT NULL,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
            FOREIGN KEY (unidade_id) REFERENCES unidades(id) ON DELETE CASCADE,
            UNIQUE(usuario_id, unidade_id)
        )
    `);

    // Adicionar colunas unidade_id nas tabelas existentes (migração - manter para compatibilidade)
    db.run(`ALTER TABLE usuarios ADD COLUMN unidade_id INTEGER`, (err) => {
        if (err && !String(err.message).toLowerCase().includes('duplicate')) {
            console.warn('Aviso ao adicionar coluna unidade_id em usuarios:', err.message);
        }
    });

    db.run(`ALTER TABLE carros ADD COLUMN unidade_id INTEGER`, (err) => {
        if (err && !String(err.message).toLowerCase().includes('duplicate')) {
            console.warn('Aviso ao adicionar coluna unidade_id em carros:', err.message);
        }
    });

    db.run(`ALTER TABLE usos_veiculos ADD COLUMN unidade_id INTEGER`, (err) => {
        if (err && !String(err.message).toLowerCase().includes('duplicate')) {
            console.warn('Aviso ao adicionar coluna unidade_id em usos_veiculos:', err.message);
        }
    });

    db.run(`ALTER TABLE protocolos_uso ADD COLUMN unidade_id INTEGER`, (err) => {
        if (err && !String(err.message).toLowerCase().includes('duplicate')) {
            console.warn('Aviso ao adicionar coluna unidade_id em protocolos_uso:', err.message);
        }
    });
});

module.exports = db;
