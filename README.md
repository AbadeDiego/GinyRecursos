# Gestão de Subvenção — Coolify / Hostinger

Aplicação React/Next.js com API Node.js 24, autenticação própria e banco SQLite persistente. Substitui o estado demonstrativo por dados reais. O banco e as tabelas são criados automaticamente na primeira inicialização. O pacote não inclui dados de exemplo nem senhas prontas.

## Instalação no Coolify

É necessária uma **VPS com Docker e Coolify**, acesso administrativo e um domínio. Hospedagem compartilhada não executa este pacote Docker.

1. Extraia o ZIP e envie o conteúdo para um repositório Git privado sob seu controle. `Dockerfile`, `compose.yaml` e `package.json` ficam na raiz.
2. No Coolify, crie uma aplicação com esse repositório. Selecione **Docker Compose** como Build Pack, `/` como Base Directory e `/compose.yaml` como Docker Compose Location.
3. Configure as variáveis abaixo no painel, sem salvar senhas no repositório.
4. No serviço `app`, configure o domínio com a porta interna, por exemplo `https://gestao.seudominio.com.br:3000`. A URL dos visitantes continua sem `:3000`.
5. Confirme os volumes `app_data` em `/data` e `app_backups` em `/backups`, já declarados no Compose.
6. Faça o deploy, aguarde o estado saudável e abra a URL HTTPS. Entre com as credenciais iniciais configuradas.
7. Cadastre empresa, projeto e orçamento. Teste uma despesa com documentos e reinicie o serviço para confirmar a persistência no servidor.

| Variável | Valor |
| --- | --- |
| `APP_ORIGIN` | URL pública exata, como `https://gestao.seudominio.com.br`, sem porta interna, caminho ou barra final |
| `ADMIN_EMAIL` | E-mail do administrador inicial |
| `ADMIN_PASSWORD` | Senha única com pelo menos 12 caracteres |
| `ADMIN_NAME` | Nome do administrador inicial |
| `DATABASE_PATH` | Já definido como `/data/subvencao.sqlite` no Compose |

`ADMIN_*` só cria o primeiro usuário quando o banco está vazio. Alterar essas variáveis depois não redefine senhas já cadastradas. Use **Conta e acessos** para trocar sua senha ou gerenciar usuários. Membros da equipe técnica não recebem contas automaticamente.

Utilize **uma única réplica**, com disco local. Não compartilhe o arquivo SQLite por NFS nem distribua réplicas entre servidores. Esta configuração atende uma organização em uma VPS. Múltiplos servidores ou grande volume de escrita simultânea exigirão migração para PostgreSQL e armazenamento externo de arquivos.

## Atualização de uma instalação existente

1. Execute `node scripts/backup.mjs` no container atual e guarde uma cópia fora da VPS.
2. Atualize os arquivos no mesmo repositório e recurso do Coolify. Mantenha os volumes existentes, especialmente `/data`, e as variáveis de ambiente.
3. Faça o deploy. As migrações são executadas automaticamente. A migração 4 cria o armazenamento dos documentos gerais sem alterar os comprovantes existentes. A migração 3 preserva contas, documentos e valores e adiciona a fonte aos registros anteriores; confira a classificação indicada na edição de cada registro.
4. Confira `/api/health`, login, cronograma e lançamentos. Não recrie a instalação nem apague os volumes para atualizar.

A tela com campos separados deve usar **Protocol: https**, **Domain: somente o hostname** e **Port: 3000**. Em uma tela com um único campo Domains, use `https://hostname:3000`. `APP_ORIGIN` é sempre a URL pública HTTPS, sem a porta interna e sem barra final.

Se o container ficar em `restarting`, consulte os logs da aplicação: `scripts/check-env.mjs` rejeita origem inválida, HTTP público em produção ou senha inicial com menos de 12 caracteres.

## Fluxos atualizados

