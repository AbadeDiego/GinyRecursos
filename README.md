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
3. Faça o deploy. A migração 2 é executada automaticamente e preserva os registros anteriores; adiciona o cadastro de rubricas e detalhes de auditoria.
4. Confira `/api/health`, login, cronograma e lançamentos. Não recrie a instalação nem apague os volumes para atualizar.

A tela com campos separados deve usar **Protocol: https**, **Domain: somente o hostname** e **Port: 3000**. Em uma tela com um único campo Domains, use `https://hostname:3000`. `APP_ORIGIN` é sempre a URL pública HTTPS, sem a porta interna e sem barra final.

Se o container ficar em `restarting`, consulte os logs da aplicação: `scripts/check-env.mjs` rejeita origem inválida, HTTP público em produção ou senha inicial com menos de 12 caracteres.

## Fluxos atualizados

- **Visão geral:** Execução por rubrica lista apenas rubricas presentes no cronograma; sem previsões, o quadro fica vazio.
- **Planejamento e saldos:** a soma do cronograma de uma rubrica define seu valor planejado. Para rubricas sem cronograma, o orçamento anteriormente importado continua válido. Remanejamentos antigos aprovados continuam contabilizados. Ao planejar uma rubrica já existente, cadastre seu valor total; a previsão não pode ficar abaixo do que já foi gasto.
- **Pró-labore:** escolha Pessoal / Pró-labore, valor mensal, mês/ano inicial e quantidade de meses (1 a 60). Cada parcela é editável separadamente; a mudança de dezembro para janeiro avança o ano. As previsões não criam despesas automaticamente.
- **CSV do cronograma:** `rubrica;atividade;valor;mês`, com `ano` e `meses` opcionais. `meses` expande o pró-labore; `valor` é por mês. Sem `ano`, usa o primeiro mês correspondente a partir do início do projeto. O cabeçalho antigo `item` continua aceito.
- **Rubricas:** cadastro personalizado por projeto, disponível no cronograma, lançamentos e remanejamentos. Contrapartida está incluída; seu saldo usa o cronograma/orçamento da rubrica ou, na ausência deles, a contrapartida prevista do projeto.
- **Despesas:** documentos podem ser enviados depois, inclusive para serviços de terceiros. A despesa registrada conta no valor executado mesmo com anexos pendentes. A tabela, os detalhes e a Central de documentos destacam as pendências. A conferência bancária mantém a exigência de completar o checklist.
- **Edição/exclusão:** editar recalcula saldos e devolve despesas conciliadas para Em análise. A exclusão confirmada remove a despesa e seus anexos e recalcula os totais; a auditoria preserva os dados do registro excluído.
- **Remanejamento:** selecione um item real de origem, informe a rubrica e a atividade do novo item, mês/ano, valor e justificativa. A aprovação exige referência da autorização e valida novamente saldo e versão da origem. Um orçamento legado no destino é preservado como previsão no cronograma.
- **Tipografia:** Geist local, incluída com licença em `public/fonts`; o carregamento não depende de serviços externos.

## Funcionalidades

- Login, logout, troca de senha e usuários com perfis administrador, editor e consulta.
- Empresas e projetos persistentes.
- Equipe técnica com cadastro, edição, exclusão e importação CSV.
- Cronograma com cadastro manual, CSV, rubrica, mês/ano, edição e status. Pró-labore gera uma previsão por mês, com valor mensal e quantidade de meses.
- Orçamento por rubrica com importação atômica e validação de valores.
- Despesas e rascunhos, documentos reais, finalização e conferência com referência bancária.
- Parcelas, contrapartida financeira e rendimentos. Duplicações de parcelas e valores acima dos limites são rejeitados.
- Remanejamentos a partir de um item do cronograma: nova rubrica/atividade, mês/ano, valor e justificativa. A aprovação reduz a origem e cria a previsão de destino em uma única transação.
- Links HTTP/HTTPS, downloads autenticados, exportação CSV e resumo financeiro JSON.
- Auditoria das operações na API, disponível ao administrador.

**Acesso:** todos os usuários autorizados compartilham a mesma organização e seus projetos. Não existe isolamento de organizações independentes na mesma instalação.

**Conferência financeira:** o fluxo é calculado pelos registros cadastrados. Não existe integração bancária. Marcar uma despesa como conciliada registra a conferência feita pelo administrador, sem confirmar uma transação junto ao banco.

**Relatórios:** CSV de lançamentos e resumo financeiro JSON. Não há geração de relatórios oficiais do concedente, assinatura digital ou envio automático de prestação de contas.

**Documentos:** PDF, JPEG e PNG, até 10 MB por arquivo. Os bytes ficam no banco e nos backups. O backend verifica o cabeçalho do formato; isso não equivale a antivírus ou validação fiscal do conteúdo.

## Banco de dados

A migração versionada está em `server/database.mjs`; `docs/schema.sql` é a referência legível. A migração é executada automaticamente uma única vez. Não importe o SQL manualmente.

Tabelas de domínio: `companies`, `projects`, `team`, `schedule`, `budget`, `expenses`, `resources`, `remaps`, `rubrics` e `links`. `documents` relaciona arquivos às despesas e recursos. `users` e `sessions` guardam identidades e sessões; `audit` registra operações; `requests` evita repetição de requisições; `login_attempts` limita tentativas de senha; `migrations` registra a versão.

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
| `PATCH /api/remaps/:id` | Referência `authorization` recebida do concedente |
| `GET /api/documents/:id` | Original autenticado |
| `GET /api/reports/:projectId` | CSV de lançamentos |
| `GET /api/reports/:projectId?format=json` | Resumo financeiro |
| `GET /api/audit` | Últimas 500 operações, administrador |

## Estado da entrega

O código foi testado localmente. A imagem Docker, os volumes, DNS, TLS e o uso das telas precisam ser homologados na VPS. Não houve instalação na conta Hostinger nem alteração do endereço anterior de demonstração no ChatGPT. Testes reduzem o risco; não garantem ausência de bugs.

Referências oficiais:

- https://coolify.io/docs/applications/builds/docker-compose
- https://coolify.io/docs/applications/configuration/persistent-storage
- https://nextjs.org/docs/app/guides/self-hosting
- https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
- https://www.sqlite.org/wal.html
