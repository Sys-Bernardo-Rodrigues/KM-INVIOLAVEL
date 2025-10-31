# Manual do Usuário – Gráficos de Quilometragem

Este manual explica como utilizar a página `Gráficos` para visualizar e exportar dados de quilometragem por usuário e por viatura (VTR).

## Acesso
- Acesse o menu `Gráficos` no topo (visível para `Administrador` e `BASE`).

## Filtros por Usuário
- Campo `Usuário`: selecione o usuário desejado. O usuário logado aparece por padrão.
- `Granularidade`: escolha `Dia`, `Mês` ou `Ano` conforme a análise desejada.
- `Data início` e `Data fim`: defina um período específico.
- `Comparar período`: marque para exibir uma segunda série (defina o segundo intervalo).

## Filtros por VTR
- Campo `VTR(s)`: selecione uma ou mais viaturas. A lista é carregada automaticamente.
- `Granularidade`: escolha `Dia`, `Mês` ou `Ano`.
- `Data início` e `Data fim`: defina um período específico.

## Visualização
- `KM por Usuário`: gráfico de barras com a soma de km por período.
- `KM por VTR`: gráfico de barras com séries por VTR e períodos no eixo X.
- Os gráficos são responsivos e se adaptam a diferentes tamanhos de tela.

## Exportação
- Botões `Exportar Usuário (CSV/PDF)` e `Exportar VTR (CSV/PDF)` geram arquivos com os dados filtrados.
- A exportação respeita os filtros de período e granularidade selecionados.

## Mensagens e Erros
- Se faltar selecionar usuário ou VTR, uma mensagem é exibida em vermelho abaixo do gráfico.
- Em caso de erro de comunicação, as mensagens de erro aparecem na área do gráfico correspondente.

## Boas Práticas
- Use períodos mais curtos para análises detalhadas por `Dia`.
- Para comparações longas, prefira `Mês` ou `Ano`.
- Se os dados estiverem grandes, utilize exportações CSV/PDF para análise externa.