- **Visão geral:** Execução por rubrica lista apenas rubricas presentes no cronograma; sem previsões, o quadro fica vazio.
- **Planejamento e saldos:** a soma do cronograma por rubrica e fonte define seu valor planejado. Subvenção e contrapartida têm limites separados. Para pares de rubrica/fonte sem cronograma, o orçamento anteriormente importado continua válido. Remanejamentos antigos aprovados continuam contabilizados. Ao planejar uma rubrica já existente, cadastre seu valor total; a previsão não pode ficar abaixo do que já foi gasto.
- **Pró-labore:** escolha Pessoal / Pró-labore, valor mensal, mês/ano inicial e quantidade de meses (1 a 60). Cada parcela é editável separadamente; a mudança de dezembro para janeiro avança o ano. As previsões não criam despesas automaticamente.
- **CSV do cronograma:** `rubrica;fonte;atividade;valor;mês;ano;meses`. Fonte aceita `Subvenção` ou `Contrapartida`; `ano` e `meses` são opcionais. Arquivos anteriores sem fonte continuam aceitos: Subvenção é o padrão, exceto a rubrica Contrapartida. `meses` expande o pró-labore; `valor` é por mês. Sem `ano`, usa o primeiro mês correspondente a partir do início do projeto. O cabeçalho antigo `item` continua aceito.
- **Rubricas:** cadastro personalizado por projeto, disponível no cronograma, lançamentos e remanejamentos. Contrapartida está incluída; seu saldo usa o cronograma/orçamento da rubrica e fonte ou, na ausência deles, a contrapartida prevista ainda não alocada a outras rubricas dessa fonte.
- **Despesas:** documentos podem ser enviados depois, inclusive para serviços de terceiros. A despesa registrada conta no valor executado mesmo com anexos pendentes. A tabela, os detalhes e o checklist por rubrica em Lançamentos destacam os anexos faltantes. As cinco posições (nota fiscal/recibo, comprovante e três orçamentos) estão disponíveis em todas as rubricas; todas são opcionais. A conferência bancária também aceita anexos pendentes.
- **Edição/exclusão:** editar recalcula saldos e devolve despesas conciliadas para Em análise. A exclusão confirmada remove a despesa e seus anexos e recalcula os totais; a auditoria preserva os dados do registro excluído.
- **Remanejamento:** selecione um item real de origem, informe a rubrica e a atividade do novo item, mês/ano, valor e justificativa. O valor é aplicado imediatamente, na mesma fonte da origem. Editar recalcula a transferência e excluir devolve o valor à origem; gastos no destino e remanejamentos posteriores impedem reversões incompatíveis. Justificativa e prazos continuam editáveis em transferências encadeadas. Um orçamento legado no destino é preservado como previsão no cronograma.
- **Recursos e parcelas:** edição e exclusão recalculam entradas e saldos. A edição aceita substituir o comprovante; excluir remove o comprovante e libera o número da parcela.
- **Cronograma:** fonte selecionável no cadastro manual e no CSV; exclusão disponível dentro da edição, com confirmação.
- **Dados anteriores:** a fonte é inferida do orçamento quando há uma única fonte para a rubrica; nos demais casos, Subvenção, exceto a rubrica Contrapartida. Registros migrados exibem “Conferir fonte”. Remanejamentos antigos pendentes são aplicados ao editar e salvar, sem aprovação separada.
- **Tipografia:** Geist local, incluída com licença em `public/fonts`; o carregamento não depende de serviços externos.

## Funcionalidades

- Login, logout, troca de senha e usuários com perfis administrador, editor e consulta.
- Empresas e projetos persistentes.
- Equipe técnica com cadastro, edição, exclusão e importação CSV.
- Cronograma com cadastro manual, CSV, rubrica, mês/ano, edição e status. Pró-labore gera uma previsão por mês, com valor mensal e quantidade de meses.
- Orçamento por rubrica com importação atômica e validação de valores.
- Despesas e rascunhos, documentos reais, finalização e conferência com referência bancária.
- Parcelas, contrapartida financeira e rendimentos. Duplicações de parcelas e valores acima dos limites são rejeitados.
- Remanejamentos a partir de um item do cronograma: nova rubrica/atividade, mês/ano, valor e justificativa. Salvar reduz a origem e cria a previsão de destino em uma única transação, sem etapa de aprovação.
- Links HTTP/HTTPS, downloads autenticados, exportação CSV e resumo financeiro JSON.
- Auditoria das operações na API, disponível ao administrador.

**Acesso:** todos os usuários autorizados compartilham a mesma organização e seus projetos. Não existe isolamento de organizações independentes na mesma instalação.

**Conferência financeira:** somente a conta de subvenção participa da conciliação, incluindo parcelas, rendimentos e despesas cuja fonte é Subvenção. O fluxo é calculado pelos registros cadastrados. Não existe integração bancária. Marcar uma despesa como conciliada registra a conferência feita pelo administrador, sem confirmar uma transação junto ao banco.

