# Arquitetura inicial

## Decisões

- Preservar o aplicativo React Native CLI existente para Android e iOS.
- Organizar web, mobile, API e pacotes compartilhados como workspaces no mesmo repositório.
- Usar PostgreSQL como fonte de verdade e Prisma para schema e migrations.
- Implementar a API como monólito modular TypeScript; separar serviços só quando volume ou operação justificar.
- Autenticar com Google. A API valida o token Google contra os client IDs permitidos; a identidade persistida é o `sub` do Google, não o e-mail isoladamente.
- A conta definida por `INITIAL_ADMIN_EMAIL` recebe o papel ADMIN no bootstrap. O papel é concedido apenas após validação do token e verificação de e-mail pelo Google. Não há cadastro público de administradores; mudanças de papel exigem ação administrativa auditada.
- Novos usuários autenticados recebem papel RECRUITER com escopo limitado até que o administrador conceda acessos adicionais. A autorização é aplicada na API em toda operação e considera o escopo da vaga.
- Sessões da API devem usar cookies HttpOnly/Secure/SameSite no web e credenciais protegidas no mobile. Tokens Google não devem ser armazenados como sessão duradoura.
- Documentos de candidatura devem ficar em armazenamento privado, servidos por URLs temporárias após autorização.

## Autenticação e bootstrap do administrador

1. O cliente autentica pelo Google e envia o token de identidade à API.
2. A API verifica assinatura, emissor, validade, audiência permitida e `email_verified`.
3. A API encontra ou cria o usuário pelo `googleSubject` (`sub`).
4. Se o e-mail verificado corresponde a `INITIAL_ADMIN_EMAIL`, a API atribui ADMIN. Essa verificação também é aplicada no login para permitir bootstrap inicial e impedir dependência de seed manual.
5. Para outros usuários, o papel padrão é RECRUITER. A autorização impede acesso a vagas fora do escopo concedido.

O administrador inicial deve usar uma conta corporativa controlada. O endereço é configuração de ambiente, nunca um segredo embutido no app. Mudanças na identidade inicial devem exigir operação controlada e registro de auditoria.

## Integridade e indicadores

Movimentações atualizam a candidatura e fecham/abrem o intervalo da etapa em uma transação. Os registros de `StageTransition` e `AuditLog` são append-only pela aplicação. Reordenar ou desativar etapas não apaga registros históricos; etapas referenciadas não devem ser excluídas fisicamente.

As métricas devem ser calculadas no servidor, usando intervalos de tempo armazenados e regras documentadas. Funil usa como denominador as candidaturas que alcançaram a etapa anterior; candidaturas ativas, reprovadas, desistentes e contratadas devem ser segmentadas conforme a métrica. Toda visualização deve expor o período e o escopo aplicado.

## Módulos da API

- `identity`: login Google, sessão, usuários e papéis.
- `organization`: departamentos e equipes.
- `vacancies`: vagas e histórico de alterações.
- `pipeline`: etapas, regras e transições.
- `candidates`: cadastros e documentos.
- `applications`: candidaturas, encerramentos, notas e atividades.
- `approvals`: filas e decisões.
- `analytics`: métricas e detalhamento autorizado.
- `notifications`: alertas e histórico de envio.
- `audit`: trilha de auditoria e exportações controladas.

## Estrutura alvo

```text
apps/
  api/                 # REST TypeScript, módulos de domínio e OpenAPI
  web/                 # React + TypeScript
  mobile/              # React Native CLI atual
packages/
  contracts/           # Tipos e schemas de API compartilhados
  domain/              # Regras puras compartilhadas quando fizer sentido
  config/              # Configuração TypeScript/lint
prisma/
  schema.prisma
  migrations/
  seed.ts
docs/
```

## Fases

1. Fundação: workspaces, PostgreSQL, migrations, login Google, bootstrap admin, RBAC, departamentos e vagas.
2. Processo seletivo: etapas/aprovadores configuráveis, candidatos, candidaturas, Kanban/lista, histórico, duração e encerramentos.
3. Gestão: notas, atividades, fila de aprovações, notificações, dashboard e detalhamento dos indicadores.
4. Qualidade e publicação: testes dos fluxos, acessibilidade, responsividade, segurança, documentação e implantação.

## Configuração necessária

Copie `.env.example` para `.env` na API e configure banco, client IDs OAuth autorizados, e-mail exato do administrador inicial e segredo de sessão. As credenciais OAuth devem ser configuradas nos consoles Google para os identificadores de cada plataforma; não devem ser commitadas.
