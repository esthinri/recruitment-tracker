# Arquitetura do Recruitment Tracker

Este documento descreve a arquitetura executável atual e seus principais fluxos. Os diagramas usam Mermaid e podem ser renderizados pelo GitHub e por visualizadores compatíveis.

## Visão de implantação

O painel web e a API são construídos como imagens Docker separadas. O Nginx serve os arquivos do React e encaminha chamadas `/api/*` para a API. PostgreSQL é a fonte de verdade; o serviço de migração aplica os arquivos SQL antes da API iniciar. O aplicativo React Native roda no dispositivo ou simulador e acessa a mesma API.

```mermaid
flowchart LR
  subgraph Clients[Clientes]
    Browser[Navegador<br/>React + TypeScript + CoreUI]
    Mobile[Aplicativo móvel<br/>React Native]
    Google[Google Identity Services]
  end

  subgraph Compose[Docker Compose]
    Web[Nginx<br/>arquivos web + proxy /api]
    API[API REST<br/>Node.js + pg]
    Migrate[Runner de migrations<br/>SQL versionado]
    DB[(PostgreSQL)]
    Seed[Seed de demonstração<br/>perfil opcional]
  end

  Browser -->|página e assets| Web
  Browser -->|/api/*| Web
  Web -->|proxy reverso| API
  Mobile -->|HTTPS em produção / HTTP local| API
  Browser <-->|login Google| Google
  Mobile <-->|login nativo| Google
  API -->|verifica assinatura e claims| Google
  API <-->|SQL via pg| DB
  Migrate -->|aplica migrations| DB
  Seed -->|dados fictícios| DB
```

### Componentes e limites

| Componente | Responsabilidade atual |
| --- | --- |
| `apps/web` | Interface web React/TypeScript, CoreUI, Kanban, dashboard e administração. |
| `App.tsx` (raiz) | Aplicativo React Native para Android/iOS; cliente REST em `src/api.ts`. |
| `apps/api/src/server.mjs` | API REST Node.js em monólito modular por domínio/rotas; usa `pg` e PostgreSQL. |
| `apps/api/migrations` | Schema executável do banco, aplicado em ordem pelo runner. É a fonte de verdade do banco atual. |
| `apps/web/nginx.conf` | Serve o build web e encaminha `/api/` para a API. |
| `docker-compose.yml` | Orquestra PostgreSQL, migration, API, web e seed opcional. |

O arquivo `prisma/schema.prisma` descreve um modelo de referência, mas as migrations SQL são o schema efetivamente aplicado hoje. Web e mobile compartilham a API REST e os formatos JSON; os tipos ainda não estão extraídos para um pacote compartilhado. A API está concentrada em um servidor Node.js e pode ser dividida em módulos físicos conforme o código crescer.

## Modelo relacional

`Application` representa a candidatura da pessoa a uma vaga. Dados da pessoa ficam em `candidates`; etapa, situação, salário e encerramento pertencem à candidatura. As transições registram a trilha temporal de cada candidatura.