**Relatórios:** relatório HTML com resumo por fonte, planejamento/execução por rubrica, recursos, despesas e documentos, conciliação da subvenção, cronograma, remanejamentos, equipe, documentos gerais e links. O botão Imprimir / Salvar em PDF usa o navegador. Exportações de lançamentos CSV e de dados completos JSON também estão disponíveis. Não há geração de relatórios oficiais do concedente, assinatura digital ou envio automático de prestação de contas.

**Documentos:** PDF, JPEG e PNG, até 10 MB por arquivo. Os bytes ficam no banco e nos backups. O backend verifica o cabeçalho do formato; isso não equivale a antivírus ou validação fiscal do conteúdo.

## Banco de dados

A migração versionada está em `server/database.mjs`; `docs/schema.sql` é a referência legível. A migração é executada automaticamente uma única vez. Não importe o SQL manualmente.

Tabelas de domínio: `companies`, `projects`, `team`, `schedule`, `budget`, `expenses`, `resources`, `remaps`, `rubrics` e `links`. `documents` relaciona arquivos às despesas e recursos. `projectDocuments` armazena os documentos gerais nomeados, com arquivo original, metadados e controle de versão. `users` e `sessions` guardam identidades e sessões; `audit` registra operações; `requests` evita repetição de requisições; `login_attempts` limita tentativas de senha; `migrations` registra a versão.

Chaves estrangeiras mantêm a vinculação dos registros. Os valores movimentados são armazenados também em centavos inteiros e os cálculos somam centavos. Edições exigem a versão atual do registro e retornam conflito em vez de sobrescrever outra alteração.

As importações de equipe e cronograma **adicionam** registros. O orçamento é **substituído integralmente**, mas a operação é revertida se alguma rubrica ficar abaixo do valor já executado/remanejado. Limite de 2.000 linhas, UTF-8, vírgula ou ponto e vírgula, aspas escapadas e descrições multilinha.

Não apague `/data` nem execute `docker compose down -v` em uma instalação com dados importantes.

## Backup

No terminal do serviço `app` no Coolify, execute:

```sh
node scripts/backup.mjs
```

O comando usa a API de backup SQLite, funciona com o banco em uso e verifica a integridade da cópia. Salva um arquivo datado em `/backups`, incluindo documentos e contas. Configure uma tarefa diária no Coolify e transfira cópias confidenciais para armazenamento privado fora da VPS. O pacote fornece o comando; agendamento, retenção e cópia externa precisam ser configurados no ambiente real.

### Restauração

1. Pare o serviço e preserve uma cópia do volume atual.
2. Verifique o backup com `PRAGMA integrity_check` em SQLite.
3. Com o serviço parado, substitua `/data/subvencao.sqlite`. Depois de preservar a cópia anterior, remova os journals antigos `subvencao.sqlite-wal` e `subvencao.sqlite-shm` nesse diretório de restauração. Não misture o backup com journals antigos.
4. Mantenha o arquivo e o diretório acessíveis ao usuário `node` do contêiner (UID 1000).
5. Reinicie e confira registros, totais e downloads. A restauração inclui contas e sessões ainda válidas da data do backup.

Não copie apenas o arquivo principal de um banco ativo sem a API de backup, pois dados recentes podem estar no WAL.

### Recuperação administrativa

No terminal do contêiner, configure `USER_EMAIL` e `USER_PASSWORD` de forma privada e execute:

```sh
node scripts/user.mjs reset
```

O comando redefine a senha e revoga sessões. Não registre senhas reais em comandos compartilhados ou Git. Para criar uma conta via terminal, configure também `USER_NAME` e opcionalmente `USER_ROLE`, executando `node scripts/user.mjs` sem `reset`.

## Desenvolvimento e testes

Requer Node.js 24 e npm. Copie `.env.example` para `.env`, configure a senha e mantenha `APP_ORIGIN=http://localhost:3000`.

```sh
npm ci
npm run dev
```

Validação e execução de produção:

```sh
npm run test:all
npm start
```

`test:all` executa API, TypeScript, build otimizado e testes HTTP do servidor standalone. Os testes usam bancos temporários. Consulte `docs/TESTES.md` para cobertura e limites.

## API

Exceto login e healthcheck, as rotas exigem cookie de sessão. Escritas precisam de `Origin` igual a `APP_ORIGIN`; mutações de domínio também exigem `Idempotency-Key` único por operação. A interface já envia esses dados.

