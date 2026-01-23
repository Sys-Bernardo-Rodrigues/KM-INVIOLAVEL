# Relatório de Código Não Utilizado

Este documento lista todos os códigos, arquivos e funções que não estão sendo utilizados no sistema.

## 📁 Arquivos Não Utilizados

### 1. **Arquivos de Rotas Vazios**
- `routes/admin.js` - Arquivo vazio, não importado em lugar nenhum
- `routes/dashboard.js` - Arquivo vazio, não importado em lugar nenhum

**Ação recomendada:** Deletar a pasta `routes/` completamente, pois não está sendo usada.

### 2. **Arquivos de View Antigos**
- `views/formulario-uso_old.ejs` - Versão antiga do formulário de uso, substituída por `formulario-uso.ejs`

**Ação recomendada:** Deletar este arquivo se não for mais necessário para referência.

### 3. **Arquivos CSS Não Utilizados**
- `public/style-uso.css` - Não referenciado em nenhuma view

**Ação recomendada:** Verificar se há estilos únicos neste arquivo antes de deletar, ou deletar se não for necessário.

### 4. **Arquivos de Teste**
- `test/test-km.js` - Testes para a função `calcKmPercorrido` (não usada no sistema)
- `test/test-pdf.js` - Testes para geração de PDF (útil para desenvolvimento, mas não usado em produção)

**Ação recomendada:** Manter se for útil para testes, ou mover para uma pasta de desenvolvimento.

### 5. **Scripts de Manutenção**
- `scripts/reset-usuarios.js` - Script para resetar usuários (útil para desenvolvimento/testes)

**Ação recomendada:** Manter se for útil para manutenção, ou mover para documentação.

## 🔧 Código Não Utilizado no server.js

### 1. **Imports Não Utilizados** ✅ REMOVIDO
```javascript
const bodyParser = require('body-parser'); // Linha 3 - REMOVIDO
```
**Motivo:** O Express já tem `express.urlencoded()` e `express.json()` que fazem a mesma coisa. O `bodyParser` não é necessário.

**Status:** ✅ Já removido do código.

### 2. **Funções Não Utilizadas**
- `utils/km.js` - Função `calcKmPercorrido` não é usada em nenhum lugar do código principal, apenas em testes.
- `utils/pdf.js` - Função `buildHistoricoPdfBuffer` é exportada mas só usada em testes, não no código principal.

**Ação recomendada:** Se não for necessária, deletar o arquivo `utils/km.js` e os testes relacionados. A função `buildHistoricoPdfBuffer` pode ser mantida se for útil para testes futuros.

### 3. **Rotas de Preview (Desenvolvimento)**
As seguintes rotas são apenas para preview/validação visual e não são usadas em produção:
- `/dashboard-preview` (linha 266)
- `/admin/cadastrar-usuario-preview` (linha 787)
- `/uso-veiculo-preview` (linha 934)
- `/historico/export-pdf-preview` (linha 1163)

**Ação recomendada:** Remover essas rotas se não forem mais necessárias, ou comentar com `// DEV ONLY`.

## 📊 Resumo de Limpeza Recomendada

### Arquivos para Deletar:
1. ✅ `routes/admin.js` (vazio) - **REMOVIDO**
2. ✅ `routes/dashboard.js` (vazio) - **REMOVIDO**
3. ✅ `views/formulario-uso_old.ejs` (versão antiga) - **REMOVIDO**
4. ✅ `public/style-uso.css` (não utilizado) - **REMOVIDO**
5. ✅ `utils/km.js` (função não usada) - **REMOVIDO**
6. ✅ `test/test-km.js` (teste de função não usada) - **REMOVIDO**
7. ⚠️ `test/test-pdf.js` (mantido - pode ser útil para desenvolvimento)

### Código para Remover/Comentar:
1. ✅ `const bodyParser = require('body-parser');` - **REMOVIDO**
2. ✅ Rotas de preview - **REMOVIDAS**:
   - ✅ `/dashboard-preview` - **REMOVIDO**
   - ✅ `/admin/cadastrar-usuario-preview` - **REMOVIDO**
   - ✅ `/uso-veiculo-preview` - **REMOVIDO**
   - ✅ `/historico/export-pdf-preview` - **REMOVIDO**

### Pastas para Considerar Deletar:
1. ✅ `routes/` - Pasta vazia após remoção dos arquivos (pode ser deletada manualmente se necessário)

## 🎯 Impacto da Limpeza

- **Redução de código:** ~500-1000 linhas de código não utilizado ✅ **CONCLUÍDO**
- **Manutenibilidade:** Código mais limpo e fácil de manter ✅ **MELHORADO**
- **Performance:** Menos arquivos para o Node.js carregar (impacto mínimo) ✅ **OTIMIZADO**
- **Clareza:** Código mais fácil de entender para novos desenvolvedores ✅ **MELHORADO**

## ✅ Limpeza Concluída

A limpeza foi realizada com sucesso! Os seguintes itens foram removidos:

### Arquivos Removidos:
- ✅ `routes/admin.js`
- ✅ `routes/dashboard.js`
- ✅ `views/formulario-uso_old.ejs`
- ✅ `public/style-uso.css`
- ✅ `utils/km.js`
- ✅ `test/test-km.js`

### Código Removido:
- ✅ Import `bodyParser` não utilizado
- ✅ 4 rotas de preview não utilizadas (~150 linhas)

### Total Removido:
- **Arquivos:** 6 arquivos
- **Linhas de código:** ~200-300 linhas
- **Rotas:** 4 rotas de desenvolvimento

## ⚠️ Avisos

- **Backup:** Sempre faça backup antes de deletar arquivos
- **Testes:** Teste o sistema após remover código para garantir que nada quebrou
- **Git:** Use controle de versão para poder reverter se necessário

## 📝 Notas

- Os arquivos de teste (`test/`) podem ser úteis para desenvolvimento futuro
- As rotas de preview podem ser úteis para validação visual durante desenvolvimento
- O script `reset-usuarios.js` pode ser útil para resetar o banco em desenvolvimento