```mermaid
erDiagram
  USERS {
    text id PK
    text google_subject UK
    text email UK
    text role
    boolean active
    text supervisor_id FK
    text default_recruiter_id FK
  }
  DEPARTMENTS {
    text id PK
    text name UK
  }
  VACANCIES {
    text id PK
    text code UK
    text title
    text status
    text hiring_manager_id FK
    text recruiter_id FK
    text department_id FK
    text opening_type
    text seniority_level
  }
  VACANCY_REQUESTS {
    text id PK
    text created_by FK
    text hiring_manager_id FK
    text recruiter_id FK
    text opening_type
    text seniority_level
    text status
    text result_vacancy_id FK
  }
  CANDIDATES {
    text id PK
    text full_name
    text email
    text resume_url
  }
  RECRUITMENT_STAGES {
    text id PK
    text vacancy_id FK
    text name
    int position
    int due_days
    boolean requires_approval
  }
  APPLICATIONS {
    text id PK
    text candidate_id FK
    text vacancy_id FK
    text current_stage_id FK
    text status
    numeric salary_expectation
    timestamptz applied_at
    timestamptz last_moved_at
    timestamptz closed_at
  }
  STAGE_APPROVERS {
    text stage_id PK, FK
    text user_id PK, FK
    boolean required
  }
  STAGE_TRANSITIONS {
    bigint id PK
    text application_id FK
    text from_stage_id FK
    text to_stage_id FK
    text actor_id FK
    timestamptz entered_at
    timestamptz exited_at
    text reason
  }
  APPROVAL_RECORDS {
    text id PK
    text application_id FK
    text stage_id FK
    text approver_id FK
    text decision
    timestamptz due_at
    timestamptz decided_at
  }
  CLOSURE_REASONS {
    text id PK
    text kind
    text label
    boolean requires_note
  }
  CANDIDATE_NOTES {
    text id PK
    text application_id FK
    text author_id FK
    boolean confidential
  }
  CANDIDATE_ACTIVITIES {
    text id PK
    text application_id FK
    text title
    timestamptz due_at
    timestamptz completed_at
  }
  NOTIFICATIONS {
    text id PK
    text user_id FK
    text dedupe_key UK
    timestamptz read_at
  }
  AUDIT_LOGS {
    bigint id PK
    text actor_id FK
    text entity_type
    text entity_id
    jsonb metadata
  }

  USERS o|--o{ USERS : supervises
  USERS ||--o{ VACANCIES : manages
  USERS ||--o{ VACANCIES : recruits
  DEPARTMENTS o|--o{ VACANCIES : groups
  USERS ||--o{ VACANCY_REQUESTS : creates
  USERS ||--o{ VACANCY_REQUESTS : manages_request
  USERS ||--o{ VACANCY_REQUESTS : reviews
  VACANCIES o|--o{ VACANCY_REQUESTS : results_in
  VACANCIES ||--|{ RECRUITMENT_STAGES : configures
  CANDIDATES ||--o{ APPLICATIONS : applies
  VACANCIES ||--o{ APPLICATIONS : receives
  RECRUITMENT_STAGES o|--o{ APPLICATIONS : current_stage
  RECRUITMENT_STAGES ||--o{ STAGE_APPROVERS : assigns
  USERS ||--o{ STAGE_APPROVERS : approves_stage
  APPLICATIONS ||--o{ STAGE_TRANSITIONS : records
  RECRUITMENT_STAGES o|--o{ STAGE_TRANSITIONS : from_stage
  RECRUITMENT_STAGES o|--o{ STAGE_TRANSITIONS : to_stage
  USERS ||--o{ STAGE_TRANSITIONS : moves
  APPLICATIONS ||--o{ APPROVAL_RECORDS : requests
  RECRUITMENT_STAGES ||--o{ APPROVAL_RECORDS : requires
  USERS ||--o{ APPROVAL_RECORDS : decides
  CLOSURE_REASONS o|--o{ APPLICATIONS : closes_with
  APPLICATIONS ||--o{ CANDIDATE_NOTES : has
  USERS ||--o{ CANDIDATE_NOTES : writes
  APPLICATIONS ||--o{ CANDIDATE_ACTIVITIES : schedules
  USERS ||--o{ NOTIFICATIONS : receives
  USERS o|--o{ AUDIT_LOGS : acts
```

## Autenticação e autorização

```mermaid
sequenceDiagram
  autonumber
  actor Pessoa
  participant Cliente as Web ou mobile
  participant Google
  participant API
  participant DB as PostgreSQL

  Pessoa->>Cliente: Inicia login
  Cliente->>Google: Solicita autenticação
  Google-->>Cliente: ID token
  Cliente->>API: POST /auth/google (credential)
  API->>Google: Obtém chaves públicas de assinatura
  API->>API: Valida RS256, emissor, expiração, audiência e email_verified
  API->>DB: Localiza/cria usuário pelo Google sub
  API->>API: Aplica papel ADMIN ao e-mail inicial configurado
  API-->>Cliente: Token de sessão assinado, válido por 8 horas
  Cliente->>API: Requisição com Authorization: Bearer
  API->>DB: Confere usuário ativo e escopo da vaga
  API-->>Cliente: JSON autorizado ou erro 401/403/404
```