| Método e caminho | Função |
| --- | --- |
| `POST /api/rubrics` | Cadastro de rubrica personalizada por projeto |
| `DELETE /api/expenses/:id` | Exclusão com versão, anexos removidos e auditoria |
| `GET /api/health` | Disponibilidade do banco |
| `POST /api/auth/login` | Login |
| `POST /api/auth/logout` | Revogação da sessão |
| `POST /api/auth/password` | Troca de senha e revogação das sessões |
| `GET /api/state` | Dados da organização |
| `GET/POST /api/users` | Administração de contas |
| `PATCH /api/users/:id` | Ativação/desativação |
| `POST /api/companies`, `/api/projects` | Cadastro |
| `POST /api/team`, `/api/schedule`, `/api/links` | Cadastro por projeto |
| `PATCH/DELETE /api/team/:id`, `/api/schedule/:id`, `/api/links/:id` | Edição/exclusão com versão |
| `POST /api/team/import`, `/api/schedule/import`, `/api/budget/import` | Linhas interpretadas do CSV em transação |
| `POST /api/expenses`, `/api/resources` | JSON ou multipart com campo JSON `data` e arquivos |
| `POST /api/expenses/:id/documents`, `/api/resources/:id/documents` | Anexos multipart |
| `PATCH /api/expenses/:id` | `edit` com campos da despesa, `submit` ou `reconcile` com `bankReference`; exige versão |
| `POST /api/remaps` | Solicitação |
| `PATCH/DELETE /api/remaps/:id` | Editar/reverter a transferência, com versão e validação de saldos |
| `PATCH/DELETE /api/resources/:id` | Editar/excluir recursos; anexos preservados ou substituídos na edição |
| `GET /api/documents/:id` | Original autenticado |
| `GET /api/reports/:projectId` | CSV de lançamentos |
| `GET /api/reports/:projectId?format=json` | Dados completos do projeto, incluindo resumo por fonte |
| `GET /api/reports/:projectId?format=html` | Relatório para visualizar, imprimir ou salvar em PDF |
| `GET /api/audit` | Últimas 500 operações, administrador |

## Estado da entrega

O código foi testado localmente. A imagem Docker, os volumes, DNS, TLS e o uso das telas precisam ser homologados na VPS. Não houve instalação na conta Hostinger nem alteração do endereço anterior de demonstração no ChatGPT. Testes reduzem o risco; não garantem ausência de bugs.

Referências oficiais:

- https://coolify.io/docs/applications/builds/docker-compose
- https://coolify.io/docs/applications/configuration/persistent-storage
- https://nextjs.org/docs/app/guides/self-hosting
- https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
- https://www.sqlite.org/wal.html

## Ajustes de planejamento e documentos

- Planejamentos anteriores acima do teto podem receber edições neutras, reduções graduais e exclusões que não aumentem o excesso. O aviso permanece visível no Cronograma e nos Remanejamentos até regularização. A operação não pode diminuir a cobertura de despesas já executadas nem ampliar um déficit preexistente. Novas previsões e importações continuam sujeitas aos limites por fonte.
- Remanejamentos conservam o total por fonte e aceitam edição e reversão, com proteção de despesas e transferências posteriores. A justificativa tem área própria, preserva parágrafos e permite expandir textos longos.
- Documentos é o arquivo geral do projeto: nome livre, upload, renomeação, substituição, download e exclusão. Exemplos: projeto original e termo de outorga. Os anexos de despesas continuam em Lançamentos, agrupados por rubrica e fonte.
- Links importantes permitem editar nome e endereço mantendo a data de cadastro.
- Relatórios tem uma ação principal de visualização/impressão, exportação CSV separada e JSON na seção de uso técnico. JSON contém registros e metadados, não os bytes dos anexos.

| Rota de documentos gerais | Função |
| --- | --- |
| `POST /api/projectDocuments` | Nome e arquivo multipart na chave `project`, vinculados ao `projectId` |
| `PATCH /api/projectDocuments/:id` | Nome e, opcionalmente, novo arquivo; exige `version` atual |
| `DELETE /api/projectDocuments/:id` | Exclusão com versão, auditoria e idempotência |
| `GET /api/projectDocuments/:id` | Download original autenticado |

O estado inclui `projectDocuments` sem os bytes dos arquivos. A migração não exige apagar ou recriar o banco.
