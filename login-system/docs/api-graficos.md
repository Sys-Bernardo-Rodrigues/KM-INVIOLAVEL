# API de Gráficos (KM)

Esta documentação descreve a API utilizada pela página `/graficos` para agregação, comparação e exportação de dados de quilometragem por usuário e por viatura (VTR).

## Autorização
- Acesso restrito a usuários com papel `Administrador` ou `BASE`.

## Endpoints

- GET `/graficos/lista-vtrs`
  - Retorna a lista de viaturas para uso nos filtros.
  - Resposta: `[{ id, numero_vtr, modelo, tipo }]`

- GET `/graficos/data/usuarios`
  - Parâmetros:
    - `user`: string (obrigatório) – nome do usuário
    - `granularity`: `dia|mes|ano` (opcional, padrão: `dia`)
    - `from`: `YYYY-MM-DD` (opcional)
    - `to`: `YYYY-MM-DD` (opcional)
  - Resposta: `{ granularity, user, data: [{ periodo, km_total }] }`
  - Observação: considera usos onde `vigilante_inicio = user` ou `vigilante_fim = user`.

- GET `/graficos/data/vtrs`
  - Parâmetros:
    - `vtrId`: string de ids separados por vírgula (ex: `1,2,3`) – obrigatório
    - `granularity`: `dia|mes|ano` (opcional, padrão: `dia`)
    - `from`: `YYYY-MM-DD` (opcional)
    - `to`: `YYYY-MM-DD` (opcional)
  - Resposta: `{ granularity, vtrIds: number[], labels: { [id]: string }, data: [{ periodo, vtr_id, km_total }] }`

- GET `/graficos/export-csv`
  - Parâmetros:
    - `type`: `usuario|vtr` (obrigatório)
    - Demais filtros conforme os endpoints de dados acima.
  - Resposta: arquivo CSV contendo as colunas conforme o tipo:
    - `usuario`: `periodo, usuario, km_total`
    - `vtr`: `periodo, vtr_id, km_total`

- GET `/graficos/export-pdf`
  - Parâmetros:
    - `type`: `usuario|vtr` (obrigatório)
    - `granularity`: `dia|mes|ano`
    - `from`, `to`: `YYYY-MM-DD` (opcionais)
  - Resposta: arquivo PDF com tabela resumida dos períodos e valores de km.

## Cache
- Implementado via `utils/cache.js` com TTL e key baseada nos parâmetros de consulta.
- Chaves: `user`, `vtr`, `export:usuario`, `export:vtr`.
- O cache é idempotente e expira automaticamente; reiniciar o servidor também invalida.

## Cálculo de KM
- `km_total = SUM(COALESCE(km_final, km_inicial) - km_inicial)` por período (dia/mês/ano).
- A granularidade é aplicada via expressão de agrupamento sobre `data_inicio`/`data_fim`.

## Validação e Erros
- 400: parâmetros obrigatórios ausentes (ex: `user` vazio, `vtrId` vazio).
- 403: acesso negado quando o usuário não possui papel adequado.
- 500: falhas internas de consulta/agrupamento/exportação.

## Exemplos

1) Usuário, por mês (últimos 90 dias):
```
GET /graficos/data/usuarios?user=joao&granularity=mes&from=2025-08-01&to=2025-10-30
```

2) Duas VTRs, por dia (sem período):
```
GET /graficos/data/vtrs?vtrId=4,7&granularity=dia
```

3) Exportar CSV de VTR com período:
```
GET /graficos/export-csv?type=vtr&vtrId=4,7&granularity=mes&from=2025-07-01&to=2025-10-31
```

4) Exportar PDF de usuário com período:
```
GET /graficos/export-pdf?type=usuario&user=joao&granularity=ano&from=2024-01-01&to=2025-12-31
```

## Performance
- Recomenda-se criar índices conforme `docs/migrations/graficos-indexes.sql`.
- As rotas aplicam filtros de período e cache para consultas frequentes.