O administrador inicial é definido em `INITIAL_ADMIN_EMAIL`. Os demais usuários autenticados começam com papel limitado e o administrador gerencia papéis e vínculos. As regras de acesso são verificadas na API: administrador global; gestor para suas vagas e as do supervisor configurado; recrutador para vagas atribuídas; aprovador para vagas onde foi designado. O token de sessão é enviado como Bearer; a aplicação não usa cookie HttpOnly atualmente.

## Fluxos de negócio

### Solicitação e aprovação de abertura

```mermaid
flowchart TD
  Start[Administrador ou gestor registra cargo, tipo, descrição, requisitos e nível]
  Validate{Gestor ativo e recrutador vinculado?}
  Pending[Solicitação PENDING_RECRUITER atribuída]
  Review[Recrutador analisa a solicitação]
  Decision{Decisão}
  Return[Devolve com observações]
  Adjust[Gestor ajusta e reenvia]
  Create[API cria a vaga e etapas padrão em transação]
  Pipeline[Vaga aparece no pipeline]

  Start --> Validate
  Validate -- Não --> Fix[Administrador configura vínculos]
  Fix --> Start
  Validate -- Sim --> Pending
  Pending --> Review --> Decision
  Decision -- Devolver --> Return --> Adjust --> Pending
  Decision -- Aprovar --> Create --> Pipeline
```

O gestor configura o supervisor e o recrutador padrão na administração. A aprovação cria a vaga e suas etapas padrão; uma solicitação devolvida pode ser ajustada e submetida novamente.

### Movimentação no pipeline

```mermaid
sequenceDiagram
  autonumber
  actor Recrutador
  participant Web as Kanban web
  participant API
  participant DB as PostgreSQL

  Recrutador->>Web: Arrasta candidatura para uma etapa
  Web->>API: POST /applications/:id/move
  API->>DB: Confere papel, acesso, etapa e aprovações obrigatórias
  alt Transição válida
    API->>DB: Atualiza candidatura e fecha/abre intervalo da etapa
    API->>DB: Registra StageTransition e auditoria
    API-->>Web: Candidatura atualizada
    Web->>API: Atualiza candidatura e estatísticas da vaga
  else Regra não atendida
    API-->>Web: Erro de validação; mantém etapa atual
  end
```

## Indicadores

O endpoint `GET /dashboard/summary` aplica o escopo de acesso e aceita `vacancyId` para detalhar uma vaga. Os contadores de pipeline incluem somente candidaturas `ACTIVE`; contratações, reprovações e desistências são contabilizadas separadamente. O tempo médio até contratação considera candidaturas `HIRED` com datas de inscrição e encerramento. A conversão exibida na tela da vaga usa contratações divididas por todas as candidaturas retornadas para essa vaga.

## Estrutura e execução

```text
apps/
  api/
    src/server.mjs          # API REST e autorização
    migrations/             # migrations PostgreSQL 001–007
    scripts/                # migração e seed de demonstração
  web/
    src/App.tsx             # interface React/TypeScript
    Dockerfile
    nginx.conf
App.tsx                      # interface React Native
src/api.ts                   # cliente REST do mobile
docker-compose.yml
prisma/schema.prisma         # modelo de referência, não aplicado pelo Compose
docs/architecture.md
```

Para subir a aplicação, configure `.env` usando `.env.example` e execute:

```sh
docker compose up --build -d
```

O Compose inicia PostgreSQL, aplica migrations e sobe API e painel. O seed de demonstração é opcional via perfil `demo`. O mobile é compilado e executado no host/dispositivo, consumindo a API exposta na porta configurada.

## Limites conhecidos

- A API está implementada em JavaScript (ES modules) com validação explícita e consultas SQL via `pg`; TypeScript é usado no frontend web/mobile.
- As migrations SQL são o schema ativo; o modelo Prisma é documentação de referência e pode divergir.
- O contrato REST ainda não está centralizado em pacote compartilhado entre web e mobile.
- O login mobile usa o fluxo nativo do Google; os IDs OAuth precisam ser configurados por plataforma.
- Armazenamento privado de currículo, envio externo de notificações, retenção/eliminação automatizada LGPD e testes ponta a ponta permanecem como trabalho de evolução antes de produção.
