# API — fase de fundação

API HTTP em Node.js 22+, PostgreSQL e `pg`. Endpoints implementados nesta fatia:

| Método | Rota | Acesso |
|---|---|---|
| `GET` | `/health` | público; confere conexão ao banco |
| `POST` | `/auth/google` | público; troca token Google verificado por sessão da API |
| `GET` | `/auth/me` | usuário autenticado |
| `GET` | `/users` | ADMIN |
| `PATCH` | `/users/:id/role` | ADMIN; atribui HIRING_MANAGER, RECRUITER ou APPROVER e ativa/desativa |
| `GET` | `/approvers` | Usuário autenticado; lista nomes de aprovadores ativos para configurar etapas |
| `GET` | `/departments` | ADMIN |
| `POST` | `/departments` | ADMIN |
| `GET` | `/vacancies` | ADMIN vê todas; gestor/recrutador vê vagas atribuídas |
| `POST` | `/vacancies` | ADMIN ou HIRING_MANAGER |
| `PATCH` | `/vacancies/:id` | ADMIN ou HIRING_MANAGER; altera status, prioridade e prazo |
| `GET` | `/vacancies/:id/stages` | Usuário com escopo na vaga |
| `POST` | `/vacancies/:id/stages` | ADMIN ou HIRING_MANAGER |
| `PATCH` / `DELETE` | `/stages/:id` | ADMIN ou HIRING_MANAGER; desativar preserva o histórico |
| `PUT` | `/vacancies/:id/stages/reorder` | ADMIN ou HIRING_MANAGER |
| `POST` | `/candidates` | ADMIN, HIRING_MANAGER ou RECRUITER |
| `GET` | `/candidates?q=` | Candidatos das vagas autorizadas |
| `POST` | `/applications` | ADMIN, HIRING_MANAGER ou RECRUITER |
| `GET` | `/vacancies/:id/applications` | Usuário com escopo na vaga |
| `POST` | `/applications/:id/move` | Gestor/recrutador autorizado; valida aprovações e transições |
| `GET` | `/approvals` | Aprovador autenticado |
| `POST` | `/approvals/:id/decision` | Aprovador responsável |
| `GET` | `/closure-reasons?kind=REJECTION\|WITHDRAWAL` | Usuário autenticado |
| `POST` | `/applications/:id/close` | Gestor/recrutador autorizado; exige motivo |
| `POST` | `/applications/:id/hire` | ADMIN ou HIRING_MANAGER |
| `GET` / `POST` | `/applications/:id/notes` | Usuário autorizado; nota confidencial restrita |
| `GET` | `/applications/:id/timeline` | Histórico de etapas, aprovações, notas e atividades, com notas confidenciais filtradas |
| `GET` / `POST` | `/applications/:id/activities` | Usuário com escopo na vaga |
| `GET` | `/dashboard/summary` | Métricas limitadas ao escopo do usuário |

As rotas protegidas usam `Authorization: Bearer <token>`. A sessão expira em oito horas e cada requisição confere se o usuário continua ativo. O único caminho para conceder ADMIN é o e-mail verificado configurado em `INITIAL_ADMIN_EMAIL`; o endpoint de gestão de usuários não permite atribuir ADMIN.

## Execução local

Na raiz do repositório:

```sh
npm install
docker compose up -d postgres
cp apps/api/.env.example apps/api/.env
```

No arquivo `apps/api/.env`, configure `GOOGLE_CLIENT_IDS`, `INITIAL_ADMIN_EMAIL` e um `SESSION_SECRET` aleatório com pelo menos 32 caracteres. Configure `WEB_ORIGIN` para a origem exata do frontend web. Em seguida:

```sh
npm run migrate
npm run start:dev
```

`DATABASE_SSL=true` habilita TLS com validação do certificado para bancos remotos. Em produção, use segredo próprio, credenciais de banco restritas, HTTPS e armazenamento de documentos privado.

## Login Google

O cliente obtém um Google ID token por meio do fluxo OAuth da plataforma e envia `POST /auth/google` com `{ "credential": "..." }`. O servidor valida assinatura RS256 com chaves públicas do Google, emissor, expiração, `email_verified` e audiência (`GOOGLE_CLIENT_IDS`). O token de identidade não é usado como sessão da aplicação.

## Limites desta entrega

Esta API cobre autenticação, usuários/perfis, departamentos e vagas. A interface React Native ainda não foi conectada a ela; etapas, candidatos, candidaturas, Kanban, aprovações, dashboard e notificações ficam para as fases seguintes. O schema Prisma em `../../prisma/schema.prisma` é o modelo alvo; a migration SQL desta pasta cobre somente a fundação executável atual.
