-- Índices recomendados para melhorar performance das consultas em /graficos

-- Índices por usuário (considera início e fim)
CREATE INDEX IF NOT EXISTS idx_usos_usuario_inicio_fim
  ON usos_veiculos (vigilante_inicio, data_inicio, data_fim);
CREATE INDEX IF NOT EXISTS idx_usos_usuario_fim_inicio
  ON usos_veiculos (vigilante_fim, data_inicio, data_fim);

-- Índices por VTR e período
CREATE INDEX IF NOT EXISTS idx_usos_vtr_periodo
  ON usos_veiculos (vtr_id, data_inicio, data_fim);

-- Índice geral por datas
CREATE INDEX IF NOT EXISTS idx_usos_datas
  ON usos_veiculos (data_inicio, data_fim);

-- Índice auxiliar em carros
CREATE INDEX IF NOT EXISTS idx_carros_numero
  ON carros (numero_vtr);

-- Observação: para aplicar em SQLite, execute este arquivo com o cliente SQLite
-- apontando para o banco (banco.db). Em ambientes de produção, incluir em pipeline
-- de migração controlada.