# API — referência de execução

API HTTP em Node.js 22+, PostgreSQL e `pg`. O servidor está em `src/server.mjs`; as migrations SQL em `migrations/` definem o schema ativo. A visão de implantação, modelo relacional e fluxos Mermaid estão em [docs/architecture.md](../../docs/architecture.md).

## Autenticação e autorização

As rotas protegidas recebem `Authorization: Bearer <token>`. O login Google verifica assinatura RS256, emissor, expiração, audiência em `GOOGLE_CLIENT_IDS` e `email_verified`. A API identifica a pessoa pelo `sub` do Google e retorna um token de sessão HMAC com validade de oito horas. A cada requisição, confere se a conta continua ativa.

`INITIAL_ADMIN_EMAIL` define o único administrador inicial. O endpoint de gestão de usuários não permite atribuir ADMIN. Os demais perfis são `HIRING_MANAGER`, `RECRUITER` e `APPROVER`; as ações também verificam o escopo da vaga. `POST /auth/demo` só está disponível se `ENABLE_DEMO_AUTH=true` e `NODE_ENV=development`.

## Rotas principais

| Método | Rota | Acesso e propósito |
| --- | --- | --- |
| `GET` | `/health` | Público; verifica conexão com o banco. |
| `POST` | `/auth/google` | Público; troca credencial Google validada por sessão. |
| `POST` | `/auth/demo` | Apenas desenvolvimento, quando explicitamente habilitado. |
| `GET` | `/auth/me` | Sessão autenticada. |
| `GET` | `/users` | ADMIN; lista usuários e vínculos organizacionais. |
| `PATCH` | `/users/:id/role` | ADMIN; altera papel permitido e ativa/desativa usuário. |
| `PATCH` | `/users/:id/relationships` | ADMIN; define supervisor e recrutador padrão do gestor. |
| `GET`, `POST` | `/departments` | ADMIN; lista/cria departamentos. |
| `GET` | `/vacancy-requests` | ADMIN, gestor ou recrutador; lista conforme escopo. |
| `POST` | `/vacancy-requests` | ADMIN/gestor; solicita abertura de cargo para análise. |
| `PATCH` | `/vacancy-requests/:id/resubmit` | ADMIN/gestor com acesso; reenvia solicitação devolvida. |
| `POST` | `/vacancy-requests/:id/review` | Recrutador atribuído; aprova ou devolve com observações. |
| `GET` | `/vacancies` | Vagas dentro do escopo do papel. |
| `POST` | `/vacancies` | Retorna `409`; novas vagas devem passar por `/vacancy-requests`. |
| `PATCH` | `/vacancies/:id` | ADMIN/gestor autorizado; atualiza status, prioridade e prazo. |
| `GET`, `POST` | `/vacancies/:id/stages` | Consulta/configura etapas da vaga autorizada. |
| `PATCH`, `DELETE` | `/stages/:id` | ADMIN/gestor; altera ou desativa etapa preservando histórico. |
| `PUT` | `/vacancies/:id/stages/reorder` | ADMIN/gestor; reordena etapas. |
| `POST`, `GET` | `/candidates` | Cadastro e busca limitados às permissões do usuário. |
| `POST` | `/applications` | Cria candidatura associada à vaga. |
| `GET` | `/vacancies/:id/applications` | Lista candidaturas da vaga autorizada. |
| `POST` | `/applications/:id/move` | Gestor/recrutador autorizado; valida transição e aprovações. |
| `GET` | `/approvals` | Lista decisões destinadas ao usuário autenticado. |
| `POST` | `/approvals/:id/decision` | Aprovador designado; aprova, reprova ou solicita informação. |
| `GET` | `/notifications` | Lista notificações do usuário. |
| `PATCH` | `/notifications/:id/read` | Marca notificação do usuário como lida. |
| `GET` | `/closure-reasons?kind=REJECTION\|WITHDRAWAL` | Lista motivos ativos de encerramento. |
| `POST` | `/applications/:id/close` | Gestor/recrutador autorizado; encerra com motivo obrigatório. |
| `POST` | `/applications/:id/hire` | ADMIN/gestor autorizado; registra contratação. |
| `GET`, `POST` | `/applications/:id/notes` | Lê/cria observações; conteúdo confidencial é filtrado por permissão. |
| `GET` | `/applications/:id/timeline` | Histórico de transições, decisões e observações visíveis. |
| `GET`, `POST` | `/applications/:id/activities` | Lista/cria atividades da candidatura autorizada. |
| `POST` | `/activities/:id/complete` | Conclui atividade acessível ao usuário. |
| `GET` | `/dashboard/summary` | Métricas no escopo do usuário; aceita `vacancyId` para detalhar uma vaga. |

## Modelo e transações

`applications` representa uma candidatura independente para cada par candidato/vaga. As movimentações atualizam a etapa atual, encerram o intervalo anterior, criam `stage_transitions`, registram aprovações necessárias e gravam auditoria no fluxo transacional. Encerramentos separam contratação, reprovação e desistência. O banco possui índice único para impedir mais de uma candidatura da mesma pessoa à mesma vaga.

Migrations SQL numeradas de `001` a `007` são aplicadas pelo runner em `scripts/migrate.mjs`. O Compose aguarda o PostgreSQL saudável e a conclusão do serviço `migrate` antes de iniciar a API.

## Execução

Na raiz do repositório, configure `.env` a partir de `.env.example` e execute:

```sh
docker compose up --build -d
```

Para execução local da API fora do Compose:

```sh
npm install
docker compose up -d postgres
npm run db:migrate
npm run api
```

Configure `DATABASE_URL`, `GOOGLE_CLIENT_IDS`, `INITIAL_ADMIN_EMAIL` e um `SESSION_SECRET` aleatório de pelo menos 32 caracteres. `DATABASE_SSL=true` habilita TLS com validação de certificado. Consulte o README da raiz para URLs autorizadas no Google Cloud Console.

## Limites conhecidos

O schema aplicado é definido pelas migrations SQL; `prisma/schema.prisma` é uma referência e pode divergir. A API usa JavaScript ES modules e validação explícita. Os tipos REST ainda não são distribuídos por um pacote compartilhado, e armazenamento privado de currículos, entregas externas de notificações, políticas LGPD automatizadas e testes ponta a ponta precisam de evolução antes do uso em produção.
