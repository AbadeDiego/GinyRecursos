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
| Remanejamentos | Origem real do cronograma, vínculo por projeto, aplicação imediata, edição, reversão atômica, cadeias, proteção de gastos e preservação do orçamento legado |
| Links e CSV | Protocolos permitidos, neutralização de fórmulas, BOM, aspas e multilinha |
| Persistência | Reabertura do banco e reinício do servidor preservam registros e anexos |
| Backup | Cópia consistente, integridade e servidor iniciado com backup restaurado |
| Produção | HTML, fonte local, cabeçalhos, cookie HttpOnly, parcelas mensais, despesa sem anexos, edição, exclusão, remanejamento e reinício pela camada HTTP real |
| Migração | Atualização do esquema anterior com contas e empresas preservadas; migração 4 mantém despesas e bytes dos anexos e roda uma única vez |
| Fontes | Limites, orçamento, CSV via API e parcelas mensais separados entre Subvenção e Contrapartida |
| Recursos | Edição de valores/tipo, substituição de comprovante, conflito de parcela, versão e exclusão |
| Relatório | Totais por fonte, extrato apenas da subvenção, isolamento entre projetos, HTML escapado e CSV |
| Rubricas | Personalizadas, duplicidade e limites de contrapartida |
| Planejamento legado acima do teto | Edição neutra, redução gradual, exclusão e remanejamento sem aumentar excesso; proteção de execução e rollback de reversões inválidas |
| Checklist | Cinco anexos opcionais em todas as rubricas, três orçamentos e contagem exata; conciliação sem anexos |
| Documentos gerais | Nome livre, upload, download, renomeação, substituição, exclusão, conflitos, idempotência, perfil consulta, autenticação e relatório |
| Excel no cronograma | XLS/XLSX reais, acentos e multilinha, primeira aba, números formatados, fontes e pró-labore; rollback por limite, fórmulas, corrupção, abas vazias e limite de linhas |
| Excel em documentos | XLS/XLSX, MIME, nome e bytes originais, substituição, download e rejeição de extensão falsa; preservação após backup no teste HTTP |
| Órgão personalizado | Nome livre persistido no projeto e no relatório, nome vazio rejeitado |
| Cadastro editável | Nome, termo, órgão, vigência, parcelas e valores; versão, idempotência, duplicidade, perfil consulta, limites por fonte, excesso legado, preservação de anexos e persistência HTTP após reinício |
| Recursos na Visão Geral | Edição de entradas das duas fontes pela mesma API, com totais recalculados e verificação HTTP |
| Links editáveis | Nome e URL, protocolos inválidos, conflito de versão e preservação da data original |

Comando reprodutível:

```sh
npm run test:all
```

Resultado da execução em 02/10/2026: **50 testes aprovados, zero falhas**, verificação TypeScript e build concluídos.

A suíte contém 49 testes de domínio/integração e 1 cenário HTTP de produção com múltiplas verificações. TypeScript e build fazem parte do comando. Arquivos em `tests/backend.test.mjs` e `tests/production.test.mjs`.

## Homologação no destino

Não há Docker daemon nem acesso à Hostinger/Coolify neste ambiente. O servidor standalone foi executado diretamente em Node.js. A imagem Docker e o deploy precisam ser validados no destino. O Chromium não está disponível neste ambiente; a tentativa de instalação da revisão anterior falhou no download. Não se afirma teste visual ponta a ponta das telas autenticadas nem da paginação final do PDF no navegador.

Antes do uso real:

1. Conferir login via HTTPS e cookie Secure.
2. Criar empresa/projeto e importar CSVs reais em homologação.
3. Criar, editar e excluir membro de teste, recarregando a página.
4. Alterar status do cronograma e confirmar após nova sessão.
5. Registrar recurso e despesa com documentos, baixar e conferir originais.
6. Reiniciar/recriar o contêiner preservando os volumes.
7. Restaurar um backup em cópia isolada, sem sobrescrever produção.
8. Conferir responsividade, filtros, valores e permissões por perfil.
9. Na Visão Geral, abrir Editar projeto, conferir os campos preenchidos, salvar e recarregar. Confirmar ausência de Importar CSV e Novo lançamento no cabeçalho.

Não foram realizados teste de carga, pentest externo ou integração bancária. A instalação atende uma organização com usuários autorizados e vários projetos. Não constitui um SaaS com organizações independentes isoladas.
