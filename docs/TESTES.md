# Relatório de validação

Ambiente: Node.js 24.19.0, Linux, bancos SQLite temporários. A validação HTTP usa o servidor Next.js standalone gerado pelo build.

## Cobertura automatizada

| Fluxo | Verificações |
| --- | --- |
| Autenticação | Login, senha errada, sessão obrigatória, logout, revogação e limite de tentativas |
| Autorização | Consulta sem escrita, usuários, desativação e mudança de senha |
| Origem | Escrita com origem divergente bloqueada |
| Equipe | Inclusão, edição, exclusão, importação atômica e vínculos por projeto |
| Concorrência | Duas atualizações da mesma versão resultam em sucesso e conflito |
| Cronograma | Mês/ano, status, parcelas mensais atravessando o ano, edição de uma parcela e rollback por limite |
| Idempotência | Repetições JSON/multipart não duplicam; mesma chave com outros dados é recusada |
| Orçamento | Saldo por rubrica e rollback de importação incompatível com a execução |
| Despesas | Registro sem documentos, pendências, rascunho, edição, exclusão, saldos, auditoria e conferência |
| Upload | Armazenamento/download dos bytes; bloqueio de formatos inválidos e mais de 10 MB |
| Recursos | Parcelas únicas, limites e soma exata dos rendimentos |
| Remanejamentos | Origem real do cronograma, vínculo por projeto, saldo, autorização, destino e preservação do orçamento legado |
| Links e CSV | Protocolos permitidos, neutralização de fórmulas, BOM, aspas e multilinha |
| Persistência | Reabertura do banco e reinício do servidor preservam registros e anexos |
| Backup | Cópia consistente, integridade e servidor iniciado com backup restaurado |
| Produção | HTML, fonte local, cabeçalhos, cookie HttpOnly, parcelas mensais, despesa sem anexos, edição, exclusão, remanejamento e reinício pela camada HTTP real |
| Migração | Atualização do esquema anterior com contas e empresas preservadas |
| Rubricas | Personalizadas, duplicidade e limites de contrapartida |

Comando reprodutível:

```sh
npm run test:all
```

Resultado da execução em 27/09/2026: **25 testes aprovados, zero falhas**, verificação TypeScript e build concluídos.

A suíte contém 24 testes de domínio/integração e 1 cenário HTTP de produção com múltiplas verificações. TypeScript e build fazem parte do comando. Arquivos em `tests/backend.test.mjs` e `tests/production.test.mjs`.

## Homologação no destino

Não há Docker daemon nem acesso à Hostinger/Coolify neste ambiente. O servidor standalone foi executado diretamente em Node.js. A imagem Docker e o deploy precisam ser validados no destino. A tentativa de prévia no navegador remoto não alcançou o servidor local; não se afirma teste visual ponta a ponta das telas autenticadas.

Antes do uso real:

1. Conferir login via HTTPS e cookie Secure.
2. Criar empresa/projeto e importar CSVs reais em homologação.
3. Criar, editar e excluir membro de teste, recarregando a página.
4. Alterar status do cronograma e confirmar após nova sessão.
5. Registrar recurso e despesa com documentos, baixar e conferir originais.
6. Reiniciar/recriar o contêiner preservando os volumes.
7. Restaurar um backup em cópia isolada, sem sobrescrever produção.
8. Conferir responsividade, filtros, valores e permissões por perfil.

Não foram realizados teste de carga, pentest externo ou integração bancária. A instalação atende uma organização com usuários autorizados e vários projetos. Não constitui um SaaS com organizações independentes isoladas.
