const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./banco.db');

db.serialize(() => {
    // Criação da tabela de usuários
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        )
    `);

    // Criação da tabela de carros
    db.run(`
        CREATE TABLE IF NOT EXISTS carros (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero_vtr TEXT UNIQUE,
            tipo TEXT,
            modelo TEXT
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
        FOREIGN KEY (vtr_id) REFERENCES carros(id)
        )
    `);

    // Criação da tabela de protocolos de uso com snapshots do VTR
    db.run(`
        CREATE TABLE IF NOT EXISTS protocolos_uso (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            protocolo_codigo TEXT UNIQUE,
            vtr_id INTEGER,
            numero_vtr_snapshot TEXT,
            tipo_snapshot TEXT,
            modelo_snapshot TEXT,
            created_at DATETIME
        )
    `);

    // Tentar adicionar coluna de vínculo de protocolo em usos_veiculos (idempotente)
    db.run(`ALTER TABLE usos_veiculos ADD COLUMN protocolo_id INTEGER`, (err) => {
        if (err && !String(err.message).includes('duplicate column')) {
            console.warn('Aviso ao adicionar coluna protocolo_id:', err.message);
        }
    });
});

module.exports = db;
