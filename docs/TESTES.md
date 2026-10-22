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
| Reclassificação pelo Cronograma | Atualização atômica da previsão, despesas e rascunhos vinculados; preservação de IDs, valores, fonte, conciliação, anexos e recorrência; checklist e percentuais recalculados; isolamento por atividade/projeto, rollback, auditoria, idempotência, conflitos e persistência após backup/restauração HTTP |
| Planejamento legado acima do teto | Edição neutra, redução gradual, exclusão e remanejamento sem aumentar excesso; proteção de execução e rollback de reversões inválidas |
| Substituição no lançamento | PATCH multipart com dados e anexos atômicos; mesmo ID/link, nome/MIME/bytes atualizados, preservação de outros anexos, checklist e rascunho, conciliação, auditoria, versão, idempotência, permissões, rollback e persistência no servidor HTTP após reinício e backup/restauração |
| Checklist | Diárias com recibo e pagamento; Pró-labore com INSS, recibo e pagamento; demais rubricas com cinco anexos opcionais; contagem e pendências por rubrica, recusa de orçamentos para Diárias e Pró-labore, preservação de anexos anteriores, download e idempotência |
| Status automático | Execução parcial/total, centavos, rascunhos, fonte e atividade independentes, realocação, exclusão, alteração da previsão e remanejamento, atraso, conflito de versão e auditoria |
| Migração 6 | Atualiza registros já vinculados uma única vez, ignora rascunhos, preserva valores e bytes dos documentos |
| Documentos gerais | Nome livre, upload, download, renomeação, substituição, exclusão, conflitos, idempotência, perfil consulta, autenticação e relatório |
| Excel no cronograma | XLS/XLSX reais, acentos e multilinha, primeira aba, números formatados, fontes e pró-labore; rollback por limite, fórmulas, corrupção, abas vazias e limite de linhas |
| Excel em documentos | XLS/XLSX, MIME, nome e bytes originais, substituição, download e rejeição de extensão falsa; preservação após backup no teste HTTP |
| Órgão concedente | Campo de texto livre no cadastro e edição, persistido no projeto e no relatório, nome vazio rejeitado |
| Períodos do cronograma | CSV/XLS/XLSX, mês único, intervalo, virada de ano, inferência pela vigência, término inválido, importação atômica, valores totais, pró-labore mensal, edição de legado, remanejamento e persistência HTTP após reinício |
| Atrasos | Prazo final, limite de mês no fuso de Brasília, status manual e exclusão de concluídas, sem mutação do registro |
| Atividade do lançamento | Seleção obrigatória; fonte, rubrica e projeto compatíveis; atividades da mesma rubrica independentes; centavos, rascunhos, edição, realocação, exclusão, idempotência, conflitos, anexos, relatório HTML/JSON/CSV e persistência HTTP |
| Vínculos do cronograma | Exclusão e alteração de fonte bloqueadas com despesas ou rascunhos; proteção do executado ao reduzir previsão/remanejar; edição de remanejamento mantém o ID do destino vinculado |
| Migração 5 | Banco anterior, despesas e comprovantes preservados; sem vínculo presumido; realocação manual, reabertura, chaves estrangeiras e migração única |
| Rubricas de lançamentos | Novas despesas e rascunhos exigem previsão no Cronograma do mesmo projeto e fonte; validação ao registrar rascunhos e ao trocar alocação; edição de despesas legadas preservada |
| Cadastro editável | Nome, termo, órgão, vigência, parcelas e valores; versão, idempotência, duplicidade, perfil consulta, limites por fonte, excesso legado, preservação de anexos e persistência HTTP após reinício |
| Recursos na Visão Geral | Edição de entradas das duas fontes pela mesma API, com totais recalculados e verificação HTTP |
| Links editáveis | Nome e URL, protocolos inválidos, conflito de versão e preservação da data original |

Comando reprodutível:

```sh
npm run test:all
```

Resultado da execução em 22/10/2026: **83 testes aprovados, zero falhas**, verificação TypeScript e build concluídos.

A suíte contém 82 testes de domínio/integração e 1 cenário HTTP de produção com múltiplas verificações. TypeScript e build fazem parte do comando. Arquivos em `tests/backend.test.mjs` e `tests/production.test.mjs`.

## Homologação no destino

Não há Docker daemon nem acesso à Hostinger/Coolify neste ambiente. O servidor standalone foi executado diretamente em Node.js. A imagem Docker e o deploy precisam ser validados no destino. A validação visual ponta a ponta não foi executada nesta revisão. Não se afirma teste visual ponta a ponta das telas autenticadas nem da paginação final do PDF no navegador.

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
10. Confirmar o órgão concedente como campo de texto. Em Novo lançamento, conferir rubricas por fonte, sem duplicação para previsões mensais, seleção vazia ao trocar fonte e orientação quando não há previsão. Confirmar ausência de Adicionar rubrica em Lançamentos.
11. No Cronograma, conferir o período compacto, abrir uma descrição longa, testar os filtros e o fundo vermelho claro em atividades vencidas. Conferir o novo modelo CSV, parcelas mensais e início/fim no mesmo mês.

12. Criar atividades distintas na mesma rubrica/fonte. Registrar uma despesa em apenas uma e conferir os percentuais independentes. Editar o vínculo e confirmar o recálculo. Testar busca, paginação, troca de projeto e filtro de lançamentos. Vincular um lançamento antigo e conferir a preservação de seus anexos.

13. Em Pró-labore, conferir somente os três anexos (INSS, recibo e pagamento), inclusive checklist e relatório; abrir anexos anteriores. Registrar valores parciais/totais e verificar o status automático da atividade, depois editar/excluir e conferir o recálculo.

14. Em Diária/Diárias, conferir apenas Recibo de diária e Comprovante de pagamento no cadastro e detalhes, ambos opcionais. Conferir checklist 0/2, 1/2 e 2/2, pendências no relatório e download dos anexos anteriores.

15. Editar a rubrica de uma previsão com lançamentos vinculados: conferir o aviso com a quantidade, salvar, abrir os lançamentos, validar a nova rubrica e os mesmos comprovantes. Conferir a fonte preservada e as pendências conforme o novo checklist.

16. Abrir Editar lançamento → Editar documentos. Baixar o arquivo atual, selecionar outro, cancelar a seleção e conferir que nada mudou. Selecionar novamente e salvar; conferir o novo download e os demais anexos preservados. Repetir com Pró-labore e Diárias e preencher uma posição ainda vazia.

Não foram realizados teste de carga, pentest externo ou integração bancária. A instalação atende uma organização com usuários autorizados e vários projetos. Não constitui um SaaS com organizações independentes isoladas.
